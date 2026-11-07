import { resolve, join } from 'node:path';
export function resolvePairAuthDir(env = process.env, cwd = process.cwd()) {
  const root = resolve(cwd);
  const path = resolve(root, env.AUTH_DIR || 'auth');
  if (path !== join(root, 'auth') && (path === root || path.startsWith(root + '/'))) {
    throw new Error('Custom AUTH_DIR must be outside the project');
  }
  return path;
}
