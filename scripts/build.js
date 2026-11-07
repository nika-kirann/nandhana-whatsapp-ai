import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url)));
const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url)));
for (const [name,version] of Object.entries(pkg.dependencies)) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || lock.packages[''].dependencies[name]!==version) throw new Error('Dependency lock mismatch');
  require.resolve(name);
}
const sql=await readFile(new URL('../migrations/001_auth.sql',import.meta.url),'utf8');
if (!sql.startsWith('BEGIN;') || !sql.includes('nandhana_auth_records') || !sql.includes('COMMIT;')) throw new Error('Migration missing');
process.stdout.write('Build verified: plain-JS runtime, pinned dependencies and auth schema v1. No credentials loaded.\n');
