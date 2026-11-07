const integer = (env, key, fallback, min, max) => {
  const value = Number(env[key] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
  return value;
};
export function readConfig(env = process.env) {
  if (env.BOT_ENABLED && !['true', 'false'].includes(env.BOT_ENABLED)) throw new Error('Invalid BOT_ENABLED');
  const allowedChats = new Set((env.ALLOWED_CHATS || '').split(',').map(x => x.trim()).filter(Boolean));
  if ([...allowedChats].some(x => !/^\d+@(s\.whatsapp\.net|lid)$/.test(x))) throw new Error('Invalid ALLOWED_CHATS');
  const name = env.BOT_NAME?.trim() || 'Nandhana';
  if (!/^[\p{L}\p{N} _-]{1,40}$/u.test(name)) throw new Error('Invalid BOT_NAME');
  const config = {
    enabled: env.BOT_ENABLED === 'true', name, allowedChats,
    authDir: env.AUTH_DIR || './auth',
    maxInput: integer(env, 'MAX_INPUT_CHARS', 2000, 1, 10000),
    maxChats: integer(env, 'MAX_CHATS', 100, 1, 1000),
    chatTtl: integer(env, 'CHAT_TTL_MS', 1800000, 1000, 86400000),
    rateLimit: integer(env, 'RATE_LIMIT_PER_MINUTE', 6, 1, 60),
    timeout: integer(env, 'DOWNLOAD_TIMEOUT_MS', 20000, 100, 60000),
    maxMedia: integer(env, 'MAX_MEDIA_BYTES', 12582912, 1024, 41943040),
  };
  if (config.enabled) {
    if (!allowedChats.size) throw new Error('Set ALLOWED_CHATS before activation');
  }
  return config;
}
