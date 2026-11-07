// Baileys 6.7 QR login uses creds.me (registered is not set by QR pairing).
export const hasLinkedIdentity = creds => typeof creds?.me?.id === 'string' && creds.me.id.length > 0;
// Auth-only state machine. No chat/inbox/download/send handlers are registered.
export function pairSocketOptions(auth, logger) {
  return { auth, logger, printQRInTerminal: false, markOnlineOnConnect: false,
    syncFullHistory: false, shouldSyncHistoryMessage: () => false,
    shouldIgnoreJid: () => true, fireInitQueries: false, emitOwnEvents: false,
    getMessage: async () => undefined, connectTimeoutMs: 20000,
    defaultQueryTimeoutMs: 20000, keepAliveIntervalMs: 15000 };
}
export function createPairing({ makeSocket, auth, saveCreds, renderQR, clearQR,
  status, logger, requestCode, renderCode, restartCode = 515, timeoutMs = 180000, maxQRs = 6 }) {
  let socket, ended = false, restarts = 0, qrCount = 0, codeRequested = false;
  let tasks = Promise.resolve(), saves = Promise.resolve(), rendering = Promise.resolve();
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const timer = setTimeout(() => void finish('expired'), timeoutMs);
  async function finish(state, code) {
    if (ended) return;
    ended = true; clearTimeout(timer);
    try { socket?.end(undefined); } catch { /* no raw exception details */ }
    let outcome = state;
    try { await saves; } catch { outcome = 'storage_failed'; }
    try { await rendering; } catch { outcome = 'pairing_failed'; }
    try {
      await clearQR();
      await status(outcome, Number.isInteger(code) ? code : undefined);
      resolveDone(outcome);
    } catch {
      try { await clearQR(); await status('storage_failed'); } catch { /* no private errors logged */ }
      resolveDone('storage_failed');
    }
  }
  function start() {
    if (ended) return;
    socket = makeSocket(pairSocketOptions(auth, logger));
    socket.ev.on('creds.update', () => {
      if (ended) return;
      saves = saves.then(saveCreds);
      saves.catch(() => void finish('storage_failed'));
    });
    socket.ev.on('connection.update', update => {
      tasks = tasks.then(async () => {
        if (ended) return;
        if (update.qr) {
          if (requestCode) {
            if (!codeRequested) {
              codeRequested = true;
              // Documented readiness trigger; one request only, never render the QR.
              rendering = requestCode(socket).then(renderCode);
              await rendering;
              if (ended) return;
              await status('waiting_phone_code');
            }
          } else {
            if (++qrCount > maxQRs) { await finish('qr_limit'); return; }
            rendering = renderQR(update.qr);
            await rendering;
            if (ended) return;
            await status('waiting_scan');
          }
        }
        if (update.connection === 'open') {
          if (!hasLinkedIdentity(auth.creds)) { await finish('auth_identity_missing'); return; }
          saves=saves.then(saveCreds);
          await finish('paired');
        }
        if (update.connection === 'close') {
          const code = update.lastDisconnect?.error?.output?.statusCode;
          if (code === restartCode && hasLinkedIdentity(auth.creds) && restarts === 0) {
            restarts++;
            await saves;
            await clearQR(); await status('verifying');
            // Exactly one documented post-scan restart; never retry network/site failures.
            start();
          } else await finish('connection_failed', code);
        }
      }).catch(() => void finish('pairing_failed'));
    });
  }
  void status('connecting').then(start).catch(() => void finish('pairing_failed'));
  return { done, stop: () => finish('stopped'), failStorage: () => finish('storage_failed') };
}
