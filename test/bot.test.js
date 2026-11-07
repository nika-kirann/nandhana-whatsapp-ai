import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { persona, copy } from '../src/persona.js';
import { incoming, createHandler } from '../src/handler.js';
import { createAI } from '../src/ai.js';

const jid = '123@s.whatsapp.net';
const config = (extra = {}) => ({ ...readConfig(), enabled: true, allowedChats: new Set([jid, '456@lid']), rateLimit: 60, ...extra });
let nextId = 0;
const message = (text = 'hello', extra = {}) => ({ key: { id: String(++nextId), remoteJid: jid, fromMe: false, ...extra }, message: { conversation: text } });
function fixture(t, options = {}) {
  const sends = [], calls = [], logs = [];
  const bot = createHandler(config(options.config), {
    ai: { complete: async messages => { calls.push(structuredClone(messages)); return options.answer || 'Hello!'; }, ...options.ai },
    send: async (to, text) => { sends.push({ to, text }); },
    log: event => logs.push(event), ...options.adapters
  });
  t.after(() => bot.close());
  return { bot, sends, calls, logs, start: () => bot.handle(message('/start')) };
}
test('disabled safe defaults and Nandhana default', () => {
  const c = readConfig({}); assert.equal(c.enabled, false); assert.equal(c.name, 'Nandhana'); assert.equal(c.allowedChats.size, 0);
});
test('activation requires allowlist and provider configuration', () => {
  assert.throws(() => readConfig({ BOT_ENABLED: 'true' }), /ALLOWED_CHATS/);
  assert.throws(() => readConfig({ BOT_ENABLED: 'true', ALLOWED_CHATS: jid }), /AI_MODEL/);
});
test('config rejects invalid limits, flags and group allowlisting', () => {
  for (const env of [{ MAX_INPUT_CHARS: 'NaN' }, { HISTORY_TURNS: '-1' }, { BOT_ENABLED: 'yes' }, { ALLOWED_CHATS: '1@g.us' }, { BOT_NAME: 'ignore\nidentity' }]) assert.throws(() => readConfig(env));
});
test('provider HTTPS URL validation rejects embedded credentials and queries', () => {
  for (const base of ['http://host/v1', 'https://a:b@host/v1', 'https://host/v1?key=x', 'https://host/v1#x']) {
    assert.throws(() => readConfig({ BOT_ENABLED: 'true', ALLOWED_CHATS: jid, AI_BASE_URL: base, AI_MODEL: 'chosen', AI_API_KEY: 'placeholder' }));
  }
});
test('persona names Nandhana and requires AI disclosure plus Malayalam/English/Manglish', () => {
  const prompt = persona('Nandhana');
  for (const text of ['Nandhana', 'not a human', 'Malayalam', 'English', 'Manglish', 'untrusted', 'general conversation']) assert.ok(prompt.includes(text));
  assert.ok(copy('Nandhana', 'help').includes('Nandhana'));
});
test('Malayalam consent and error templates', () => {
  assert.ok(copy('Nandhana', 'consent', 'ഹായ്').includes('മനുഷ്യയല്ല'));
  assert.ok(copy('Nandhana', 'error', 'ഹായ്').includes('വീണ്ടും'));
});
test('filter rejects own/group/status/broadcast/newsletter/empty/media input', () => {
  for (const remoteJid of ['1@g.us', 'status@broadcast', '1@broadcast', '1@newsletter']) assert.equal(incoming(message('hi', { remoteJid })), null);
  assert.equal(incoming(message('hi', { fromMe: true })), null);
  assert.equal(incoming({ ...message(), broadcast: true }), null);
  assert.equal(incoming(message('   ')), null);
  assert.equal(incoming({ ...message(), message: { imageMessage: { caption: 'hi' } } }), null);
  assert.equal(incoming({}), null);
});
test('direct extended text supported', () => {
  const m = message(); m.message = { extendedTextMessage: { text: 'ഹായ്' } };
  assert.equal(incoming(m).text, 'ഹായ്');
});
test('disabled and non-allowlisted chats cannot send or call AI', async t => {
  const f = fixture(t, { config: { enabled: false } }); await f.bot.handle(message()); assert.equal(f.sends.length, 0);
  const g = fixture(t); await g.bot.handle(message('hi', { remoteJid: '999@s.whatsapp.net' })); assert.equal(g.calls.length, 0); assert.equal(g.sends.length, 0);
});
test('first contact offers opt-in without AI request', async t => {
  const f = fixture(t); await f.bot.handle(message('hello'));
  assert.equal(f.calls.length, 0); assert.match(f.sends[0].text, /Nandhana.*AI/); assert.match(f.sends[0].text, /provider/);
});
test('start/help/reset commands are local only', async t => {
  const f = fixture(t); await f.start(); await f.bot.handle(message('/help')); await f.bot.handle(message('/reset'));
  assert.equal(f.calls.length, 0); assert.equal(f.sends.length, 3); assert.match(f.sends[1].text, /Nandhana/);
});
test('AI response always has explicit AI prefix and current language input', async t => {
  const f = fixture(t, { answer: 'സുഖമാണോ?' }); await f.start(); await f.bot.handle(message('ഹായ്'));
  assert.equal(f.calls[0].at(-1).content, 'ഹായ്'); assert.equal(f.sends.at(-1).text, 'Nandhana (AI): സുഖമാണോ?');
});
test('history bounded to configured turns and isolated by chat', async t => {
  const f = fixture(t, { config: { historyTurns: 2 } }); await f.start();
  for (let i = 0; i < 5; i++) await f.bot.handle(message('hi ' + i));
  assert.equal(f.calls.at(-1).length, 6); // system + 2 prior turns + input
  await f.bot.handle(message('/start', { remoteJid: '456@lid' }));
  await f.bot.handle(message('other', { remoteJid: '456@lid' })); assert.equal(f.calls.at(-1).length, 2);
});
test('reset removes model history, stop prevents further model requests', async t => {
  const f = fixture(t); await f.start(); await f.bot.handle(message('one')); await f.bot.handle(message('/reset'));
  await f.bot.handle(message('two')); assert.equal(f.calls.at(-1).length, 2);
  await f.bot.handle(message('/stop')); await f.bot.handle(message('three')); assert.equal(f.calls.length, 2);
});
test('rate limit is silent, expires and stop is honored', async t => {
  let time = 0; const f = fixture(t, { config: { rateLimit: 1 }, adapters: { now: () => time } });
  await f.start(); await f.bot.handle(message('too soon')); assert.equal(f.sends.length, 1);
  await f.bot.handle(message('/stop')); assert.equal(f.sends.length, 2);
  time = 61000; await f.bot.handle(message('later')); assert.equal(f.calls.length, 0); assert.equal(f.sends.length, 3);
});
test('input and output lengths bounded', async t => {
  const f = fixture(t, { config: { maxInput: 10, maxOutput: 100 }, answer: 'x'.repeat(500) });
  await f.start(); await f.bot.handle(message('x'.repeat(11))); assert.equal(f.calls.length, 0);
  await f.bot.handle(message('hi')); assert.equal(f.sends.at(-1).text.length, 'Nandhana (AI): '.length + 100);
});
test('duplicate delivery is ignored', async t => {
  const f = fixture(t); await f.start(); const m = message(); await Promise.all([f.bot.handle(m), f.bot.handle(m)]); assert.equal(f.calls.length, 1);
});
test('same-chat requests serialize and preserve ordering', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; }); let count = 0;
  const f = fixture(t, { ai: { complete: async () => { count++; if (count === 1) await gate; return 'ok'; } } });
  await f.start(); const one = f.bot.handle(message('one')); const two = f.bot.handle(message('two'));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(count, 1); release(); await Promise.all([one, two]); assert.equal(count, 2);
});
test('provider errors return generic notice, no raw error logged, queue recovers', async t => {
  const f = fixture(t, { ai: { complete: async () => { throw new Error('PRIVATE_TOKEN_AND_BODY'); } } });
  await f.start(); await f.bot.handle(message('private input')); await f.bot.handle(message('/help'));
  assert.deepEqual(f.logs, ['reply_failed']); assert.match(f.sends[1].text, /try again/); assert.ok(!JSON.stringify(f.sends).includes('PRIVATE_TOKEN'));
});
test('send failures are contained and next command still works', async t => {
  let attempts = 0; const f = fixture(t, { adapters: { send: async () => { attempts++; if (attempts === 1) throw new Error('private'); } } });
  await f.start(); await f.bot.handle(message('/help')); assert.equal(attempts, 2); assert.deepEqual(f.logs, ['message_failed']);
});
test('TTL expires consent and context', async t => {
  let time = 0; const f = fixture(t, { config: { chatTtl: 1000 }, adapters: { now: () => time } });
  await f.start(); await f.bot.handle(message('hi')); time = 1001; await f.bot.handle(message('again')); assert.equal(f.calls.length, 1); assert.match(f.sends.at(-1).text, /Send \/start/);
});
test('max chat count bounded', async t => {
  const f = fixture(t, { config: { maxChats: 1 } }); await f.start(); await f.bot.handle(message('/start', { remoteJid: '456@lid' })); assert.equal(f.sends.length, 1);
});
test('shutdown suppresses in-flight AI reply and new input', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; }); let started;
  const begin = new Promise(resolve => { started = resolve; });
  const f = fixture(t, { ai: { complete: async () => { started(); await gate; return 'late'; } } });
  await f.start(); const run = f.bot.handle(message('hi')); await begin;
  const close = f.bot.close(); release(); await Promise.all([run, close]); await f.bot.handle(message('/help')); assert.equal(f.sends.length, 1);
});
test('unknown commands do not reach AI', async t => {
  const f = fixture(t); await f.start(); await f.bot.handle(message('/unknown')); assert.equal(f.calls.length, 0); assert.match(f.sends.at(-1).text, /Unknown/);
});
const providerConfig = { baseUrl: 'https://provider.example/v1/', model: 'configured-model', apiKey: 'test-placeholder', timeout: 1000, maxOutput: 100 };
test('AI HTTP adapter uses configured endpoint/model with redirects forbidden', async () => {
  let request;
  const ai = createAI(providerConfig, { fetchImpl: async (...args) => { request = args; return new Response(JSON.stringify({ choices: [{ message: { content: ' hello ' } }] })); } });
  assert.equal(await ai.complete([{ role: 'user', content: 'hi' }]), 'hello');
  assert.equal(request[0], 'https://provider.example/v1/chat/completions'); assert.equal(request[1].redirect, 'error');
  assert.equal(JSON.parse(request[1].body).model, 'configured-model'); ai.close();
});
test('HTTP error, malformed/empty response and oversized body fail safely', async () => {
  for (const response of [new Response('sensitive error', { status: 401 }), new Response('bad-json'), new Response('{}'), new Response('x'.repeat(70000))]) {
    const ai = createAI(providerConfig, { fetchImpl: async () => response }); await assert.rejects(ai.complete([])); ai.close();
  }
});
test('provider timeout aborts request and close disables future calls', async () => {
  const ai = createAI({ ...providerConfig, timeout: 5 }, { fetchImpl: async (_, { signal }) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }) });
  await assert.rejects(ai.complete([]), /aborted/); ai.close(); await assert.rejects(ai.complete([]), /closed/);
});

test('per-chat pending queue is capped at ten', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; }); let calls = 0;
  const f = fixture(t, { ai: { complete: async () => { calls++; await gate; return 'ok'; } } });
  await f.start(); const tasks = Array.from({ length: 15 }, (_, i) => f.bot.handle(message('queued ' + i)));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1); release(); await Promise.all(tasks); assert.equal(calls, 10);
});
test('global provider concurrency is capped at four', async t => {
  const ids = Array.from({ length: 5 }, (_, i) => `${1000 + i}@s.whatsapp.net`);
  let release; const gate = new Promise(resolve => { release = resolve; }); let calls = 0;
  const f = fixture(t, { config: { allowedChats: new Set(ids) }, ai: { complete: async () => { calls++; await gate; return 'ok'; } } });
  for (const remoteJid of ids) await f.bot.handle(message('/start', { remoteJid }));
  const tasks = ids.map(remoteJid => f.bot.handle(message('hello', { remoteJid })));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 4); release(); await Promise.all(tasks);
});
test('global pending queue is capped at one hundred', async t => {
  const ids = Array.from({ length: 105 }, (_, i) => `${2000 + i}@s.whatsapp.net`);
  const f = fixture(t, { config: { allowedChats: new Set(ids), maxChats: 200 } });
  await Promise.all(ids.map(remoteJid => f.bot.handle(message('/start', { remoteJid }))));
  assert.equal(f.sends.length, 100);
});
test('disabled entrypoint exits offline before creating auth state', async () => {
  const { execFileSync } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const output = execFileSync(process.execPath, ['src/main.js'], { env: { PATH: process.env.PATH, BOT_ENABLED: 'false' }, encoding: 'utf8' });
  assert.match(output, /Bot disabled/); assert.equal(existsSync('auth'), false);
});
