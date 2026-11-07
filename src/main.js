import { acquireAuthLock } from './auth-lock.js';
import { readConfig } from './config.js';
import { hasLinkedIdentity } from './pairing.js';
import { createDownloader } from './pinterest.js';
import { createTransport } from './network.js';
import { createHandler } from './handler.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, chmod } from 'node:fs/promises';

// No network imports, auth creation or WhatsApp activity until explicit activation.
export async function main() {
  const config = readConfig();
  if (!config.enabled) { console.info('Bot disabled. Review README before activation.'); return; }
  const [{ default: makeWASocket, useMultiFileAuthState }, { default: pino }] = await Promise.all([
    import('@whiskeysockets/baileys'), import('pino')
  ]);
  const authDir = resolve(config.authDir);
  // Keep custom auth paths outside the project to prevent accidental publication.
  if (authDir !== resolve('./auth') && (authDir === process.cwd() || authDir.startsWith(process.cwd() + '/'))) {
    throw new Error('Custom AUTH_DIR must be outside the project');
  }
  process.umask(0o077);
  await mkdir(authDir, { recursive: true, mode: 0o700 });
  await chmod(authDir, 0o700);
  const releaseAuth = await acquireAuthLock(authDir);
  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    if (!hasLinkedIdentity(state.creds)) throw new Error('No linked session. Linking is a separate supervised setup step; no QR or pairing code is emitted.');
    // This utility store is suitable for a small prototype, not multi-instance production.
    const downloader = createDownloader(config, createTransport({ timeout: config.timeout }));
    let socket, shuttingDown = false;
    const handler = createHandler(config, {
      downloader, send: async (jid, text) => { if (!shuttingDown) await socket.sendMessage(jid, { text }); },
      sendMedia: async (jid, media, caption) => { if (!shuttingDown) await socket.sendMessage(jid, { [media.type]: { url: media.path }, mimetype: media.mimetype, caption }); },
      log: event => console.warn(event)
    });
    const startedAt = Math.floor(Date.now() / 1000);
    // No automatic reconnect loop: supervise/restart manually after checking disconnect status.
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
      if (connection === 'open') console.info('whatsapp_connected');
      if (connection === 'close' && !shuttingDown) { console.warn('whatsapp_disconnected'); void shutdown(); }
    });
    async function shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      // Do not log out: preserve the registered linked-device session.
      socket.end(undefined);
      const deadline = setTimeout(() => process.exit(1), 10000);
      deadline.unref();
      await handler.close();
      await saveChain;
      clearTimeout(deadline);
      await releaseAuth();
    }
    process.once('SIGINT', () => void shutdown());
    process.once('SIGTERM', () => void shutdown());
    return { stop: shutdown };
  } catch (error) { await releaseAuth(); throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Startup failed. Check activation, downloader configuration and linked session. No private error details logged.'); process.exitCode = 1; });
}
