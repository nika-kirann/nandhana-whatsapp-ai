import http from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { validatePhone } from './private-phone.js';
const digest = value => createHash('sha256').update(value).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createOwnerServer(config, pairing, { now = Date.now } = {}) {
  const sessions = new Map(), clients = new Map(); let lastStart = -Infinity;
  const authDigest = digest(config.username + ':' + config.password);
  const security = {
    'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', Vary: 'Authorization, Cookie',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin', 'Cross-Origin-Opener-Policy': 'same-origin',
    'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  };
  const server = http.createServer({ maxHeaderSize: 8192 }, (req, res) => {
    const reply = (status, body = '', headers = {}) => {
      res.writeHead(status, { ...security, 'Content-Type': 'text/plain; charset=utf-8', ...headers }); res.end(body);
    };
    void (async () => {
      // No request/access logging. Health is intentionally generic and never queries WhatsApp.
      if (req.url === '/healthz' && ['GET','HEAD'].includes(req.method)) return reply(200, req.method === 'HEAD' ? '' : 'ok');
      if (req.url === '/' && req.method === 'GET') return reply(200, 'Nandhana service. Owner access: /owner');
      if (!['/owner','/owner/status','/owner/qr.png','/owner/start','/owner/stop'].includes(req.url)) return reply(404, 'Not found');
      if (req.headers.host !== config.host || !(req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https')) return reply(400, 'HTTPS owner origin required');
      const key = req.socket.remoteAddress || 'unknown';
      for (const [id, item] of clients) if (now() - item.at >= 600000) clients.delete(id);
      let bucket = clients.get(key);
      if (!bucket) { if (clients.size >= 128) clients.delete(clients.keys().next().value); bucket = { at: now(), failed: 0, count: 0 }; clients.set(key, bucket); }
      if (bucket.failed >= 5 || ++bucket.count > 300) return reply(429, 'Try later', { 'Retry-After': '600' });
      const auth = req.headers.authorization || '';
      let decoded = '';
      if (/^Basic [A-Za-z0-9+/]+={0,2}$/.test(auth) && auth.length <= 1024) decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      if (!timingSafeEqual(digest(decoded), authDigest)) { bucket.failed++; return reply(401, 'Owner authentication required', { 'WWW-Authenticate': 'Basic realm="Nandhana owner", charset="UTF-8"' }); }
      if (req.headers['sec-fetch-site'] === 'cross-site') return reply(403, 'Cross-site request refused');
      for (const [id, item] of sessions) if (now() - item.at >= 600000) sessions.delete(id);
      const cookie = (req.headers.cookie || '').match(/(?:^|;\s*)__Host-nandhana=([a-f0-9]{64})(?:;|$)/)?.[1];
      let session = cookie && sessions.get(cookie);
      if (req.method === 'GET' && req.url === '/owner') {
        if (!session) {
          const id = randomBytes(32).toString('hex'); session = { csrf: randomBytes(32).toString('hex'), at: now() };
          if (sessions.size >= 128) sessions.delete(sessions.keys().next().value);
          sessions.set(id, session); res.setHeader('Set-Cookie', `__Host-nandhana=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=600`);
        }
        const snapshot = pairing.snapshot();
        const code = pairing.code();
        const qr = pairing.qr();
        const material = qr ? '<img src="/owner/qr.png" width="350" height="350" alt="Private linking QR">' : code ? `<h2>${escape(code.slice(0,4)+'-'+code.slice(4))}</h2><p>Linked devices → Link a device → Link with phone number instead. Enter this private code on your phone.</p>` : '';
        const controls = snapshot.pairingAllowed ? `<form method="post" action="/owner/start"><input type="hidden" name="csrf" value="${session.csrf}"><label>Method <select name="mode"><option value="qr">QR</option><option value="code">Phone code</option></select></label><label>Phone (code mode only; country code + digits)<input name="phone" type="tel" autocomplete="off" maxlength="15"></label><button>Start one pairing attempt</button></form><form method="post" action="/owner/stop"><input type="hidden" name="csrf" value="${session.csrf}"><button>Stop pairing</button></form>` : '<p>Downloader mode: pairing is disabled. Redeploy with BOT_ENABLED=false to pair.</p>';
        const nonce = randomBytes(18).toString('base64');
        const expiryScript = snapshot.active ? `<script nonce="${nonce}">setTimeout(()=>document.getElementById('private-material')?.replaceChildren(),${Math.min(180000, pairing.remainingMs())});addEventListener('pagehide',()=>document.getElementById('private-material')?.replaceChildren());</script>` : '';
        const stopForm = !snapshot.pairingAllowed ? `<form method="post" action="/owner/stop"><input type="hidden" name="csrf" value="${session.csrf}"><button>Clear pairing display</button></form>` : '';
        const html = `<!doctype html><html><head><meta charset="utf-8">${snapshot.active ? '<meta http-equiv="refresh" content="3">' : ''}<title>Nandhana owner pairing</title></head><body><h1>Nandhana: owner-only linking</h1><p>Status: ${escape(snapshot.state)}</p><section id="private-material">${material}</section>${expiryScript}${controls}${stopForm}<p>Pairing does not activate the Pinterest downloader. Never share QR/code screenshots. Only public Pins are supported after separate activation.</p></body></html>`;
        return reply(200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': security['Content-Security-Policy'] + `; script-src 'nonce-${nonce}'` });
      }
      if (req.method === 'GET' && req.url === '/owner/status') return reply(200, JSON.stringify(pairing.snapshot()), { 'Content-Type': 'application/json' });
      if (req.method === 'GET' && req.url === '/owner/qr.png') {
        const bytes = pairing.qr(); return bytes ? reply(200, bytes, { 'Content-Type': 'image/png' }) : reply(404, 'No active QR');
      }
      if (req.method !== 'POST' || !['/owner/start','/owner/stop'].includes(req.url)) return reply(405, 'Method not allowed');
      if (req.headers.origin !== config.origin || !session || req.headers['content-type'] !== 'application/x-www-form-urlencoded') return reply(403, 'Invalid owner action');
      let body = ''; for await (const part of req) { if (Buffer.byteLength(body) + part.length > 1024) return reply(413, 'Input too large'); body += part.toString('utf8'); }
      const fields = new URLSearchParams(body);
      if (!equal(fields.get('csrf') || '', session.csrf)) return reply(403, 'Invalid owner action');
      if ([...fields.keys()].some(k => !['csrf','mode','phone'].includes(k)) || [...new Set(fields.keys())].some(k => fields.getAll(k).length !== 1)) return reply(400, 'Invalid fields');
      if (req.url === '/owner/stop') { await pairing.stop(); return reply(303, '', { Location: '/owner' }); }
      if (!pairing.snapshot().pairingAllowed || pairing.snapshot().active) return reply(409, 'Pairing unavailable or already active');
      if (now() - lastStart < 10000) return reply(429, 'Wait before another attempt', { 'Retry-After': '10' });
      const mode = fields.get('mode'); let phone;
      if (!['qr','code'].includes(mode)) return reply(400, 'Choose QR or phone code');
      if (mode === 'code') { try { phone = validatePhone(fields.get('phone') || ''); } catch { return reply(400, 'Invalid phone format'); } }
      lastStart = now();
      if (!pairing.start(mode, phone)) return reply(409, 'Pairing unavailable');
      return reply(303, '', { Location: '/owner' });
    })().catch(() => { if (!res.headersSent) reply(500, 'Owner operation failed'); else res.end(); });
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  return server;
}
