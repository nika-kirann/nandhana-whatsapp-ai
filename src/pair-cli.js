import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, chmod, writeFile, rename, rm, lstat, open } from 'node:fs/promises';
import { createPairing, hasLinkedIdentity } from './pairing.js';
import { readPrivatePhone } from './private-phone.js';

export function resolvePairAuthDir(env = process.env, cwd = process.cwd()) {
  const root = resolve(cwd);
  const path = resolve(root, env.AUTH_DIR || 'auth');
  if (path !== join(root, 'auth') && (path === root || path.startsWith(root + '/'))) {
    throw new Error('Custom AUTH_DIR must be outside the project');
  }
  return path;
}
// QR/auth material never goes to stdout/stderr, logs, chat, or a public URL.
export async function runPairCLI() {
  if (!process.argv.includes('--owner-approved') || process.env.BOT_ENABLED === 'true') {
    process.exitCode = 1; return;
  }
  process.umask(0o077);
  for (const name of ['log','info','warn','error','debug','trace','dir']) console[name] = () => {};
  const authDir = resolvePairAuthDir();
  const viewDir = resolve('.pairing');
  for (const dir of [authDir, viewDir]) {
    try { if ((await lstat(dir)).isSymbolicLink()) throw new Error('Unsafe directory'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700);
  }
  const codeMode = process.argv.includes('--phone-code');
  let privateCode = '';
  let io = Promise.resolve();
  const atomic = (name, bytes) => {
    io = io.then(async () => {
    const path = join(viewDir, name), temp = path + '.tmp';
    await writeFile(temp, bytes, { mode: 0o600 }); await chmod(temp, 0o600); await rename(temp, path);
    });
    return io;
  };
  const clearQR = () => { privateCode = ''; return rm(join(viewDir, 'qr.png'), { force: true }); };
  const status = async (state, reasonCode) => {
    await atomic('status.json', JSON.stringify({ state, reasonCode, pid: process.pid,
      updatedAt: new Date().toISOString(), botEnabled: false }) + '\n');
    await atomic('index.html', `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>Nandhana — owner-supervised linking</title></head>
<body style="font-family:sans-serif;text-align:center"><h1>Nandhana: link device only</h1>
<p>Bot is disabled. No chat reading, download or messaging handlers.</p>
<p>Status: ${state}</p>${state === 'waiting_scan' ? '<img src="qr.png" width="400" height="400" alt="Private WhatsApp linking QR"><p>On your phone: WhatsApp → Linked devices → Link a device.</p>' : state === 'waiting_phone_code' ? `<h2 style="font-size:48px;letter-spacing:8px">${privateCode}</h2><p>On your phone: Linked devices → Link a device → Link with phone number instead. Enter this private code.</p>` : '<p>No active QR or code. Do not use an old screenshot.</p>'}
<p>Owner only. Do not share this page or QR. This window refreshes every 2 seconds.</p></body></html>`);
  };
  const lockPath = join(viewDir, 'run.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); } catch { process.exitCode = 1; return; }
  await lock.writeFile(String(process.pid));
  await clearQR(); await status('preparing');
  try {
    let phoneNumber;
    if (codeMode) {
      try { phoneNumber = await readPrivatePhone(join(viewDir, 'phone.txt')); }
      catch { await status('phone_input_required'); process.exitCode = 1; return; }
    }
    const [{ default: makeWASocket, useMultiFileAuthState, DisconnectReason }, { default: pino }, { default: QRCode }] = await Promise.all([
      import('@whiskeysockets/baileys'), import('pino'), import('qrcode')
    ]);
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    // Preserve existing session and verify it using the same auth-only socket.
    if (hasLinkedIdentity(state.creds)) await status('verifying_existing');
    const pairing = createPairing({ makeSocket: makeWASocket, auth: state, saveCreds,
      logger: pino({ level: 'silent' }), restartCode: DisconnectReason.restartRequired,
      clearQR, status,
      requestCode: codeMode ? async socket => socket.requestPairingCode(phoneNumber) : undefined,
      renderCode: async value => {
        if (typeof value !== 'string' || !/^[A-Z0-9]{8}$/i.test(value)) throw new Error('Invalid pairing code');
        privateCode = value.slice(0,4) + '-' + value.slice(4);
      },
      renderQR: async value => atomic('qr.png', await QRCode.toBuffer(value, { type: 'png', width: 600, margin: 4 })) });
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
