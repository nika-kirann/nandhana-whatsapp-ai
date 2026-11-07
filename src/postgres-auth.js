import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createAuthCipher } from './auth-crypto.js';
// Transaction-scoped row locking + monotonically increasing fencing works through PgBouncer.
export async function openPostgresAuth({ pool, sessionId, key, codec, initCreds, fromAppState,
  onLost = () => {}, allowCreate = false, newSession = false, leaseMs = 30000, renewMs = 5000, now = () => performance.now() }) {
  const owner = randomUUID(), ownKey = Buffer.from(key), cipher = createAuthCipher(ownKey, sessionId, codec);
  let fence, active = true, closing = false, deadline = 0, timer, queue = Promise.resolve();
  const safeError = () => new Error('AUTH_DATABASE_UNAVAILABLE_OR_SESSION_LOST');
  function lose() {
    if (!active) return; active = false; clearInterval(timer);
    queueMicrotask(() => { try { Promise.resolve(onLost()).catch(() => {}); } catch {} });
  }
  pool.on?.('error', lose);
  function assertActive() { if (!active || now() >= deadline) { lose(); throw safeError(); } }
  async function boundedQuery(text, values) {
    let client;
    try {
      client = await pool.connect(); await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");
      const result = await client.query(text, values); await client.query('COMMIT'); return result;
    } catch (error) {
      if (client) { try { await client.query('ROLLBACK'); } catch {} client.release(true); client = undefined; }
      throw error;
    } finally { client?.release(); }
  }
  async function transaction(fn) {
    assertActive(); let client;
    try {
      client = await pool.connect(); assertActive(); await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");
      const locked = await client.query('SELECT fence FROM nandhana_auth_sessions WHERE session_id=$1 AND owner=$2 AND fence=$3 AND lease_until>clock_timestamp() FOR UPDATE', [sessionId,owner,fence]);
      if (locked.rowCount !== 1) throw safeError();
      const value = await fn(client);
      const valid = await client.query('SELECT fence FROM nandhana_auth_sessions WHERE session_id=$1 AND owner=$2 AND fence=$3 AND lease_until>clock_timestamp()', [sessionId,owner,fence]);
      assertActive(); if (valid.rowCount !== 1) throw safeError();
      await client.query('COMMIT'); return value;
    } catch {
      if (client) { try { await client.query('ROLLBACK'); } catch {} client.release(true); client = undefined; }
      lose(); throw safeError();
    } finally { client?.release(); }
  }
  function serial(fn) {
    if (closing) return Promise.reject(safeError());
    const task = queue.then(() => transaction(fn)); queue = task.catch(() => {}); return task;
  }
  const validateKey = (type, id) => {
    if (typeof type !== 'string' || !type || type.length > 128 || typeof id !== 'string' || !id || id.length > 2048) throw new Error('AUTH_INVALID_KEY');
  };
  async function put(client, kind, id, envelope) {
    assertActive();
    await client.query('INSERT INTO nandhana_auth_records(session_id,kind,key_id,envelope) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(session_id,kind,key_id) DO UPDATE SET envelope=EXCLUDED.envelope', [sessionId,kind,id,JSON.stringify(envelope)]);
  }
  async function close() {
    if (closing) return; closing = true; clearInterval(timer);
    await queue;
    active = false;
    try { if (fence !== undefined) await boundedQuery("UPDATE nandhana_auth_sessions SET owner=NULL, lease_until=clock_timestamp() WHERE session_id=$1 AND owner=$2 AND fence=$3", [sessionId,owner,fence]); } catch {}
    ownKey.fill(0); await pool.end();
  }
  try {
    const version = await boundedQuery('SELECT version FROM nandhana_auth_schema WHERE version=1');
    if (version.rowCount !== 1) throw safeError();
    if (!sessionId) throw safeError();
    if (allowCreate) {
      const inserted=await boundedQuery('INSERT INTO nandhana_auth_sessions(session_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING session_id',[sessionId]);
      if (newSession && inserted.rowCount!==1) throw safeError();
    }
    const started = now();
    const claim = await boundedQuery("UPDATE nandhana_auth_sessions SET owner=$2, fence=fence+1, lease_until=clock_timestamp()+($3 * interval '1 millisecond') WHERE session_id=$1 AND lease_until<=clock_timestamp() RETURNING fence,initialized", [sessionId,owner,leaseMs]);
    if (claim.rowCount !== 1) throw safeError();
    fence = claim.rows[0].fence; deadline = started + leaseMs - 2000; assertActive();
    const creds = await transaction(async client => {
      const records = await client.query("SELECT envelope FROM nandhana_auth_records WHERE session_id=$1 AND kind='creds' AND key_id='default'", [sessionId]);
      if (claim.rows[0].initialized) {
        if (records.rowCount !== 1) throw safeError();
        return cipher.decrypt(records.rows[0].envelope, 'creds', 'default');
      }
      if (!allowCreate) throw safeError();
      const existing = await client.query('SELECT 1 FROM nandhana_auth_records WHERE session_id=$1 LIMIT 1',[sessionId]);
      if (existing.rowCount) throw safeError();
      const initial = initCreds(); await put(client,'creds','default',cipher.encrypt(initial,'creds','default'));
      await client.query('UPDATE nandhana_auth_sessions SET initialized=true WHERE session_id=$1',[sessionId]); return initial;
    });
    let renewing = false;
    timer = setInterval(() => {
      if (renewing || !active || closing) return;
      renewing = true; const started = now();
      void (async () => {
        try {
          assertActive();
          const result = await boundedQuery("UPDATE nandhana_auth_sessions SET lease_until=clock_timestamp()+($4 * interval '1 millisecond') WHERE session_id=$1 AND owner=$2 AND fence=$3 AND lease_until>clock_timestamp() RETURNING fence",[sessionId,owner,fence,leaseMs]);
          assertActive(); if (result.rowCount !== 1) throw safeError(); deadline = started + leaseMs - 2000;
        } catch { lose(); } finally { renewing = false; }
      })();
    }, renewMs); timer.unref?.();
    return {
      state: { creds, keys: {
        async get(type, ids) {
          if (!Array.isArray(ids) || ids.length > 1000) throw new Error('AUTH_INVALID_KEY_BATCH');
          for (const id of ids) validateKey(type,id);
          return serial(async client => {
            const rows = await client.query('SELECT key_id,envelope FROM nandhana_auth_records WHERE session_id=$1 AND kind=$2 AND key_id=ANY($3::text[])',[sessionId,'key:'+type,ids]);
            const values = Object.create(null); for (const id of ids) values[id] = null;
            for (const row of rows.rows) { let value = cipher.decrypt(row.envelope,'key:'+type,row.key_id); if (type === 'app-state-sync-key' && value) value=fromAppState(value); values[row.key_id]=value; }
            return values;
          });
        },
        async set(data) {
          const updates=[];
          for (const [type, values] of Object.entries(data)) for (const [id,value] of Object.entries(values)) {
            validateKey(type,id); if (updates.length >= 1000) throw new Error('AUTH_INVALID_KEY_BATCH'); updates.push({kind:'key:'+type,id,envelope:value == null ? null : cipher.encrypt(value,'key:'+type,id)});
          }
          if (updates.length > 1000) throw new Error('AUTH_INVALID_KEY_BATCH');
          return serial(async client => { for (const item of updates) {
            if (item.envelope) await put(client,item.kind,item.id,item.envelope);
            else { assertActive(); await client.query('DELETE FROM nandhana_auth_records WHERE session_id=$1 AND kind=$2 AND key_id=$3',[sessionId,item.kind,item.id]); }
          } });
        }
      } },
      saveCreds() { const envelope=cipher.encrypt(creds,'creds','default'); return serial(client => put(client,'creds','default',envelope)); },
      async readControl() { return serial(async client=>{
        const result=await client.query("SELECT envelope FROM nandhana_auth_records WHERE session_id=$1 AND kind='meta' AND key_id='download-control'",[sessionId]);
        if(!result.rowCount)return {paused:false};
        const value=cipher.decrypt(result.rows[0].envelope,'meta','download-control');
        if(typeof value?.paused!=='boolean')throw safeError();return {paused:value.paused};
      }); },
      async writePaused(paused) { if(typeof paused!=='boolean')throw safeError();return serial(client=>put(client,'meta','download-control',cipher.encrypt({paused},'meta','download-control'))); },
      async claimNotice() { return serial(async client => {
        const prior=await client.query("SELECT envelope FROM nandhana_auth_records WHERE session_id=$1 AND kind='meta' AND key_id='self-notice'",[sessionId]);
        if (prior.rowCount) return { claimed:false, status:cipher.decrypt(prior.rows[0].envelope,'meta','self-notice').status };
        await put(client,'meta','self-notice',cipher.encrypt({status:'attempting'},'meta','self-notice'));
        return {claimed:true,status:'attempting'};
      }); },
      async finishNotice(status) { if (!['sent','failed','unknown'].includes(status)) throw safeError(); return serial(client=>put(client,'meta','self-notice',cipher.encrypt({status},'meta','self-notice'))); },
      assertActive, guard: () => serial(async () => {}), close
    };
  } catch { lose(); await close(); throw safeError(); }
}
