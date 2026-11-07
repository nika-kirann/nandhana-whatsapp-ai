import { readConfig } from './config.js';
import { createAI } from './ai.js';
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
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  if (!state.creds.registered) throw new Error('No linked session. Linking is a separate supervised setup step; no QR or pairing code is emitted.');
  // This utility store is suitable for a small prototype, not multi-instance production.
  const ai = createAI(config);
  let socket, shuttingDown = false;
  const handler = createHandler(config, {
    ai, send: async (jid, text) => { if (!shuttingDown) await socket.sendMessage(jid, { text }); },
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
  }
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Startup failed. Check activation, provider configuration and linked session. No private error details logged.'); process.exitCode = 1; });
}
