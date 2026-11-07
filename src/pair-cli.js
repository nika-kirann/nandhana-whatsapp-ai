import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, chmod, writeFile, rename, rm, lstat, open } from 'node:fs/promises';
import { createPairing } from './pairing.js';

// QR/auth material never goes to stdout/stderr, logs, chat, or a public URL.
export async function runPairCLI() {
  if (!process.argv.includes('--owner-approved') || process.env.BOT_ENABLED === 'true') {
    process.exitCode = 1; return;
  }
  process.umask(0o077);
  for (const name of ['log','info','warn','error','debug','trace','dir']) console[name] = () => {};
  const authDir = resolve('auth');
  const viewDir = resolve('.pairing');
  for (const dir of [authDir, viewDir]) {
    try { if ((await lstat(dir)).isSymbolicLink()) throw new Error('Unsafe directory'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700);
  }
  let io = Promise.resolve();
  const atomic = (name, bytes) => {
    io = io.then(async () => {
    const path = join(viewDir, name), temp = path + '.tmp';
    await writeFile(temp, bytes, { mode: 0o600 }); await chmod(temp, 0o600); await rename(temp, path);
    });
    return io;
  };
  const clearQR = () => rm(join(viewDir, 'qr.png'), { force: true });
  const status = async (state, reasonCode) => {
    await atomic('status.json', JSON.stringify({ state, reasonCode, pid: process.pid,
      updatedAt: new Date().toISOString(), botEnabled: false }) + '\n');
    await atomic('index.html', `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>Nandhana — owner-supervised linking</title></head>
<body style="font-family:sans-serif;text-align:center"><h1>Nandhana: link device only</h1>
<p>Bot is disabled. No chat reading, download or messaging handlers.</p>
<p>Status: ${state}</p>${state === 'waiting_scan' ? '<img src="qr.png" width="400" height="400" alt="Private WhatsApp linking QR"><p>On your phone: WhatsApp → Linked devices → Link a device.</p>' : '<p>No active QR. Do not scan an old screenshot.</p>'}
<p>Owner only. Do not share this page or QR. This window refreshes every 2 seconds.</p></body></html>`);
  };
  const lockPath = join(viewDir, 'run.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); } catch { process.exitCode = 1; return; }
  await lock.writeFile(String(process.pid));
  await clearQR(); await status('preparing');
  try {
    const [{ default: makeWASocket, useMultiFileAuthState, DisconnectReason }, { default: pino }, { default: QRCode }] = await Promise.all([
      import('@whiskeysockets/baileys'), import('pino'), import('qrcode')
    ]);
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    if (state.creds.registered) { await status('already_registered_not_verified'); return; }
    const pairing = createPairing({ makeSocket: makeWASocket, auth: state, saveCreds,
      logger: pino({ level: 'silent' }), restartCode: DisconnectReason.restartRequired,
      clearQR, status, renderQR: async value => atomic('qr.png', await QRCode.toBuffer(value, { type: 'png', width: 600, margin: 4 })) });
    process.once('SIGINT', () => void pairing.stop());
    process.once('SIGTERM', () => void pairing.stop());
    const result = await pairing.done;
    if (result !== 'paired') process.exitCode = 1;
  } catch {
    await clearQR(); await status('startup_failed'); process.exitCode = 1;
  } finally { await lock.close(); await rm(lockPath, { force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPairCLI().catch(() => { process.exitCode = 1; });
}
