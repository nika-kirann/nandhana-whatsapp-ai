import { readFile } from 'node:fs/promises';
import { makeAuthPool, AuthConfigurationError } from './auth-config.js';
export async function migrateAuthSchema(config, poolFactory = makeAuthPool) {
  if (config.store !== 'postgres') return;
  const pool=await poolFactory(config);
  try { await pool.query(await readFile(new URL('../migrations/001_auth.sql',import.meta.url),'utf8')); }
  catch { throw new AuthConfigurationError('Database schema setup failed. Check DATABASE_URL, TLS and table permissions.'); }
  finally { await pool.end(); }
}
