import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFile, stat } from 'node:fs/promises';
import { validateUrl, isPublicIP, makeLookup, createTransport } from '../src/network.js';
import { extractMedia, createDownloader, readPage, validMagic } from '../src/pinterest.js';
import { readConfig } from '../src/config.js';
import { createHandler, incoming } from '../src/handler.js';
import { copy } from '../src/copy.js';
const pin = 'https://www.pinterest.com/pin/123/';
const image = 'https://i.pinimg.com/originals/example.jpg';
const video = 'https://v1.pinimg.com/videos/example.mp4';
const ld = object => `<script type="application/ld+json">${JSON.stringify(object)}</script>`;
const imagePage = ld({ '@type': 'SocialMediaPosting', image, mainEntityOfPage: { '@id': pin } });
const videoPage = ld({ '@type': 'VideoObject', '@id': pin, contentUrl: video });
const jpg = Buffer.from([255,216,255,1,2,3,4,5]);
const mp4 = Buffer.from('0000ftypisom0000');
const response = (body = '', headers = {}, status = 200) => ({ status, headers, body: Readable.from([Buffer.from(body)]) });
function transportFor(routes, options) {
  const calls = [];
  const transport = createTransport({ open: async url => { calls.push(url.href); return routes(url, calls.length); }, ...options });
  return { transport, calls };
}
const config = () => ({ ...readConfig({}), enabled: true, allowedChats: new Set(['123@s.whatsapp.net']), rateLimit: 60 });
let id = 0;
const message = text => ({ key: { id: String(++id), remoteJid: '123@s.whatsapp.net' }, message: { conversation: text } });
function botFixture(t, options = {}) {
  const sends = [], mediaSends = [], calls = [], logs = []; let cleaned = 0;
  const bot = createHandler({ ...config(), ...options.config }, {
    downloader: { download: async value => { calls.push(value); return { path: 'mock', type: 'image', cleanup: async () => cleaned++ }; }, ...options.downloader },
    send: async (_, text) => sends.push(text), sendMedia: async (_, media) => mediaSends.push(media.type), log: label => logs.push(label), ...options.adapters
  });
  t.after(() => bot.close());
  return { bot, sends, mediaSends, calls, logs, cleaned: () => cleaned, start: () => bot.handle(message('.start')) };
}
test('disabled Nandhana config needs no AI settings', () => { assert.equal(readConfig({}).name, 'Nandhana'); assert.equal(readConfig({}).enabled, false); assert.equal(readConfig({ ALLOWED_CHATS: '123@lid' },{activated:true}).enabled, true); });
test('activation requires allowlist and validated limits', () => { for (const env of [{}, { MAX_MEDIA_BYTES: '90000000' }, { DOWNLOAD_TIMEOUT_MS: '-1' }, { ALLOWED_CHATS: '1@g.us' }]) assert.throws(() => readConfig(env,{activated:true})); });
test('accept numeric Pin and shortlink URLs', () => { for (const url of [pin, 'https://pinterest.com/pin/123', 'https://pin.it/Abc123?utm=x']) assert.ok(validateUrl(url)); });
for (const url of ['http://pinterest.com/pin/123/', 'https://pinterest.com.evil.test/pin/123/', 'https://user:pass@pinterest.com/pin/123/', 'https://pinterest.com:8443/pin/123/', 'https://127.0.0.1/pin/123/', 'https://pinterest.com/board/', 'https://pinterest.com/pin/abc/', 'https://pin.it/a/b', 'https://pinterest.com/pin/123/#x', pin + '\n', pin + ' ' + pin]) {
  test(`reject unsafe input ${JSON.stringify(url)}`, () => assert.throws(() => validateUrl(url)));
}
test('media exact hosts/extensions only', () => {
  for (const url of ['https://i.pinimg.com.evil.test/a.jpg', 'https://evil.test/a.jpg', 'http://i.pinimg.com/a.jpg', 'https://i.pinimg.com/a.svg', 'https://v1.pinimg.com/a.m3u8', 'https://i.pinimg.com:444/a.jpg']) assert.throws(() => validateUrl(url, 'media'));
});
test('private, reserved and IPv4-mapped IPv6 addresses rejected', () => {
  for (const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.0.1','169.254.169.254','0.0.0.0','100.64.0.1','224.0.0.1','::1','::','fc00::1','fe80::1','::ffff:8.8.8.8','2001:db8::1']) assert.equal(isPublicIP(ip), false, ip);
  assert.equal(isPublicIP('8.8.8.8'), true); assert.equal(isPublicIP('2606:4700:4700::1111'), true);
});
test('DNS lookup pins checked address and rejects mixed public/private answers', async () => {
  const run = records => new Promise((resolve, reject) => makeLookup(async () => records)('i.pinimg.com', {}, (e, address) => e ? reject(e) : resolve(address)));
  assert.equal(await run([{ address: '8.8.8.8', family: 4 }]), '8.8.8.8');
  await assert.rejects(run([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]));
});
test('extract schema image and direct MP4 fixtures', () => { assert.deepEqual(extractMedia(imagePage, pin), { type: 'image', url: image }); assert.deepEqual(extractMedia(videoPage, pin), { type: 'video', url: video }); });
test('OG video takes priority over image', () => { assert.equal(extractMedia(`<meta property="og:video" content="${video}">${imagePage}`, pin).type, 'video'); });
test('explicit OG image allowed; ambiguous OG thumbnail refused', () => {
  const og = `<meta property="og:image" content="${image}">`;
  assert.throws(() => extractMedia(og, pin)); assert.equal(extractMedia(og + '<meta property="pinterest:media" content="image">', pin).type, 'image');
});
test('HLS-only and empty VideoObject never silently fall back to image', () => {
  for (const html of [ld({ '@type': 'VideoObject' }), '<script>"video_list":{}</script>', '<video src="https://v1.pinimg.com/a.m3u8"></video>']) assert.throws(() => extractMedia(html + imagePage, pin));
});
test('malicious media, mismatched pin and restricted page rejected', () => {
  for (const html of [ld({ '@type': 'VideoObject', contentUrl: 'https://evil.test/a.mp4' }), '<meta property="og:url" content="https://www.pinterest.com/pin/999/">' + imagePage, '<title>Access denied</title>' + imagePage, '<script type="application/ld+json">bad</script>']) assert.throws(() => extractMedia(html, pin));
});
test('shortlink redirect fixture validated then image returned', async () => {
  const f = transportFor((url, n) => n === 1 ? response('', { location: pin }, 302) : response(imagePage, { 'content-type': 'text/html' }));
  const result = await f.transport.consume('https://pin.it/ABC', 'page', async (res, url) => extractMedia(await readPage(res), url.href)); assert.equal(result.type, 'image'); assert.equal(f.calls.length, 2); f.transport.close();
});
for (const target of ['http://www.pinterest.com/pin/123/', 'https://127.0.0.1/a', 'https://evil.test/a', 'https://www.pinterest.com/login/']) {
  test(`redirect target blocked ${target}`, async () => { const f = transportFor(() => response('', { location: target }, 302)); await assert.rejects(f.transport.consume(pin, 'page', () => {})); assert.equal(f.calls.length, 1); f.transport.close(); });
}
test('media redirect cannot leave allowlist', async () => { const f = transportFor(() => response('', { location: 'https://evil.test/a.mp4' }, 302)); await assert.rejects(f.transport.consume(video, 'media', () => {})); assert.equal(f.calls.length, 1); });
test('redirect loops bounded and unresolved shortlinks rejected', async () => {
  const f = transportFor(() => response('', { location: pin }, 302)); await assert.rejects(f.transport.consume(pin, 'page', () => {})); assert.equal(f.calls.length, 4);
  const g = transportFor(() => response(imagePage)); await assert.rejects(g.transport.consume('https://pin.it/ABC', 'page', () => {}));
});
test('403/429 blocks are never retried', async () => { for (const status of [403,429]) { const f = transportFor(() => response('', {}, status)); await assert.rejects(f.transport.consume(pin, 'page', () => {})); assert.equal(f.calls.length, 1); } });
test('compressed or oversized/non-HTML pages refused', async () => {
  await assert.rejects(readPage(response('x', { 'content-type': 'application/json' })));
  await assert.rejects(readPage(response('x'.repeat(101), { 'content-type': 'text/html' }), 100));
  const f = transportFor(() => response('', { 'content-encoding': 'gzip' })); await assert.rejects(f.transport.consume(pin, 'page', () => {}));
});
test('timeout and shutdown abort transport', async () => {
  const open = (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  const a = createTransport({ open, timeout: 5 }); await assert.rejects(a.consume(pin, 'page', () => {}), /aborted/);
  const b = createTransport({ open }); const pending = b.consume(pin, 'page', () => {}); b.close(); await assert.rejects(pending); await assert.rejects(b.consume(pin, 'page', () => {}), /closed/);
});
for (const type of ['image','video']) test(`streamed ${type} fixture downloads and cleans up`, async () => {
  const f = transportFor((url, n) => n === 1 ? response(type === 'image' ? imagePage : videoPage, { 'content-type': 'text/html' }) : response(type === 'image' ? jpg : mp4, { 'content-type': type === 'image' ? 'image/jpeg' : 'video/mp4' }));
  const d = createDownloader({ maxMedia: 100 }, f.transport); const result = await d.download(pin); assert.equal(result.type, type); assert.ok((await readFile(result.path)).length); assert.equal((await stat(result.path)).mode & 0o777, 0o600); await result.cleanup(); await assert.rejects(stat(result.path)); d.close();
});
test('reject media size, HTML disguise, SVG and bad magic', async () => {
  for (const [body, headers] of [[jpg,{ 'content-type':'image/jpeg','content-length':'1000' }], [Buffer.alloc(101),{ 'content-type':'image/jpeg' }], ['<html>',{ 'content-type':'text/html' }], ['svg',{ 'content-type':'image/svg+xml' }], ['not jpeg',{ 'content-type':'image/jpeg' }]]) {
    const f = transportFor((url,n) => n === 1 ? response(imagePage,{ 'content-type':'text/html' }) : response(body,headers)); await assert.rejects(createDownloader({ maxMedia:100 }, f.transport).download(pin));
  }
});
test('PNG/WebP/MP4 signatures checked', () => { assert.equal(validMagic(Buffer.from([137,80,78,71,13,10,26,10]),'image/png'),true); assert.equal(validMagic(Buffer.from('RIFF0000WEBP'),'image/webp'),true); assert.equal(validMagic(mp4,'video/mp4'),true); assert.equal(validMagic(jpg,'video/mp4'),false); });
test('consent/help/start are local; valid input sends image after opt-in and cleanup', async t => {
  const f=botFixture(t); await f.bot.handle(message(pin)); assert.equal(f.calls.length,0); assert.match(f.sends[0],/Nandhana/); await f.start(); await f.bot.handle(message(pin)); assert.equal(f.calls.length,1); assert.deepEqual(f.mediaSends,['image']); assert.equal(f.cleaned(),1);
});
test('stop and reset revoke consent without history or provider calls', async t => {
  const f=botFixture(t); await f.start(); await f.bot.handle(message('.reset')); await f.bot.handle(message(pin)); assert.equal(f.calls.length,0); await f.start(); await f.bot.handle(message('.stop')); await f.bot.handle(message(pin)); assert.equal(f.calls.length,0);
});
test('ignore own/group/status/non-allowlist messages and disabled bot', async t => {
  const f=botFixture(t); for (const remoteJid of ['1@g.us','status@broadcast','999@s.whatsapp.net']) { const m=message('.start');m.key.remoteJid=remoteJid;await f.bot.handle(m); }
  const own=message('.start');own.key.fromMe=true;assert.equal(incoming(own),null);await f.bot.handle(own);assert.equal(f.sends.length,0);
  const g=botFixture(t,{config:{enabled:false}});await g.start();assert.equal(g.sends.length,0);
});
test('rate limits, duplicate IDs and input limits prevent downloads', async t => {
  const f=botFixture(t,{config:{rateLimit:2,maxInput:100}});await f.start();const m=message(pin);await f.bot.handle(m);await f.bot.handle(m);await f.bot.handle(message(pin));assert.equal(f.calls.length,1);await f.bot.handle(message('.stop'));assert.match(f.sends.at(-1),/stopped/);
  const g=botFixture(t,{config:{maxInput:10}});await g.start();await g.bot.handle(message(pin));assert.equal(g.calls.length,0);
});
test('media send failure still cleans local file, generic error only', async t => { const f=botFixture(t,{adapters:{sendMedia:async()=>{throw new Error('PRIVATE_URL');}}});await f.start();await f.bot.handle(message(pin));assert.equal(f.cleaned(),1);assert.deepEqual(f.logs,['download_failed']);assert.ok(!f.sends.join().includes('PRIVATE_URL')); });
test('same-chat serialization, shutdown suppression and cleanup', async t => {
  let release;const gate=new Promise(resolve=>release=resolve);let started;const begin=new Promise(resolve=>started=resolve);let cleaned=0;
  const f=botFixture(t,{downloader:{download:async()=>{started();await gate;return {type:'video',path:'mock',cleanup:async()=>cleaned++};}}});await f.start();const pending=f.bot.handle(message(pin));await begin;const close=f.bot.close();release();await Promise.all([pending,close]);assert.equal(f.mediaSends.length,0);assert.equal(cleaned,1);
});
test('fixed bilingual responses have no AI identity or chat capability', () => { assert.match(copy('Nandhana','help'),/Pinterest/);assert.match(copy('Nandhana','help'),/[\u0d00-\u0d7f]/); });
test('disabled entrypoint creates no auth and needs no provider', async () => { const { execFileSync }=await import('node:child_process');const { existsSync }=await import('node:fs');const hadAuth=existsSync('auth');assert.match(execFileSync(process.execPath,['src/main.js'],{env:{PATH:process.env.PATH},encoding:'utf8'}),/Downloader idle/);assert.equal(existsSync('auth'),hadAuth); });

test('successful video passes video attachment type and cleanup', async t => {
  let cleaned=0;const f=botFixture(t,{downloader:{download:async()=>({type:'video',path:'mock',cleanup:async()=>cleaned++})}});await f.start();await f.bot.handle(message(pin));assert.deepEqual(f.mediaSends,['video']);assert.equal(cleaned,1);
});
test('per-chat queue capped at ten and processes sequentially', async t => {
  let release;const gate=new Promise(resolve=>release=resolve);let calls=0;
  const f=botFixture(t,{downloader:{download:async()=>{calls++;await gate;return {type:'image',path:'mock',cleanup:async()=>{}};}}});await f.start();
  const tasks=Array.from({length:15},()=>f.bot.handle(message(pin)));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);release();await Promise.all(tasks);assert.equal(calls,10);
});
test('global download concurrency capped at two', async t => {
  let release;const gate=new Promise(resolve=>release=resolve);let calls=0;
  const ids=['123@s.whatsapp.net','456@lid','789@lid'];const f=botFixture(t,{config:{allowedChats:new Set(ids)},downloader:{download:async()=>{calls++;await gate;return {type:'image',path:'mock',cleanup:async()=>{}};}}});
  const m=(text,jid)=>{const value=message(text);value.key.remoteJid=jid;return value;};for(const jid of ids)await f.bot.handle(m('.start',jid));
  const tasks=ids.map(jid=>f.bot.handle(m(pin,jid)));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);release();await Promise.all(tasks);
});
test('consent TTL and max chat count remain bounded', async t => {
  let time=0;const f=botFixture(t,{config:{chatTtl:1000,maxChats:1,allowedChats:new Set(['123@s.whatsapp.net','456@lid'])},adapters:{now:()=>time}});await f.start();
  const other=message('.start');other.key.remoteJid='456@lid';await f.bot.handle(other);assert.equal(f.sends.length,1);
  time=1001;await f.bot.handle(message(pin));assert.equal(f.calls.length,0);assert.match(f.sends.at(-1),/opt in/);
});
test('failed streamed download leaves no new temporary directories', async () => {
  const {readdir}=await import('node:fs/promises');const {tmpdir}=await import('node:os');
  const before=new Set((await readdir(tmpdir())).filter(x=>/^nandhana-[A-Za-z0-9]{6}$/.test(x)));
  const f=transportFor((url,n)=>n===1?response(imagePage,{'content-type':'text/html'}):response(Buffer.alloc(101),{'content-type':'image/jpeg'}));
  await assert.rejects(createDownloader({maxMedia:100},f.transport).download(pin));
  const after=(await readdir(tmpdir())).filter(x=>/^nandhana-[A-Za-z0-9]{6}$/.test(x)&&!before.has(x));assert.deepEqual(after,[]);
});
test('global pending queue is capped at one hundred', async t => {
  const ids=Array.from({length:105},(_,i)=>`${1000+i}@lid`);const f=botFixture(t,{config:{allowedChats:new Set(ids),maxChats:200}});
  await Promise.all(ids.map(jid=>{const m=message('.start');m.key.remoteJid=jid;return f.bot.handle(m);}));assert.equal(f.sends.length,100);
});
