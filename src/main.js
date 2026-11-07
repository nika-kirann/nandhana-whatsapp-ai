import { openAuthStore } from './auth-store.js';
import { readConfig } from './config.js';
import { hasLinkedIdentity } from './pairing.js';
import { createDownloader } from './pinterest.js';
import { createTransport } from './network.js';
import { createHandler } from './handler.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// No network imports, auth creation or WhatsApp activity until explicit activation.
export async function main({ env = process.env, ownerApproved = false, onConnection = () => {}, onStopped = () => {} } = {}) {
  const config = readConfig(env, { activated: ownerApproved });
  if (!config.enabled) { console.info('Downloader idle. Start only from the protected owner page.'); return; }
  const [{ default: makeWASocket }, { default: pino }] = await Promise.all([
    import('@whiskeysockets/baileys'), import('pino')
  ]);
  let socket, shuttingDown = false, lost = false, stopOnLoss = () => {};
  const storage = await openAuthStore({ env, onLost: () => { lost = true; if (socket) void stopOnLoss(); } });
  try {
    stopOnLoss = shutdown;
    const { state, saveCreds } = storage;
    if (lost) throw new Error('AUTH_SESSION_LOST');
    if (!hasLinkedIdentity(state.creds)) throw new Error('No linked session. Linking is a separate supervised setup step; no QR or pairing code is emitted.');
    // This utility store is suitable for a small prototype, not multi-instance production.
    const downloader = createDownloader(config, createTransport({ timeout: config.timeout }));
    const control=storage.readControl ? await storage.readControl() : {paused:false};
    const handler = createHandler(config, {
      initialPaused:control.paused,persistPaused:storage.writePaused,controlPersistence:storage.writePaused?'postgres':'runtime',
      downloader, send: async (jid, text) => { if (!shuttingDown) { await storage.guard(); storage.assertActive(); if (shuttingDown) return; await socket.sendMessage(jid, { text }); } },
      sendMedia: async (jid, media, caption) => { if (!shuttingDown) { await storage.guard(); storage.assertActive(); if (shuttingDown || handler.snapshot().paused) return; await socket.sendMessage(jid, { [media.type]: { url: media.path }, mimetype: media.mimetype, caption }); } },
      log: event => console.warn(event)
    });
    const startedAt = Math.floor(Date.now() / 1000);
    // No automatic reconnect loop: supervise/restart manually after checking disconnect status.
    storage.assertActive();
    socket = makeWASocket({ auth: state, logger: pino({ level: 'silent' }),
      printQRInTerminal: false, markOnlineOnConnect: false,
      syncFullHistory: false, shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false });
    let saveChain = Promise.resolve();
    socket.ev.on('creds.update', () => {
      saveChain = saveChain.then(saveCreds).catch(() => { console.warn('auth_save_failed'); void shutdown(); });
    });
    socket.ev.on('messages.upsert', ({ type, messages }) => {
      if (type !== 'notify' || shuttingDown) return;
      for (const message of messages) {
        const timestamp = Number(message.messageTimestamp);
        if (!Number.isFinite(timestamp) || timestamp < startedAt) continue;
        void handler.handle(message);
      }
    });
    socket.ev.on('connection.update', ({ connection, qr }) => {
      if (qr) { console.warn('linking_required'); void shutdown(); }
      if (connection === 'open' && !shuttingDown) { console.info('whatsapp_connected'); onConnection(); }
      if (connection === 'close' && !shuttingDown) { console.warn('whatsapp_disconnected'); void shutdown(); }
    });
    const signalStop=()=>void shutdown();
    let shutdownTask;
    function shutdown() {
      if (shutdownTask) return shutdownTask;
      shuttingDown=true;
      process.removeListener('SIGINT',signalStop);process.removeListener('SIGTERM',signalStop);
      shutdownTask=(async()=>{
        try { socket?.end(undefined); } catch {}
        const deadline=setTimeout(()=>process.exit(1),10000);deadline.unref();
        try { await handler.close();await saveChain; }
        finally { try { await storage.close(); } finally { clearTimeout(deadline);onStopped(); } }
      })();
      return shutdownTask;
    }
    process.once('SIGINT', signalStop);
    process.once('SIGTERM', signalStop);
    return { stop: shutdown, snapshot:handler.snapshot };
  } catch (error) { await storage.close(); throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Startup failed. Check activation, downloader configuration and linked session. No private error details logged.'); process.exitCode = 1; });
}
