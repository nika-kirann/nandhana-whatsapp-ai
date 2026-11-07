export function readWebConfig(env = process.env) {
  const username = env.WEB_OWNER_USERNAME || '';
  const password = env.WEB_OWNER_PASSWORD || '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(username)) throw new Error('Set WEB_OWNER_USERNAME');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(re => re.test(password)).length;
  if (password.length < 24 || password.length > 256 || classes < 3 || new Set(password).size < 10) throw new Error('Strong WEB_OWNER_PASSWORD required');
  let origin;
  try { origin = new URL(env.PUBLIC_ORIGIN); } catch { throw new Error('Set PUBLIC_ORIGIN'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('PUBLIC_ORIGIN must be HTTPS origin');
  const port = Number(env.PORT || 8000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  return { username, password, origin: origin.origin, host: origin.host, port };
}
