import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { Pool } from 'pg';
import { BufferJSON, proto } from '@whiskeysockets/baileys';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { openPostgresAuth } from '../src/postgres-auth.js';
async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
test('embedded PostgreSQL SQL/wire-protocol integration (not Neon/native concurrency or TLS)',{timeout:120000},async t=>{
 const db=await PGlite.create();const port=await freePort();const wire=new PGLiteSocketServer({db,port,host:'127.0.0.1',inspect:false,maxConnections:20});await wire.start();
 const makePool=()=>new Pool({host:'127.0.0.1',port,database:'postgres',user:'postgres',ssl:false,max:1,query_timeout:5000,connectionTimeoutMillis:5000});
 const admin=makePool();
 t.after(async()=>{await admin.end();await wire.stop();await db.close()});
 const migration=await readFile(new URL('../migrations/001_auth.sql',import.meta.url),'utf8');await admin.query(migration);await admin.query(migration);
 const open=(sessionId,extra={})=>openPostgresAuth({allowCreate:true,pool:makePool(),sessionId,key:Buffer.alloc(32,7),codec:BufferJSON,initCreds:()=>({syntheticMarker:'SYNTHETIC-ONLY',counter:1}),fromAppState:value=>proto.Message.AppStateSyncKeyData.fromObject(value),...extra});
 function worker(mode,session){const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/auth-db-test-worker.js',import.meta.url)),mode,session],{env:{PATH:process.env.PATH,NANDHANA_TEST_DB_PORT:String(port)},stdio:['ignore','pipe','pipe','ipc']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const done=once(child,'exit').then(([code])=>({code,out,err}));return {child,done}}
 await t.test('automatic additive migration uses same pool config and preserves encrypted records',async()=>{
  const {migrateAuthSchema}=await import('../src/auth-schema.js');
  const saved=await open('migration-preservation');await saved.state.keys.set({'pre-key':{fixture:{counter:1}}});await saved.close();
  const before=await admin.query('SELECT envelope FROM nandhana_auth_records WHERE session_id=$1 ORDER BY kind,key_id',['migration-preservation']);
  let requested;await migrateAuthSchema({store:'postgres',synthetic:true},async config=>{requested=config;return makePool()});assert.equal(requested.synthetic,true);
  assert.deepEqual((await admin.query('SELECT envelope FROM nandhana_auth_records WHERE session_id=$1 ORDER BY kind,key_id',['migration-preservation'])).rows,before.rows);
 });
 await t.test('unselected/unknown existing IDs never create sessions; new ID collision refuses overwrite',async()=>{
  await assert.rejects(open('must-not-exist',{allowCreate:false}));assert.equal((await admin.query('SELECT 1 FROM nandhana_auth_sessions WHERE session_id=$1',['must-not-exist'])).rowCount,0);
  const a=await open('collision');await a.close();await assert.rejects(open('collision',{newSession:true}));const b=await open('collision',{allowCreate:false});await b.close();
 });
 await t.test('one-time notice reservation is encrypted, persisted and fenced across restarts',async()=>{
  const a=await open('notice-marker');const claims=await Promise.all([a.claimNotice(),a.claimNotice()]);assert.equal(claims.filter(c=>c.claimed).length,1);await a.finishNotice('sent');await a.close();
  const b=await open('notice-marker');assert.deepEqual(await b.claimNotice(),{claimed:false,status:'sent'});await b.close();
  const rows=await admin.query("SELECT envelope FROM nandhana_auth_records WHERE session_id=$1 AND kind='meta'",['notice-marker']);assert.equal(rows.rowCount,1);assert.ok(!JSON.stringify(rows.rows).includes('sent'));
 });
 await t.test('public pause state is encrypted, session-isolated and survives process/store restart',async()=>{
  const first=await open('public-control');assert.deepEqual(await first.readControl(),{paused:false});await first.writePaused(true);await first.close();
  const second=await open('public-control');assert.deepEqual(await second.readControl(),{paused:true});await second.writePaused(false);await second.close();
  const other=await open('isolated-control');assert.deepEqual(await other.readControl(),{paused:false});await other.close();
  const row=await admin.query("SELECT envelope FROM nandhana_auth_records WHERE session_id=$1 AND kind='meta' AND key_id='download-control'",['public-control']);assert.equal(row.rowCount,1);assert.ok(!JSON.stringify(row.rows).includes('paused'));
 });
 await t.test('process A writes synthetic creds/Signal keys; process B retrieves exact bytes/proto',async()=>{
  const a=await worker('write','process-persistence').done;assert.equal(a.code,0);assert.equal(a.out,'write_pass\n');
  const b=await worker('read','process-persistence').done;assert.equal(b.code,0);assert.equal(b.out,'read_pass\n');
  const rows=await admin.query('SELECT envelope FROM nandhana_auth_records WHERE session_id=$1',['process-persistence']);assert.equal(rows.rowCount,3);assert.ok(!JSON.stringify(rows.rows).includes('SYNTHETIC-ONLY'));
 });
 await t.test('separate process contender cannot own same session',async()=>{
  const holder=worker('hold','exclusive-process');await once(holder.child,'message');
  try{const contender=await worker('contend','exclusive-process').done;assert.equal(contender.code,0);assert.equal(contender.out,'exclusive_pass\n')}finally{holder.child.send('release');await holder.done}
 });
 await t.test('key deletion, absent reads and parameterized malicious identifiers',async()=>{
  const store=await open('key-operations');try{const id="synthetic'; DROP TABLE nandhana_auth_records; --";await store.state.keys.set({'pre-key':{[id]:{bytes:Buffer.from([9])}}});assert.deepEqual((await store.state.keys.get('pre-key',[id]))[id].bytes,Buffer.from([9]));await store.state.keys.set({'pre-key':{[id]:null}});assert.equal((await store.state.keys.get('pre-key',[id]))[id],null)}finally{await store.close()}
 });
 await t.test('wrong encryption key refuses existing auth, never initializes replacement',async()=>{
  const a=await open('wrong-key');await a.close();let initialized=0;
  await assert.rejects(open('wrong-key',{key:Buffer.alloc(32,8),initCreds:()=>{initialized++;return {}}}),/AUTH_DATABASE_UNAVAILABLE/);assert.equal(initialized,0);
 });
 await t.test('missing initialized credential row fails closed, preserving Signal rows',async()=>{
  const a=await open('missing-creds');await a.state.keys.set({'pre-key':{one:{value:'synthetic'}}});await a.close();
  await admin.query("DELETE FROM nandhana_auth_records WHERE session_id=$1 AND kind='creds'",['missing-creds']);let initialized=0;
  await assert.rejects(open('missing-creds',{initCreds:()=>{initialized++;return {}}}));assert.equal(initialized,0);assert.equal((await admin.query('SELECT 1 FROM nandhana_auth_records WHERE session_id=$1',['missing-creds'])).rowCount,1);
 });
 await t.test('tampered ciphertext triggers lost callback and blocks further operations',async()=>{
  let lost=0;const a=await open('tampering',{onLost:()=>lost++});
  try{await a.state.keys.set({'pre-key':{one:{value:'synthetic'}}});await admin.query("UPDATE nandhana_auth_records SET envelope=jsonb_set(envelope,'{tag}',to_jsonb($2::text)) WHERE session_id=$1 AND kind='key:pre-key'",['tampering',Buffer.alloc(16).toString('base64')]);await assert.rejects(a.state.keys.get('pre-key',['one']));assert.throws(()=>a.assertActive());await new Promise(resolve=>setImmediate(resolve));assert.equal(lost,1)}finally{await a.close()}
 });
 await t.test('expired owner is fenced after takeover; closing stale owner cannot release new lease',async()=>{
  const a=await open('fence-test',{renewMs:60000});
  await admin.query("UPDATE nandhana_auth_sessions SET lease_until=clock_timestamp()-interval '1 second' WHERE session_id=$1",['fence-test']);
  const b=await open('fence-test');
  try{a.state.creds.counter=99;await assert.rejects(a.saveCreds());await a.close();await b.guard();assert.equal(b.state.creds.counter,1);const fence=await admin.query('SELECT fence FROM nandhana_auth_sessions WHERE session_id=$1',['fence-test']);assert.equal(Number(fence.rows[0].fence),2)}finally{await a.close();await b.close()}
 });
 await t.test('multi-key write rolls back atomically when SQL fails',async()=>{
  const a=await open('atomic-failure');
  await admin.query("CREATE OR REPLACE FUNCTION nandhana_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.session_id='atomic-failure' AND NEW.key_id='bad' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER nandhana_test_guard BEFORE INSERT ON nandhana_auth_records FOR EACH ROW EXECUTE FUNCTION nandhana_test_reject()");
  try{await assert.rejects(a.state.keys.set({'pre-key':{good:{value:1},bad:{value:2}}}));assert.equal((await admin.query("SELECT 1 FROM nandhana_auth_records WHERE session_id=$1 AND kind='key:pre-key'",['atomic-failure'])).rowCount,0)}finally{await a.close();await admin.query('DROP TRIGGER nandhana_test_guard ON nandhana_auth_records; DROP FUNCTION nandhana_test_reject()')}
 });
 await t.test('heartbeat renews owned lease and fails closed after ownership revocation',async()=>{
  let lost=0;const a=await open('renewal',{renewMs:25,onLost:()=>lost++});
  try{const initial=(await admin.query('SELECT lease_until FROM nandhana_auth_sessions WHERE session_id=$1',['renewal'])).rows[0].lease_until;
    await new Promise(resolve=>setTimeout(resolve,100));
    const next=(await admin.query('SELECT lease_until FROM nandhana_auth_sessions WHERE session_id=$1',['renewal'])).rows[0].lease_until;assert.ok(next>initial);
    await admin.query('UPDATE nandhana_auth_sessions SET owner=NULL WHERE session_id=$1',['renewal']);
    for(let i=0;i<100 && !lost;i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(lost,1);assert.throws(()=>a.assertActive());
  }finally{await a.close()}
 });
 await t.test('local lease deadline blocks operations before querying database',async()=>{
  let clock=100;const a=await open('deadline',{now:()=>clock});try{clock+=30001;assert.throws(()=>a.assertActive());await assert.rejects(a.state.keys.get('pre-key',['one']))}finally{await a.close()}
 });
 await t.test('idle pool failure stops ownership without logging private error',async()=>{
  let lost=0;const pool=makePool();const a=await open('pool-failure',{pool,onLost:()=>lost++});try{pool.emit('error',new Error('SYNTHETIC-PRIVATE-DETAIL'));await new Promise(resolve=>setImmediate(resolve));assert.equal(lost,1);assert.throws(()=>a.assertActive())}finally{await a.close()}
 });
});
test('schema startup refuses future version without changing existing data or creating auth tables',async()=>{
 const db=await PGlite.create();
 try{
  await db.exec('CREATE TABLE nandhana_auth_schema(version integer PRIMARY KEY); INSERT INTO nandhana_auth_schema VALUES(2); CREATE TABLE unrelated_fixture(value text); INSERT INTO unrelated_fixture VALUES(\'preserved\');');
  const migration=await readFile(new URL('../migrations/001_auth.sql',import.meta.url),'utf8');
  await assert.rejects(db.exec(migration));await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT version FROM nandhana_auth_schema')).rows[0].version,2);
  assert.equal((await db.query('SELECT value FROM unrelated_fixture')).rows[0].value,'preserved');
  assert.equal((await db.query("SELECT to_regclass('nandhana_auth_sessions') AS name")).rows[0].name,null);
 }finally{await db.close();}
});
