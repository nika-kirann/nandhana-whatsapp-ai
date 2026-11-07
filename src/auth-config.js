export class AuthConfigurationError extends Error {}
export function readAuthConfig(env = process.env) {
  const store = env.AUTH_STORE || (env.DATABASE_URL ? 'postgres' : 'file');
  if (!['file','postgres'].includes(store)) throw new AuthConfigurationError('AUTH_STORE must be file or postgres');
  if (store === 'file') return { store };
  const sessionId = env.SESSION_ID || '';
  if (sessionId && !/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) throw new AuthConfigurationError('Invalid SESSION_ID: 1-64 letters/digits/underscore/hyphen');
  const key = env.AUTH_ENCRYPTION_KEY || '';
  if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new AuthConfigurationError('AUTH_ENCRYPTION_KEY required: 64 hexadecimal characters');
  const connectionString = env.DATABASE_URL;
  let url;
  try { url = new URL(connectionString); } catch { throw new AuthConfigurationError('DATABASE_URL required'); }
  if (!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname || url.pathname === '/' || !url.username) throw new AuthConfigurationError('Invalid Postgres connection settings');
  if (url.searchParams.has('sslmode') && !['require','verify-full','verify-ca'].includes(url.searchParams.get('sslmode'))) throw new AuthConfigurationError('Database TLS cannot be disabled');
  for (const name of ['sslcert','sslkey','sslrootcert','ssl','host','hostaddr','tls','rejectUnauthorized']) if (url.searchParams.has(name)) throw new AuthConfigurationError('Unsupported database transport override');
  // pg connection-string sslmode can overwrite the explicit verifying SSL object.
  url.searchParams.delete('sslmode'); url.searchParams.delete('uselibpqcompat');
  return { store, sessionId, key: Buffer.from(key, 'hex'), connectionString: url.toString() };
}
export async function makeAuthPool(config) {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: config.connectionString, ssl: { rejectUnauthorized: true },
    max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
    query_timeout: 5000, enableChannelBinding: true, application_name: 'nandhana-auth' });
  // Idle-client failures are handled by the store's lease watchdog, never logged raw.
  pool.on('error', () => {});
  return pool;
}
