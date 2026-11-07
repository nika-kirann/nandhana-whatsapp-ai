import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createOwnerRuntime} from '../src/owner-runtime.js';
import {runSelfNotice} from '../src/session-notice.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(env={}){
 let finish,options,starts=0,sends=0,stops=0;
 const runtime=createOwnerRuntime({env,makeId:()=> 'synthetic-generated-session',runPair:async o=>{options=o;return {done:new Promise(r=>finish=r),stop:async()=>finish('stopped')};},startBot:async o=>{starts++;o.onConnection();return {stop:async()=>{stops++;o.onStopped();}};},sendNotice:async()=>{sends++;return 'sent';}});
 return {runtime,get options(){return options;},get starts(){return starts;},get sends(){return sends;},get stops(){return stops;},finish:async o=>{finish(o);await tick();}};
}
test('unselected startup is idle, generates isolated ID only on owner pairing, reveals only saved success',async()=>{
 const h=harness();assert.equal(h.options,undefined);assert.equal(h.runtime.snapshot().sessionId,undefined);assert.equal(await h.runtime.activate(),false);assert.equal(await h.runtime.notify(),false);
 assert.equal(h.runtime.start('qr'),true);await tick();assert.equal(h.options.allowCreate,true);assert.equal(h.options.newSession,true);assert.equal(h.runtime.snapshot().sessionId,undefined);
 assert.equal(await h.runtime.activate(),false);await h.finish('paired');assert.equal(h.runtime.snapshot().sessionId,'synthetic-generated-session');assert.equal(h.starts,0);assert.equal(h.sends,0);
 assert.equal(await h.runtime.notify(),true);assert.equal(await h.runtime.notify(),false);assert.equal(h.sends,1);
 assert.equal(await h.runtime.activate(),true);assert.equal(await h.runtime.activate(),false);assert.equal(h.starts,1);assert.equal(h.runtime.start('qr'),false);assert.equal(await h.runtime.notify(),false);
 await h.runtime.deactivate();assert.equal(h.stops,1);await h.runtime.close();
});
test('failed pairing never reveals ID; configured selection is never created or autoactivated',async()=>{
 const h=harness({SESSION_ID:'existing-session'});assert.equal(h.starts,0);assert.equal(h.runtime.snapshot().sessionId,undefined);h.runtime.start('qr');await tick();assert.equal(h.options.env.SESSION_ID,'existing-session');assert.equal(h.options.allowCreate,false);await h.finish('storage_failed');assert.equal(h.runtime.snapshot().sessionId,undefined);assert.equal(await h.runtime.notify(),false);await h.runtime.close();
});
test('activation failures remain idle and report safe actionable state',async()=>{
 const r=createOwnerRuntime({env:{SESSION_ID:'fixture'},startBot:async()=>{throw new Error('PRIVATE-NEVER-EXPOSE');}});assert.equal(await r.activate(),true);assert.equal(r.snapshot().activationError,true);assert.ok(!JSON.stringify(r.snapshot()).includes('PRIVATE'));await r.close();
});
function noticeFixture(extra={}){
 const ev=new EventEmitter(),sends=[],statuses=[];let claimed=false,ends=0;
 const storage={state:{creds:{me:{id:'123@s.whatsapp.net'}}},assertActive(){},guard:async()=>{},saveCreds:async()=>{},claimNotice:async()=>claimed?{claimed:false,status:statuses.at(-1)||'attempting'}:(claimed=true,{claimed:true}),finishNotice:async s=>{statuses.push(s);}};
 const socket={ev,user:{id:'123@s.whatsapp.net'},sendMessage:async(...args)=>{sends.push(args);},end:()=>ends++};
 const args={storage,sessionId:'synthetic-id',makeSocket:()=>socket,normalizeJid:x=>x,timeoutMs:1000,...extra};
 return {args,storage,socket,sends,statuses,get ends(){return ends;},ev};
}
test('confirmed notice sends only ID to verified own JID, at most once across repeated opens/reconnections',async()=>{
 const h=noticeFixture();const done=runSelfNotice(h.args);await tick();assert.deepEqual(h.ev.eventNames().sort(),['connection.update','creds.update']);h.ev.emit('connection.update',{connection:'open'});h.ev.emit('connection.update',{connection:'open'});assert.equal(await done,'sent');assert.deepEqual(h.sends,[['123@s.whatsapp.net',{text:'Nandhana session ID: synthetic-id'}]]);assert.equal(h.ends,1);assert.equal(await runSelfNotice(h.args),'sent');assert.equal(h.sends.length,1);
});
test('notice refuses mismatched identity, stale lease and absent durable claim support',async()=>{
 const h=noticeFixture();h.socket.user.id='456@s.whatsapp.net';let done=runSelfNotice(h.args);await tick();h.ev.emit('connection.update',{connection:'open'});assert.equal(await done,'failed');assert.equal(h.sends.length,0);
 const b=noticeFixture();b.storage.guard=async()=>{throw new Error();};done=runSelfNotice(b.args);await tick();b.ev.emit('connection.update',{connection:'open'});assert.equal(await done,'failed');assert.equal(b.sends.length,0);
 const c=noticeFixture();delete c.storage.claimNotice;assert.equal(await runSelfNotice(c.args),'unavailable');
});
test('uncertain delivery and timeout never retry; abort closes auth socket without sending',async()=>{
 const h=noticeFixture();h.socket.sendMessage=async()=>{h.sends.push('attempt');throw new Error();};const done=runSelfNotice(h.args);await tick();h.ev.emit('connection.update',{connection:'open'});assert.equal(await done,'unknown');assert.equal(await runSelfNotice(h.args),'already_attempted');assert.equal(h.sends.length,1);
 const b=noticeFixture({timeoutMs:5});assert.equal(await runSelfNotice(b.args),'failed');assert.equal(b.ends,1);
 const controller=new AbortController(),c=noticeFixture({signal:controller.signal});const pending=runSelfNotice(c.args);await tick();controller.abort();assert.equal(await pending,'failed');assert.equal(c.sends.length,0);assert.equal(c.ends,1);
});
test('independent new pairings get unique nonsecret UUIDs, never a shared default session',async()=>{
 const ids=[],managers=[];
 for(let i=0;i<2;i++){
  const r=createOwnerRuntime({env:{},runPair:async({env})=>{ids.push(env.SESSION_ID);return {done:Promise.resolve('pairing_failed'),stop:async()=>{}};}});managers.push(r);r.start('qr');
 }
 await tick();assert.equal(new Set(ids).size,2);for(const id of ids)assert.match(id,/^[0-9a-f-]{36}$/);for(const r of managers)await r.close();
});
test('shutdown waits for an in-progress owner activation and stops its socket instead of retaining it',async()=>{
 let release,stopped=false;
 const r=createOwnerRuntime({env:{SESSION_ID:'fixture'},startBot:()=>new Promise(resolve=>{release=()=>resolve({stop:async()=>{await tick();stopped=true;}});})});
 const activating=r.activate();const closing=r.close();release();await activating;await closing;assert.equal(stopped,true);assert.equal(r.snapshot().pairingAllowed,false);
});
test('protected runtime diagnostics expose mode/pause/session selection but never owner contact or secrets',async()=>{
 const env={SESSION_ID:'fixture-selected',PUBLIC_ACCESS:'true',OWNER_NUMBER:'12345678',WEB_OWNER_PASSWORD:'PRIVATE-FIXTURE-NEVER-EXPOSE'};
 const r=createOwnerRuntime({env,startBot:async o=>{o.onConnection();return {snapshot:()=>({publicAccess:true,paused:true,controlPersistence:'postgres',controlError:false}),stop:async()=>o.onStopped()};}});
 await r.activate();const s=r.snapshot();assert.equal(s.publicAccess,true);assert.equal(s.ownerConfigured,true);assert.equal(s.hasSelectedSession,true);assert.equal(s.downloader,'running');assert.equal(s.controls.paused,true);assert.ok(!JSON.stringify(s).includes(env.OWNER_NUMBER));assert.ok(!JSON.stringify(s).includes(env.WEB_OWNER_PASSWORD));await r.close();
});
