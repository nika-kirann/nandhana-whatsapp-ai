import { readAuthConfig } from '../src/auth-config.js';
import { migrateAuthSchema } from '../src/auth-schema.js';
try {
  const config=readAuthConfig();if(config.store!=='postgres') throw new Error();
  await migrateAuthSchema(config);process.stdout.write('Auth schema v1 ready. No WhatsApp connection.\n');
} catch { process.stderr.write('Auth schema setup failed. Check DATABASE_URL, TLS and table permissions.\n');process.exitCode=1; }
