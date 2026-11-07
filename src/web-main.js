import { readWebConfig } from './web-config.js';
import { readConfig } from './config.js';
import { createOwnerServer } from './web-server.js';
import { createOwnerRuntime } from './owner-runtime.js';
import { migrateAuthSchema } from './auth-schema.js';
import { resolvePairAuthDir } from './auth-path.js';
import { readAuthConfig, AuthConfigurationError } from './auth-config.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function webMain() {
  const web = readWebConfig(); readConfig();
  // Third-party auth libraries may log sensitive protocol data: silence process console.
  for (const method of ['log','info','warn','error','debug','trace','dir']) console[method] = () => {};
  const authConfig = readAuthConfig();
  if (authConfig.store === 'file') resolvePairAuthDir();
  await migrateAuthSchema(authConfig);
  const pairing = createOwnerRuntime();
  const server = createOwnerServer(web, pairing);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(web.port, '0.0.0.0', resolve); });
  let stopping = false;
  async function stop() {
    if (stopping) return; stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000); deadline.unref();
    await pairing.close();
    server.close(); server.closeAllConnections(); clearTimeout(deadline);
  }
  process.once('SIGTERM', () => void stop()); process.once('SIGINT', () => void stop());
  return { server, stop };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  webMain().catch(error => { process.stderr.write(error instanceof AuthConfigurationError ? 'Web startup refused: ' + error.message + '\n' : 'Web startup refused. Check owner configuration, PORT and session lock.\n'); process.exitCode = 1; });
}
