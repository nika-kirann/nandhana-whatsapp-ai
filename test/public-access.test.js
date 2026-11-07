import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../src/handler.js';
import {readConfig} from '../src/config.js';
const owner='12345678',own=owner+'@s.whatsapp.net',a='87654321@s.whatsapp.net',b='87654320@lid';
const pin='https://www.pinterest.com/pin/123/';let counter=0;
const message=(jid,text,extra={})=>({key:{id:String(++counter),remoteJid:jid,...extra},message:{conversation:text}});
function fixture(t,{config={},...adapters}={}){
 const sends=[],media=[],downloads=[];
 const h=createHandler({...readConfig({PUBLIC_ACCESS:'true',OWNER_NUMBER:owner},{activated:true}),rateLimit:60,...config},{
  downloader:{download:async url=>{downloads.push(url);return {type:'image',cleanup:async()=>{}};}},send:async(jid,text)=>sends.push({jid,text}),sendMedia:async jid=>media.push(jid),...adapters
 });t.after(()=>h.close());return {h,sends,media,downloads,handle:(jid,text,extra)=>h.handle(message(jid,text,extra))};
}
test('public activation needs explicit mode and valid owner; restricted mode still needs allowlist',()=>{
 assert.equal(readConfig({}).publicAccess,false);
 for(const env of [{PUBLIC_ACCESS:'true'},{PUBLIC_ACCESS:'yes'},{PUBLIC_ACCESS:'true',OWNER_NUMBER:'invalid'},{PUBLIC_ACCESS:'true',OWNER_NUMBER:'+12345678'},{}])assert.throws(()=>readConfig(env,{activated:true}));
 const c=readConfig({PUBLIC_ACCESS:'true',OWNER_NUMBER:owner},{activated:true});assert.equal(c.allowedChats.size,0);assert.equal(c.publicAccess,true);
});
test('any direct PN/LID user can opt in publicly, opt out, and cannot download before consent',async t=>{
 const f=fixture(t);await f.handle(a,pin);assert.equal(f.downloads.length,0);await f.handle(a,'.start');await f.handle(a,pin);await f.handle(b,'.start');await f.handle(b,pin);assert.deepEqual(f.media,[a,b]);await f.handle(a,'.stop');await f.handle(a,pin);assert.equal(f.downloads.length,2);
});
test('only canonical owner PN controls; text/profile/alternate-number/forged LID claims cannot administer',async t=>{
 const f=fixture(t);
 for(const jid of [a,b,owner+'@lid']){
  const m=message(jid,'.bot pause',{senderPn:own,remoteJidAlt:own,participantPn:own});m.pushName=owner;m.verifiedBizName=owner;await f.h.handle(m);
  await f.handle(jid,'.owner help');
 }
 await f.handle(own,'.bot pause',{participant:a});assert.equal(f.h.snapshot().paused,false);assert.equal(f.sends.length,0);
 await f.handle(own,'.bot pause');assert.equal(f.h.snapshot().paused,true);assert.equal(f.sends.length,1);
 assert.ok(!JSON.stringify(f.h.snapshot()).includes(owner));
});
test('owner can pause/resume/status without public consent and despite full chat capacity; access remains configured',async t=>{
 const f=fixture(t,{config:{maxChats:1}});await f.handle(a,'.start');await f.handle(own,'.bot pause');await f.handle(a,pin);assert.equal(f.downloads.length,0);await f.handle(own,'.bot status');assert.match(f.sends.at(-1).text,/paused/);await f.handle(own,'.bot resume');await f.handle(a,pin);assert.equal(f.media.length,1);await f.handle(own,'.owner help');assert.match(f.sends.at(-1).text,/\.bot pause/);
 const restricted=fixture(t,{config:{publicAccess:false,allowedChats:new Set([a])}});await restricted.handle(own,'.bot resume');await restricted.handle(b,'.start');await restricted.handle(b,pin);assert.equal(restricted.media.length,0);
});
test('pause suppresses attachment after an in-flight download and persists before resume acknowledgment',async t=>{
 let release,ready;const started=new Promise(resolve=>ready=resolve);let cleaned=0;const saved=[];
 const f=fixture(t,{persistPaused:async paused=>saved.push(paused),controlPersistence:'postgres',downloader:{download:()=>{ready();return new Promise(resolve=>release=()=>resolve({cleanup:async()=>cleaned++}));}}});
 await f.handle(a,'.start');const downloading=f.handle(a,pin);await started;await f.handle(own,'.bot pause');release();await downloading;assert.equal(f.media.length,0);assert.equal(cleaned,1);await f.handle(own,'.bot resume');assert.deepEqual(saved,[true,false]);
});
test('control persistence failure pauses fail-closed without leaking raw errors',async t=>{
 const f=fixture(t,{persistPaused:async()=>{throw new Error('PRIVATE-FIXTURE-ERROR');}});await f.handle(own,'.bot resume');assert.equal(f.h.snapshot().paused,true);assert.equal(f.h.snapshot().controlError,true);assert.ok(!JSON.stringify(f.sends).includes('PRIVATE-FIXTURE'));await f.handle(a,'.start');await f.handle(a,pin);assert.equal(f.media.length,0);
});
test('public rate limits are per-user; groups/status/broadcast/own loops stay ignored',async t=>{
 const f=fixture(t,{config:{rateLimit:2}});await f.handle(a,'.start');await f.handle(a,pin);await f.handle(a,pin);await f.handle(b,'.start');await f.handle(b,pin);assert.equal(f.downloads.length,2);
 for(const jid of ['123@g.us','status@broadcast','123@broadcast','123@newsletter'])await f.handle(jid,'.start');await f.handle(own,'.bot pause',{fromMe:true});const broadcast=message(own,'.bot pause');broadcast.broadcast=true;await f.h.handle(broadcast);assert.equal(f.h.snapshot().paused,false);
 await f.handle(a,'.stop');assert.match(f.sends.at(-1).text,/stop|നിർത്ത|opt|Stopped/i);
});
test('owner ordinary downloads still require consent; saved initial pause applies before any media',async t=>{
 const f=fixture(t,{initialPaused:true});await f.handle(own,pin);assert.equal(f.downloads.length,0);await f.handle(own,'.start');await f.handle(own,pin);assert.equal(f.downloads.length,0);await f.handle(own,'.bot resume');await f.handle(own,pin);assert.equal(f.downloads.length,1);
});
test('owner commands are deduplicated and independently rate bounded',async t=>{
 let writes=0;const f=fixture(t,{persistPaused:async()=>writes++});const m=message(own,'.bot pause');await f.h.handle(m);await f.h.handle(m);assert.equal(writes,1);
 for(let i=0;i<10;i++)await f.handle(own,'.bot status');assert.equal(f.sends.length,6);
});
test('dot-only user commands grant/revoke consent and help advertises unchanged Pinterest URLs',async t=>{
 const f=fixture(t);await f.handle(a,'.help');assert.match(f.sends.at(-1).text,/\.help/);assert.match(f.sends.at(-1).text,/\.reset/);assert.match(f.sends.at(-1).text,/https:\/\/www\.pinterest\.com\/pin\/<id>\//);
 await f.handle(a,'/start');await f.handle(a,'.start extra');await f.handle(a,pin);assert.equal(f.downloads.length,0);
 await f.handle(a,'.start');await f.handle(a,pin);assert.equal(f.downloads.length,1);
 await f.handle(a,'.reset');await f.handle(a,pin);assert.equal(f.downloads.length,1);
 await f.handle(a,'.start');await f.handle(a,'.stop');await f.handle(a,pin);assert.equal(f.downloads.length,1);
});
test('ordinary dots, URL dots and command-like substrings cannot invoke owner or consent controls',async t=>{
 const f=fixture(t);await f.handle(a,'.start');
 for(const text of ['hello.world','.start.extra','text .help','x.bot pause']){await f.handle(a,text);assert.match(f.sends.at(-1).text,/Please send just one HTTPS Pinterest Pin link/);}
 await f.handle(a,pin);assert.equal(f.downloads.length,1);
 for(const text of ['/bot pause','.botanical pause','text .bot pause'])await f.handle(own,text);
 assert.equal(f.h.snapshot().paused,false);
 await f.handle(a,'.bot pause');assert.equal(f.h.snapshot().paused,false);
 await f.handle(own,'.bot pause');assert.equal(f.h.snapshot().paused,true);
 await f.handle(own,'.bot resume');assert.equal(f.h.snapshot().paused,false);
});
