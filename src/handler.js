import { copy } from './copy.js';
import { validateUrl } from './network.js';

// Only plain direct-chat text. No incoming media, quoted/view-once extraction or history sync.
export function incoming(message) {
  const key = message?.key;
  if (!key?.id || key.fromMe || message.broadcast || !/^\d+@(s\.whatsapp\.net|lid)$/.test(key.remoteJid || '')) return null;
  const text = message.message?.conversation ?? message.message?.extendedTextMessage?.text;
  if (typeof text !== 'string' || !text.trim()) return null;
  return { jid: key.remoteJid, id: key.id, text: text.trim() };
}

export function createHandler(config, { downloader, send, sendMedia, now = Date.now, log = () => {} }) {
  const chats = new Map(), queues = new Map(), seen = new Map();
  let stopped = false, pending = 0, activeDownloads = 0;
  const report = event => { try { log(event); } catch { /* logging must not break processing */ } };
  const sweep = () => {
    const time = now();
    for (const [jid, chat] of chats) if (time - chat.touched >= config.chatTtl && !queues.has(jid)) chats.delete(jid);
    for (const [id, timeSeen] of seen) if (time - timeSeen >= 300000) seen.delete(id);
  };
  const sweepTimer = setInterval(sweep, Math.min(config.chatTtl, 60000));
  sweepTimer.unref?.();
  async function process({ jid, text }) {
    if (stopped) return;
    sweep();
    let chat = chats.get(jid);
    if (!chat) {
      if (chats.size >= config.maxChats) return;
      chat = { optedIn: false, times: [], touched: now() };
      chats.set(jid, chat);
    }
    chat.touched = now();
    const command = text.toLowerCase();
    // Opt-out is always honored, even when rate-limited.
    if (command === '/stop') {
      chat.optedIn = false;
      if (!stopped) await send(jid, copy(config.name, 'stop', text));
      return;
    }
    chat.times = chat.times.filter(t => now() - t < 60000);
    if (chat.times.length >= config.rateLimit) return; // silent throttle avoids reply storms
    chat.times.push(now());
    const reply = text => stopped ? Promise.resolve() : send(jid, text);
    if (text.length > config.maxInput) return reply(copy(config.name, 'invalid'));
    if (command === '/reset') { chat.optedIn = false; return reply(copy(config.name, 'reset')); }
    if (command === '/help') return reply(copy(config.name, 'help', text));
    if (command === '/start') {
      if (!chat.optedIn) {
        // Explicit /start is consent after reading the setup/first-contact notice.
        chat.optedIn = true;
        return reply(copy(config.name, 'consent', text) + '\n' + copy(config.name, 'start', text));
      }
      return reply(copy(config.name, 'start', text));
    }
    if (!chat.optedIn) return reply(copy(config.name, 'consent', text));
    if (command.startsWith('/')) return reply(copy(config.name, 'help'));
    try { validateUrl(text); } catch { return reply(copy(config.name, 'invalid')); }
    if (activeDownloads >= 2) return;
    activeDownloads++;
    let media;
    try {
      media = await downloader.download(text);
      if (!stopped) await sendMedia(jid, media, copy(config.name, 'caption'));
    } catch {
      report('download_failed');
      if (!stopped) await reply(copy(config.name, 'error'));
    } finally { try { await media?.cleanup(); } finally { activeDownloads--; } }
  }
  return {
    handle(message) {
      if (!config.enabled || stopped) return Promise.resolve();
      const item = incoming(message);
      if (!item || !config.allowedChats.has(item.jid)) return Promise.resolve();
      sweep();
      const dedupe = `${item.jid}:${item.id}`;
      if (seen.has(dedupe)) return Promise.resolve();
      const previous = queues.get(item.jid);
      if (pending >= 100 || (previous?.count || 0) >= 10) return Promise.resolve();
      seen.set(dedupe, now());
      if (seen.size > 2000) seen.delete(seen.keys().next().value);
      pending++;
      const entry = { count: (previous?.count || 0) + 1 };
      entry.promise = (previous?.promise || Promise.resolve()).then(() => process(item)).catch(() => report('message_failed')).finally(() => {
        pending--;
        const latest = queues.get(item.jid);
        if (latest) latest.count--;
        if (latest === entry) queues.delete(item.jid);
      });
      queues.set(item.jid, entry);
      return entry.promise;
    },
    async close() {
      stopped = true; clearInterval(sweepTimer); downloader.close?.();
      await Promise.allSettled([...queues.values()].map(entry => entry.promise));
      chats.clear(); seen.clear();
    }
  };
}
