import { readFile } from 'node:fs/promises';
import { readAuthConfig, makeAuthPool } from '../src/auth-config.js';
let pool;
try {
  if (!process.env.DATABASE_URL_UNPOOLED) throw new Error();
  const config=readAuthConfig({...process.env, AUTH_STORE:'postgres', DATABASE_URL_POOLED:'', DATABASE_URL:process.env.DATABASE_URL_UNPOOLED});
  if (new URL(config.connectionString).hostname.includes('-pooler')) throw new Error();
  pool=await makeAuthPool(config);
  await pool.query(await readFile(new URL('../migrations/001_auth.sql',import.meta.url),'utf8'));
  process.stdout.write('Auth schema v1 migration complete. No WhatsApp connection.\n');
} catch { process.stderr.write('Auth migration failed. Check direct DATABASE_URL_UNPOOLED, TLS, auth configuration and schema permissions.\n'); process.exitCode=1; }
finally { await pool?.end(); }
