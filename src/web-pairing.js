// In-memory private material. No filesystem/public URL persistence for web QR or code.
export function createWebPairing({ run, enabled = true, now = Date.now, timeoutMs = 180000 }) {
  let state = 'idle', reasonCode, active = false, qr, code = '', handle, deadline = 0, timer, closing = false, cancelled = false, generation = 0;
  const clear = () => { qr = undefined; code = ''; };
  const expire = () => {
    if (active && !cancelled && now() >= deadline) { cancelled = true; clear(); state = 'expired'; void handle?.stop(); }
  };
  return {
    remainingMs() { return Math.max(0, deadline - now()); },
    snapshot() { expire(); return { state, active, reasonCode, pairingAllowed: enabled && !closing }; },
    qr() { expire(); return active && state === 'waiting_scan' ? qr : undefined; },
    code() { expire(); return active && state === 'waiting_phone_code' ? code : ''; },
    start(mode, phone) {
      if (!enabled || closing) return false;
      if (active) return false;
      if (mode !== 'qr' && mode !== 'code') throw new Error('Invalid pairing mode');
      active = true; cancelled = false; const current = ++generation; state = 'preparing'; reasonCode = undefined; clear();
      deadline = now() + timeoutMs;
      timer = setTimeout(expire, timeoutMs); timer.unref?.();
      const callbacks = {
        status: async (next, reason) => { if (active && current === generation && !cancelled && now() < deadline) { state = next; reasonCode = Number.isInteger(reason) ? reason : undefined; if (!['waiting_scan','waiting_phone_code'].includes(next)) clear(); } },
        renderQR: async bytes => { if (active && current === generation && !cancelled && now() < deadline) qr = bytes; },
        renderCode: async value => { if (active && current === generation && !cancelled && now() < deadline) { if (!/^[A-Z0-9]{8}$/i.test(value)) throw new Error('Invalid code'); code = value; } },
        clear: async () => clear()
      };
      void (async () => {
        try {
          handle = await run({ mode, phone, ...callbacks });
          if (closing || cancelled || now() >= deadline) await handle.stop();
          const outcome = await handle.done;
          if (now() < deadline && !closing) state = outcome;
        } catch { state = 'pairing_failed'; }
        finally { clearTimeout(timer); clear(); active = false; handle = undefined; }
      })();
      return true;
    },
    async stop() { cancelled = true; clear(); state = 'stopped'; await handle?.stop(); },
    async close() { closing = true; cancelled = true; clear(); clearTimeout(timer); await handle?.stop(); }
  };
}
export async function liveWebPairing({ env = process.env, mode, phone, status, renderQR, renderCode, clear }) {
  const [{ openAuthStore }, { createPairing }, { default: QRCode },
    { default: makeSocket, DisconnectReason }, { default: pino }] = await Promise.all([
      import('./auth-store.js'), import('./pairing.js'), import('qrcode'),
      import('@whiskeysockets/baileys'), import('pino')
    ]);
  let pairing, lost = false;
  const storage = await openAuthStore({ env, onLost: () => { lost = true; void pairing?.failStorage(); } });
  try {
    if (lost) throw new Error('AUTH_SESSION_LOST');
    pairing = createPairing({ makeSocket: options => { storage.assertActive(); return makeSocket(options); }, auth: storage.state, saveCreds: storage.saveCreds, status, clearQR: clear,
      logger: pino({ level: 'silent' }), restartCode: DisconnectReason.restartRequired,
      renderQR: async value => renderQR(await QRCode.toBuffer(value, { type: 'png', width: 600, margin: 4 })),
      requestCode: mode === 'code' ? async socket => socket.requestPairingCode(phone) : undefined, renderCode });
    return { stop: pairing.stop, done: pairing.done.finally(() => storage.close()) };
  } catch (error) { await storage.close(); throw error; }
}
