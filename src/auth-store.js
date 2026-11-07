import { readAuthConfig, makeAuthPool } from './auth-config.js';
import { resolvePairAuthDir } from './auth-path.js';
import { acquireAuthLock } from './auth-lock.js';
import { mkdir, chmod, lstat } from 'node:fs/promises';
export async function openAuthStore({ env = process.env, onLost = () => {} } = {}) {
  const config = readAuthConfig(env);
  const { useMultiFileAuthState, initAuthCreds, BufferJSON, proto } = await import('@whiskeysockets/baileys');
  if (config.store === 'postgres') {
    const { openPostgresAuth } = await import('./postgres-auth.js');
    return openPostgresAuth({ pool: await makeAuthPool(config), sessionId: config.sessionId, key: config.key,
      codec: BufferJSON, initCreds: initAuthCreds, fromAppState: value => proto.Message.AppStateSyncKeyData.fromObject(value), onLost });
  }
  const dir = resolvePairAuthDir(env); process.umask(0o077);
  try { if ((await lstat(dir)).isSymbolicLink()) throw new Error('Unsafe auth directory'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dir,{recursive:true,mode:0o700}); await chmod(dir,0o700);
  const release=await acquireAuthLock(dir);
  try {
    const auth=await useMultiFileAuthState(dir); let active=true;
    const assertActive=()=>{if(!active)throw new Error('AUTH_SESSION_CLOSED')};
    return {...auth,assertActive,guard:async()=>assertActive(),close:async()=>{active=false;await release()}};
  } catch(error) { await release(); throw error; }
}
