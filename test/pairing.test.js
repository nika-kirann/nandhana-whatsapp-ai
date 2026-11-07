import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPairing, pairSocketOptions, hasLinkedIdentity } from '../src/pairing.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, extra = {}) {
  const sockets=[], states=[], rendered=[];let cleared=0,saved=0;
  const auth={creds:{registered:false}};
  const pairing=createPairing({auth,saveCreds:async()=>saved++,renderQR:async()=>rendered.push(true),clearQR:async()=>cleared++,status:async(state,code)=>states.push({state,code}),makeSocket:options=>{const socket={ev:new EventEmitter(),options,end:()=>{}};sockets.push(socket);return socket;},...extra});
  t.after(()=>pairing.stop());return {pairing,sockets,states,auth,rendered,saved:()=>saved,cleared:()=>cleared};
}
test('auth socket options disable history, initial queries, presence and all chat JIDs',async()=>{
  const o=pairSocketOptions({},{});assert.equal(o.syncFullHistory,false);assert.equal(o.shouldSyncHistoryMessage({}),false);assert.equal(o.shouldIgnoreJid('anything'),true);assert.equal(o.fireInitQueries,false);assert.equal(o.markOnlineOnConnect,false);assert.equal(o.emitOwnEvents,false);assert.equal(o.printQRInTerminal,false);assert.equal(await o.getMessage({}),undefined);
});
test('QR material only goes to renderer; status has no secrets; no message listener',async t=>{
  const f=fixture(t);await tick();f.sockets[0].ev.emit('connection.update',{qr:'mock-secret-not-a-real-qr'});await tick();assert.equal(f.rendered.length,1);assert.equal(f.states.at(-1).state,'waiting_scan');assert.ok(!JSON.stringify(f.states).includes('mock-secret'));assert.deepEqual(f.sockets[0].ev.eventNames().sort(),['connection.update','creds.update']);
});
test('successful pairing saves auth then closes and removes QR',async t=>{
  const f=fixture(t);await tick();f.auth.creds.me={id:'fixture-identity'};f.sockets[0].ev.emit('creds.update',{});f.sockets[0].ev.emit('connection.update',{connection:'open'});assert.equal(await f.pairing.done,'paired');assert.equal(f.saved(),1);assert.equal(f.cleared(),1);
});
test('only one required post-scan restart permitted, no reconnect loop',async t=>{
  const f=fixture(t);await tick();f.auth.creds.me={id:'fixture-identity'};
  const close={connection:'close',lastDisconnect:{error:{output:{statusCode:515}}}};
  f.sockets[0].ev.emit('connection.update',close);await tick();assert.equal(f.sockets.length,2);
  f.sockets[1].ev.emit('connection.update',close);assert.equal(await f.pairing.done,'connection_failed');assert.equal(f.sockets.length,2);
});
test('network/block disconnect stops immediately without retry',async t=>{
  const f=fixture(t);await tick();f.sockets[0].ev.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:403},message:'private'}}});assert.equal(await f.pairing.done,'connection_failed');assert.equal(f.sockets.length,1);assert.equal(f.states.at(-1).code,403);
});
test('bounded runtime clears QR and exits expired',async t=>{const f=fixture(t,{timeoutMs:5});assert.equal(await f.pairing.done,'expired');assert.equal(f.cleared(),1);});
test('QR rotations are bounded and stop clears private QR',async t=>{
  const f=fixture(t,{maxQRs:1});await tick();f.sockets[0].ev.emit('connection.update',{qr:'one'});await tick();f.sockets[0].ev.emit('connection.update',{qr:'two'});assert.equal(await f.pairing.done,'qr_limit');assert.equal(f.rendered.length,1);assert.equal(f.cleared(),1);
});
test('save failure is generic and never reveals exception details',async t=>{
  const f=fixture(t,{saveCreds:async()=>{throw new Error('private-session');}});await tick();f.sockets[0].ev.emit('creds.update',{});assert.equal(await f.pairing.done,'storage_failed');assert.ok(!JSON.stringify(f.states).includes('private-session'));
});
test('pair CLI refuses missing explicit approval before importing WhatsApp or creating files',async()=>{
  const {spawnSync}=await import('node:child_process');const {existsSync}=await import('node:fs');
  const child=spawnSync(process.execPath,['src/pair-cli.js'],{env:{PATH:process.env.PATH},encoding:'utf8'});assert.equal(child.status,1);assert.equal(child.stdout,'');assert.equal(child.stderr,'');
});
test('pair CLI refuses bot-enabled state',async()=>{
  const {spawnSync}=await import('node:child_process');const child=spawnSync(process.execPath,['src/pair-cli.js','--owner-approved'],{env:{PATH:process.env.PATH,BOT_ENABLED:'true'},encoding:'utf8'});assert.equal(child.status,1);assert.equal(child.stdout,'');assert.equal(child.stderr,'');
});

test('QR identity is valid even when registered remains false; flag alone is insufficient',()=>{
  assert.equal(hasLinkedIdentity({registered:false,me:{id:'fixture-identity'}}),true);
  assert.equal(hasLinkedIdentity({registered:true}),false);
  assert.equal(hasLinkedIdentity({me:{}}),false);
});
test('open without linked identity fails safely, regardless of registered flag',async t=>{
  const f=fixture(t);await tick();f.auth.creds.registered=true;
  f.sockets[0].ev.emit('connection.update',{connection:'open'});
  assert.equal(await f.pairing.done,'auth_identity_missing');
});
test('saved QR session with registered false verifies without requiring fresh scan',async t=>{
  const auth={creds:{registered:false,me:{id:'fixture-identity'}}};
  const f=fixture(t,{auth});await tick();f.sockets[0].ev.emit('connection.update',{connection:'open'});
  assert.equal(await f.pairing.done,'paired');assert.equal(f.rendered.length,0);assert.equal(f.sockets.length,1);
});
