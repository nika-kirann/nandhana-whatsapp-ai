import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export function validateUrl(value, kind = 'page') {
  if (typeof value !== 'string' || /[\s\u0000-\u001f\u007f]/u.test(value)) throw new Error('Invalid URL');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || value.length > 2048) throw new Error('Unsafe URL');
  if (kind === 'page') {
    const valid = ['pinterest.com', 'www.pinterest.com'].includes(url.hostname)
      ? /^\/pin\/\d+\/?$/.test(url.pathname)
      : url.hostname === 'pin.it' && /^\/[a-zA-Z0-9]+\/?$/.test(url.pathname);
    if (!valid) throw new Error('Unsupported page URL');
  } else {
    if (!['i.pinimg.com', 'v1.pinimg.com'].includes(url.hostname)) throw new Error('Unsupported media host');
    if (!/\.(?:jpg|jpeg|png|webp|mp4)$/i.test(url.pathname)) throw new Error('Unsupported media type');
  }
  return url;
}
export function isPublicIP(value) {
  try { return ipaddr.parse(value).range() === 'unicast'; } catch { return false; }
}
export function makeLookup(resolve = dnsLookup) {
  return (hostname, options, callback) => {
    resolve(hostname, { all: true, verbatim: true }).then(records => {
      if (!records.length || records.some(record => !isPublicIP(record.address))) throw new Error('Unsafe DNS');
      // Supply the checked address directly to the TLS socket: no second DNS lookup.
      callback(null, records[0].address, records[0].family);
    }).catch(() => callback(new Error('DNS rejected')));
  };
}
export function openHTTPS(url, { signal, lookup = makeLookup() } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { signal, lookup, autoSelectFamily: false, minVersion: 'TLSv1.2',
      headers: { 'User-Agent': 'Nandhana-Public-Pin-Downloader/0.2', Accept: '*/*', 'Accept-Encoding': 'identity' } },
      response => resolve({ status: response.statusCode, headers: response.headers, body: response }));
    req.once('error', reject);
  });
}
export function createTransport({ open = openHTTPS, timeout = 20000 } = {}) {
  const controllers = new Set(); let closed = false;
  return {
    async consume(value, kind, consumer) {
      if (closed) throw new Error('Transport closed');
      const controller = new AbortController(); controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), timeout);
      let response;
      try {
        let url = validateUrl(value, kind);
        for (let hop = 0; ; hop++) {
          response = await open(url, { signal: controller.signal });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            response.body.destroy();
            if (hop >= 3 || !response.headers.location) throw new Error('Redirect limit');
            url = validateUrl(new URL(response.headers.location, url).href, kind);
            continue;
          }
          if (response.status !== 200) throw new Error('Remote access unavailable'); // never retry blocks
          if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new Error('Unexpected encoding');
          if (kind === 'page' && url.hostname === 'pin.it') throw new Error('Shortlink did not resolve to Pin');
          return await consumer(response, url);
        }
      } finally {
        response?.body.destroy(); clearTimeout(timer); controllers.delete(controller);
      }
    },
    close() { closed = true; for (const controller of controllers) controller.abort(); }
  };
}
