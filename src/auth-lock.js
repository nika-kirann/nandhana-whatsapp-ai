import { open, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
export async function acquireAuthLock(dir) {
  if ((await lstat(dir)).isSymbolicLink()) throw new Error('Unsafe auth directory');
  const path = join(dir, '.session.lock');
  const file = await open(path, 'wx', 0o600);
  await file.writeFile(String(process.pid));
  let released = false;
  return async () => { if (!released) { released = true; await file.close(); await rm(path, { force: true }); } };
}
