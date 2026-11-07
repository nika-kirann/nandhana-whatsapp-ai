import { load } from 'cheerio';
import { validateUrl } from './network.js';
import { mkdtemp, rm, open as openFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function extractMedia(html, pinUrl) {
  const $ = load(html); const pin = validateUrl(pinUrl);
  if (/captcha|access denied|verify you are human/i.test($('title').text())) throw new Error('Restricted page');
  const meta = key => $(`meta[property="${key}"],meta[name="${key}"]`).first().attr('content');
  const canonical = meta('og:url');
  if (canonical && validateUrl(canonical).pathname.replace(/\/$/, '') !== pin.pathname.replace(/\/$/, '')) throw new Error('Pin mismatch');
  const records = [];
  const visit = (item, depth = 0) => {
    if (depth > 8 || !item || typeof item !== 'object') return;
    if (Array.isArray(item)) { for (const entry of item) visit(entry, depth + 1); return; }
    records.push(item);
    // Only schema entities, not page hydration/recommendations or internal API state.
    for (const key of ['@graph', 'mainEntity', 'sharedContent', 'video']) visit(item[key], depth + 1);
  };
  $('script[type="application/ld+json"]').each((_, element) => {
    try { visit(JSON.parse($(element).text())); } catch { /* no evaluation of page code */ }
  });
  const types = item => Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
  const matches = item => {
    const ref = item['@id'] || item.mainEntityOfPage?.['@id'] || item.sharedContent?.url;
    if (!ref) return true;
    try { return validateUrl(ref).pathname.replace(/\/$/, '') === pin.pathname.replace(/\/$/, ''); } catch { return false; }
  };
  const videos = records.filter(item => types(item).includes('VideoObject') && matches(item));
  const video = videos.map(item => item.contentUrl).find(value => typeof value === 'string' && /\.mp4(?:\?|$)/i.test(value)) || meta('og:video:secure_url') || meta('og:video');
  if (video) {
    const url = validateUrl(video, 'media');
    if (!/\.mp4$/i.test(url.pathname)) throw new Error('Unsupported video stream');
    return { type: 'video', url: url.href };
  }
  // Any video signal suppresses image fallback, including HLS-only Pins.
  if (videos.length || /\.m3u8|"VideoObject"|"video_list"|"videoDataV2"/.test(html) || /video/i.test(meta('og:type') || '')) throw new Error('Video unavailable');
  const imageEntity = records.find(item => types(item).includes('ImageObject') && matches(item));
  const posting = records.find(item => types(item).includes('SocialMediaPosting') && matches(item));
  const candidate = imageEntity?.contentUrl || posting?.image;
  const image = typeof candidate === 'string' ? candidate : candidate?.url;
  // OG thumbnails alone are ambiguous: require an explicit image Pin hint or schema image.
  const imageUrl = image || (meta('pinterest:media') === 'image' ? meta('og:image') : null);
  if (!imageUrl) throw new Error('No supported public media');
  const url = validateUrl(imageUrl, 'media');
  if (!/\.(?:jpe?g|png|webp)$/i.test(url.pathname)) throw new Error('Unsupported image');
  return { type: 'image', url: url.href };
}
export async function readPage(response, maxBytes = 2097152) {
  if (!(response.headers['content-type'] || '').toLowerCase().startsWith('text/html')) throw new Error('Not HTML');
  const parts = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length; if (size > maxBytes) throw new Error('Page too large'); parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts).toString('utf8');
}
export function validMagic(bytes, mime) {
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return mime === 'video/mp4' && bytes.toString('ascii', 4, 8) === 'ftyp';
}
export function createDownloader(config, transport) {
  return {
    async download(input) {
      const media = await transport.consume(input, 'page', async (response, url) => extractMedia(await readPage(response), url.href));
      const dir = await mkdtemp(join(tmpdir(), 'nandhana-'));
      const cleanup = () => rm(dir, { recursive: true, force: true });
      const path = join(dir, media.type === 'video' ? 'pin.mp4' : 'pin.image');
      let mimetype;
      try {
        await transport.consume(media.url, 'media', async response => {
          const mime = (response.headers['content-type'] || '').split(';')[0].toLowerCase().trim();
          if (!(media.type === 'video' ? ['video/mp4'] : ['image/jpeg', 'image/png', 'image/webp']).includes(mime)) throw new Error('Unexpected media content');
          mimetype = mime;
          const length = response.headers['content-length'];
          if (length && (!/^\d+$/.test(length) || Number(length) > config.maxMedia)) throw new Error('Media too large');
          const file = await openFile(path, 'wx', 0o600); let size = 0, first = Buffer.alloc(0);
          try {
            for await (const chunk of response.body) {
              size += chunk.length; if (size > config.maxMedia) throw new Error('Media too large');
              if (first.length < 16) first = Buffer.concat([first, chunk]).subarray(0, 16);
              await file.writeFile(chunk);
            }
            if (!size || !validMagic(first, mime)) throw new Error('Invalid media signature');
          } finally { await file.close(); }
        });
        return { type: media.type, path, mimetype, cleanup };
      } catch (error) { await cleanup(); throw error; }
    },
    close() { transport.close(); }
  };
}
