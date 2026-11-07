const integer = (env, key, fallback, min, max) => {
  const value = Number(env[key] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
  return value;
};
export function readConfig(env = process.env, { activated = false } = {}) {
  if (env.PUBLIC_ACCESS && !['true','false'].includes(env.PUBLIC_ACCESS)) throw new Error('Invalid PUBLIC_ACCESS');
  const publicAccess=env.PUBLIC_ACCESS==='true', ownerNumber=env.OWNER_NUMBER || '';
  if(ownerNumber && !/^[1-9][0-9]{7,14}$/.test(ownerNumber)) throw new Error('Invalid OWNER_NUMBER: international digits only');
  const allowedChats = new Set((env.ALLOWED_CHATS || '').split(',').map(x => x.trim()).filter(Boolean));
  if ([...allowedChats].some(x => !/^\d+@(s\.whatsapp\.net|lid)$/.test(x))) throw new Error('Invalid ALLOWED_CHATS');
  const name = env.BOT_NAME?.trim() || 'Nandhana';
  if (!/^[\p{L}\p{N} _-]{1,40}$/u.test(name)) throw new Error('Invalid BOT_NAME');
  const config = {
    enabled: activated, name, allowedChats, publicAccess, ownerNumber,
    authDir: env.AUTH_DIR || './auth',
    maxInput: integer(env, 'MAX_INPUT_CHARS', 2000, 1, 10000),
    maxChats: integer(env, 'MAX_CHATS', 100, 1, 1000),
    chatTtl: integer(env, 'CHAT_TTL_MS', 1800000, 1000, 86400000),
    rateLimit: integer(env, 'RATE_LIMIT_PER_MINUTE', 6, 1, 60),
    timeout: integer(env, 'DOWNLOAD_TIMEOUT_MS', 20000, 100, 60000),
    maxMedia: integer(env, 'MAX_MEDIA_BYTES', 12582912, 1024, 41943040),
  };
  if (config.enabled) {
    if(publicAccess && !ownerNumber) throw new Error('OWNER_NUMBER required for public activation');
    if (!publicAccess && !allowedChats.size) throw new Error('Set ALLOWED_CHATS before activation');
  }
  return config;
}
