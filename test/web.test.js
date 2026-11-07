import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWebConfig } from '../src/web-config.js';
import { createOwnerServer } from '../src/web-server.js';
import { createWebPairing } from '../src/web-pairing.js';
import { acquireAuthLock } from '../src/auth-lock.js';
const fixtureEnv = { WEB_OWNER_USERNAME: 'owner', WEB_OWNER_PASSWORD: 'TEST-ONLY-privateFixture-Aa7!neverUse', PUBLIC_ORIGIN: 'https://pair.example' };
const config = readWebConfig(fixtureEnv);
const authorization = 'Basic ' + Buffer.from(config.username + ':' + config.password).toString('base64');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function setup(t, pairing, options) {
  const server = createOwnerServer(config, pairing, options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  async function request(path, { auth = true, method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ port: server.address().port, host: '127.0.0.1', path, method,
        headers: { host: config.host, 'x-forwarded-proto': 'https', ...(auth ? { authorization } : {}), ...headers } }, res => {
        const parts = []; res.on('data', b => parts.push(b)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts).toString() }));
      }); req.on('error', reject); req.end(body);
    });
  }
  async function session() {
    const response = await request('/owner');
    return { cookie: response.headers['set-cookie'][0].split(';')[0], csrf: response.body.match(/name="csrf" value="([a-f0-9]+)"/)[1] };
  }
  async function post(path, values = {}, options = {}) {
    const s = options.session || await session();
    return request(path, { method: 'POST', headers: { cookie: s.cookie, origin: config.origin, 'content-type': 'application/x-www-form-urlencoded', ...options.headers }, body: new URLSearchParams({ csrf: s.csrf, ...values }).toString() });
  }
  return { request, session, post };
}
function harness(extra = {}) {
  let callbacks, resolveDone, starts = 0, stops = 0;
  const manager = createWebPairing({ run: async options => {
    starts++; callbacks = options;
    return { done: new Promise(resolve => { resolveDone = resolve; }), stop: async () => { stops++; resolveDone('stopped'); } };
  }, ...extra });
  return { manager, get callbacks() { return callbacks; }, get starts() { return starts; }, get stops() { return stops; }, finish: async state => { resolveDone(state); await tick(); } };
}
test('owner config refuses missing/weak secrets and unsafe origins/ports', () => {
  for (const override of [{ WEB_OWNER_PASSWORD: '' }, { WEB_OWNER_PASSWORD: 'a'.repeat(30) }, { WEB_OWNER_USERNAME: 'bad:user' }, { PUBLIC_ORIGIN: 'http://pair.example' }, { PUBLIC_ORIGIN: 'https://u:p@pair.example' }, { PUBLIC_ORIGIN: 'https://pair.example/path' }, { PORT: 'bad' }]) assert.throws(() => readWebConfig({ ...fixtureEnv, ...override }));
  assert.equal(config.port, 8000);
});
test('public health/root reveal no session state; private routes require authentication', async t => {
  const h = harness(); const { request } = await setup(t, h.manager);
  assert.equal((await request('/healthz', { auth: false })).body, 'ok');
  assert.equal((await request('/healthz', { auth: false, method: 'HEAD' })).body, '');
  assert.equal((await request('/', { auth: false })).status, 200);
  for (const route of ['/owner','/owner/status','/owner/qr.png']) assert.equal((await request(route, { auth: false })).status, 401);
  assert.equal(h.starts, 0);
});
test('no static filesystem browsing, credentials in query, or arbitrary paths', async t => {
  const h = harness(); const { request } = await setup(t, h.manager);
  for (const route of ['/auth/creds.json','/.pairing/index.html','/owner?password=fixture','/owner/../auth','/owner/qr.png?x=y']) assert.equal((await request(route)).status, 404);
});
test('owner view has no-store, CSP, anti-frame, secure cookie and no auto pairing', async t => {
  const h = harness(); const { request } = await setup(t, h.manager); const res = await request('/owner');
  assert.equal(res.status, 200); assert.match(res.headers['cache-control'], /no-store/);
  assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(res.headers['x-frame-options'], 'DENY'); assert.equal(res.headers['referrer-policy'], 'same-origin');
  assert.match(res.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Strict/); assert.equal(h.starts, 0);
});
test('HTTPS proxy, canonical host and cross-site owner reads enforced', async t => {
  const h = harness(); const { request } = await setup(t, h.manager);
  for (const headers of [{ host: 'evil.example' }, { 'x-forwarded-proto': 'http' }]) assert.equal((await request('/owner', { headers })).status, 400);
  assert.equal((await request('/owner', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
});
test('invalid owner authentication is throttled without forwarded-IP trust', async t => {
  const h = harness(); const { request } = await setup(t, h.manager);
  for (let i=0; i<5; i++) assert.equal((await request('/owner', { headers: { authorization: 'Basic ZmFrZTpmYWtl', 'x-forwarded-for': `1.2.3.${i}` } })).status, 401);
  assert.equal((await request('/owner')).status, 429);
  assert.equal((await request('/healthz', { auth: false })).status, 200);
});
test('pairing POST needs valid same-origin CSRF session and form content type', async t => {
  const h = harness(); const api = await setup(t, h.manager); const s = await api.session();
  for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }, { origin: '' }, { cookie: '' }, { 'content-type': 'text/plain' }]) assert.equal((await api.post('/owner/start', { mode: 'qr' }, { session: s, headers })).status, 403);
  assert.equal((await api.post('/owner/start', { mode: 'qr', csrf: 'bad' }, { session: s })).status, 403);
  assert.equal(h.starts, 0);
});
test('expired owner sessions cannot authorize POST', async t => {
  let now = 100; const h = harness(); const api = await setup(t, h.manager, { now: () => now }); const s = await api.session(); now += 600001;
  assert.equal((await api.post('/owner/start', { mode: 'qr' }, { session: s })).status, 403);
});
test('invalid phone/mode rejected; submitted phone absent from responses/status', async t => {
  const h = harness(); const api = await setup(t, h.manager);
  assert.equal((await api.post('/owner/start', { mode: 'code', phone: 'invalid' })).status, 400);
  assert.equal((await api.post('/owner/start', { mode: 'other' })).status, 400);
  const response = await api.post('/owner/start', { mode: 'code', phone: '12345678' }); assert.equal(response.status, 303);
  assert.equal(h.callbacks.phone, '12345678'); assert.doesNotMatch((await api.request('/owner/status')).body, /12345678/);
  await h.manager.stop();
});
test('oversized POST body is capped', async t => {
  const h = harness(); const api = await setup(t, h.manager); assert.equal((await api.post('/owner/start', { phone: 'x'.repeat(1100) })).status, 413); assert.equal(h.starts, 0);
});
test('single attempt even for concurrent owner start POSTs', async t => {
  const h = harness(); const api = await setup(t, h.manager); const s = await api.session();
  const responses = await Promise.all([api.post('/owner/start', { mode: 'qr' }, { session: s }), api.post('/owner/start', { mode: 'qr' }, { session: s })]);
  assert.deepEqual(responses.map(x => x.status).sort(), [303,409]); assert.equal(h.starts, 1); await h.manager.stop();
});
test('QR bytes only authenticated; generic status never carries material', async t => {
  const h = harness(); const api = await setup(t, h.manager); await api.post('/owner/start', { mode: 'qr' });
  await h.callbacks.renderQR(Buffer.from('FIXTURE-QR-IMAGE')); await h.callbacks.status('waiting_scan');
  assert.equal((await api.request('/owner/qr.png')).body, 'FIXTURE-QR-IMAGE');
  assert.doesNotMatch((await api.request('/owner/status')).body, /FIXTURE/);
  assert.equal((await api.request('/owner/qr.png', { auth: false })).status, 401);
  await h.finish('paired'); assert.equal((await api.request('/owner/qr.png')).status, 404); assert.equal(h.manager.snapshot().state, 'paired');
});
test('code visible only in authenticated owner HTML and cleared on failure', async t => {
  const h = harness(); const api = await setup(t, h.manager); await api.post('/owner/start', { mode: 'code', phone: '12345678' });
  await h.callbacks.renderCode('TEST1234'); await h.callbacks.status('waiting_phone_code');
  assert.match((await api.request('/owner')).body, /TEST-1234/);
  for (const path of ['/healthz','/owner/status','/']) assert.doesNotMatch((await api.request(path)).body, /TEST.?1234/);
  await h.finish('connection_failed'); assert.doesNotMatch((await api.request('/owner')).body, /TEST.?1234/);
});
test('stop clears private material and late async render cannot restore it', async () => {
  const h = harness(); h.manager.start('qr'); await tick(); await h.callbacks.renderQR(Buffer.from('fixture')); await h.callbacks.status('waiting_scan');
  await h.manager.stop(); await h.callbacks.renderQR(Buffer.from('late')); await h.callbacks.status('waiting_scan'); await tick();
  assert.equal(h.manager.qr(), undefined); assert.equal(h.manager.code(), ''); assert.equal(h.manager.snapshot().state, 'stopped');
});
test('expiry clears material before delayed transport finishes', async () => {
  let now=100; const h = harness({ now: () => now, timeoutMs: 1000 }); h.manager.start('code', '12345678'); await tick();
  await h.callbacks.renderCode('TEST1234'); await h.callbacks.status('waiting_phone_code'); now +=1001;
  assert.equal(h.manager.code(), ''); assert.equal(h.manager.snapshot().state, 'expired'); await tick(); assert.equal(h.stops, 1);
});
test('cancel while transport factory loading stops socket before any secret render', async () => {
  let finishLoad, stopped=0; const manager = createWebPairing({ run: () => new Promise(resolve => { finishLoad = resolve; }) });
  manager.start('qr'); await manager.stop(); finishLoad({ stop: async () => { stopped++; }, done: Promise.resolve('stopped') }); await tick(); assert.equal(stopped, 1); assert.equal(manager.qr(), undefined);
});
test('disabled pairing never imports/runs transport or activates bot', async t => {
  const h = harness({ enabled: false }); const api = await setup(t, h.manager);
  assert.equal((await api.post('/owner/start', { mode: 'qr' })).status, 409); assert.equal(h.starts, 0);
  assert.match((await api.request('/owner')).body, /Downloader mode/);
});
test('explicit stop is CSRF-protected and successful pairing never starts another socket', async t => {
  const h = harness(); const api = await setup(t, h.manager); await api.post('/owner/start', { mode: 'qr' });
  assert.equal((await api.request('/owner/stop', { method: 'POST' })).status, 403);
  assert.equal((await api.post('/owner/stop')).status, 303); await tick(); assert.equal(h.stops, 1); assert.equal(h.starts, 1);
});
test('failed pairing clears material without exposing private exception details', async () => {
  const manager = createWebPairing({ run: async () => { throw new Error('fixture-private-detail'); } });
  manager.start('qr'); await tick(); assert.deepEqual(manager.snapshot(), { state: 'pairing_failed', active: false, reasonCode: undefined, pairingAllowed: true }); assert.equal(manager.qr(), undefined);
});
test('auth directory lock is private, exclusive and released without deleting sessions', async t => {
  const dir = await mkdtemp(join(tmpdir(),'nandhana-lock-')); t.after(() => rm(dir, { recursive:true, force:true }));
  await mkdir(join(dir,'session-preserved')); const release = await acquireAuthLock(dir);
  assert.equal((await stat(join(dir,'.session.lock'))).mode & 0o777, 0o600); await assert.rejects(acquireAuthLock(dir));
  await release(); await release(); const second = await acquireAuthLock(dir); await second(); assert.ok((await stat(join(dir,'session-preserved'))).isDirectory());
});

test('browser material has nonce-authorized hard expiry, without external scripts', async t => {
  const h = harness(); const api = await setup(t, h.manager); await api.post('/owner/start', { mode: 'qr' });
  await h.callbacks.renderQR(Buffer.from('fixture')); await h.callbacks.status('waiting_scan');
  const response = await api.request('/owner');
  assert.match(response.headers['content-security-policy'], /script-src 'nonce-/);
  assert.match(response.body, /setTimeout.*replaceChildren/); assert.match(response.body, /pagehide/);
  assert.doesNotMatch(response.body, /script src=/); await h.manager.stop();
});
test('callbacks from finished attempt cannot restore material in a later attempt', async () => {
  const h = harness(); h.manager.start('qr'); await tick(); const old = h.callbacks;
  await h.finish('connection_failed'); h.manager.start('qr'); await tick();
  await old.renderQR(Buffer.from('stale')); await old.status('waiting_scan');
  assert.equal(h.manager.qr(), undefined); assert.equal(h.manager.snapshot().state, 'preparing'); await h.manager.stop();
});
test('disabled web entrypoint serves health without auth files or WhatsApp startup', async t => {
  const dir = await mkdtemp(join(tmpdir(),'nandhana-web-offline-')); t.after(() => rm(dir,{recursive:true,force:true}));
  const probe = http.createServer(); await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve)); const port=probe.address().port; await new Promise(resolve=>probe.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/web-main.js',import.meta.url))], {
    cwd: dir, env: { ...process.env, ...fixtureEnv, PORT:String(port), BOT_ENABLED:'false', AUTH_DIR:'auth' }, stdio:['ignore','ignore','pipe']
  });
  let privateError=''; child.stderr.on('data', chunk=>{privateError+=chunk});
  t.after(()=>{ if (child.exitCode===null) child.kill('SIGTERM'); });
  let response;
  for (let i=0;i<100;i++) {
    try { response = await new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port,path:'/healthz'},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject)}); break; }
    catch { await new Promise(resolve=>setTimeout(resolve,10)); }
  }
  assert.equal(response,200); assert.equal(privateError,'');
  await assert.rejects(stat(join(dir,'auth')), { code:'ENOENT' });
  child.kill('SIGTERM'); const [code]=await once(child,'exit'); assert.equal(code,0);
});

test('owner HTML form submits exact-origin CSRF-protected fields to mock pairing', async t => {
  const h = harness(); const api = await setup(t, h.manager);
  const page = await api.request('/owner');
  assert.equal(page.headers['referrer-policy'], 'same-origin');
  const form = page.body.match(/<form method="post" action="\/owner\/start">([\s\S]*?)<\/form>/)[1];
  assert.equal((form.match(/name="csrf"/g) || []).length, 1);
  const csrf = form.match(/name="csrf" value="([a-f0-9]+)"/)[1];
  assert.match(form, /<option value="qr">/);
  const result = await api.request('/owner/start', {
    method: 'POST', headers: { cookie: page.headers['set-cookie'][0].split(';')[0], origin: config.origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, mode: 'qr', phone: '' }).toString()
  });
  assert.equal(result.status, 303); assert.equal(result.headers.location, '/owner');
  assert.equal(h.starts, 1); assert.equal(h.callbacks.mode, 'qr'); await h.manager.stop();
});
test('non-HTML routes and errors retain no-referrer policy', async t => {
  const h = harness(); const api = await setup(t, h.manager);
  for (const route of ['/', '/healthz', '/owner/status', '/owner/qr.png', '/not-found']) {
    assert.equal((await api.request(route)).headers['referrer-policy'], 'no-referrer');
  }
  assert.equal((await api.request('/owner', { auth: false })).headers['referrer-policy'], 'no-referrer');
});

test('minimal owner screen is responsive, accessible and self-contained', async t => {
  const h = harness(); const api = await setup(t, h.manager); const page = await api.request('/owner');
  assert.match(page.body, /name="viewport"/); assert.match(page.body, /<html lang="en">/);
  assert.match(page.body, /<label for="method">/); assert.match(page.body, /id="method" name="mode"/);
  assert.match(page.body, /<label for="phone">/); assert.match(page.body, /aria-describedby="phone-hint"/);
  assert.match(page.body, /:focus-visible/); assert.match(page.body, /prefers-reduced-motion/);
  assert.match(page.body, /Nandhana/); assert.match(page.body, /Pinterest downloader/);
  assert.doesNotMatch(page.body, /<script[^>]+src=|<link[^>]+href=|@import|https?:\/\//);
  assert.doesNotMatch(page.body, /class="code"|class="qr"/);
});

test('npm run start serves health in disabled Postgres mode without connecting or creating auth',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'nandhana-postgres-start-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const entry=fileURLToPath(new URL('../src/web-main.js',import.meta.url));
 await writeFile(join(dir,'package.json'),JSON.stringify({name:'nandhana-isolated-start-test',version:'0.0.0',scripts:{start:`node --env-file-if-exists=.env ${entry}`}}));
 const child=spawn('npm',['run','start'],{cwd:dir,detached:true,env:{PATH:process.env.PATH,...fixtureEnv,PORT:String(port),BOT_ENABLED:'false',AUTH_STORE:'postgres',SESSION_ID:'synthetic-start',AUTH_ENCRYPTION_KEY:'ab'.repeat(32),DATABASE_URL:'postgres://synthetic:fixture@127.0.0.1:1/synthetic?sslmode=require',AUTH_DIR:join(dir,'untouched-auth')},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 t.after(()=>{try{process.kill(-child.pid,'SIGTERM')}catch{}});
 let response;
 for(let i=0;i<300;i++){
  try{response=await new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port,path:'/healthz'},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject)});break}catch{await new Promise(resolve=>setTimeout(resolve,10))}
 }
 assert.equal(response,200);assert.doesNotMatch(logs,/startup refused|fixture@|encryption/i);
 await assert.rejects(stat(join(dir,'untouched-auth')),{code:'ENOENT'});
 const exited=once(child,'exit');process.kill(-child.pid,'SIGTERM');await exited;
});
