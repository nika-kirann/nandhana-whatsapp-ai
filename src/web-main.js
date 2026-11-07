import { readWebConfig } from './web-config.js';
import { readConfig } from './config.js';
import { createOwnerServer } from './web-server.js';
import { createWebPairing, liveWebPairing } from './web-pairing.js';
import { resolvePairAuthDir } from './pair-cli.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function webMain() {
  const web = readWebConfig(), bot = readConfig();
  // Third-party auth libraries may log sensitive protocol data: silence process console.
  for (const method of ['log','info','warn','error','debug','trace','dir']) console[method] = () => {};
  const authDir = resolvePairAuthDir();
  const pairing = createWebPairing({ enabled: !bot.enabled, run: options => liveWebPairing({ ...options, authDir }) });
  const server = createOwnerServer(web, pairing);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(web.port, '0.0.0.0', resolve); });
  let runningBot;
  if (bot.enabled) {
    try { const { main } = await import('./main.js'); runningBot = await main(); }
    catch { await pairing.close(); server.close(); throw new Error('Downloader startup failed'); }
  }
  let stopping = false;
  async function stop() {
    if (stopping) return; stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000); deadline.unref();
    await pairing.close(); await runningBot?.stop();
    server.close(); server.closeAllConnections(); clearTimeout(deadline);
  }
  process.once('SIGTERM', () => void stop()); process.once('SIGINT', () => void stop());
  return { server, stop };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  webMain().catch(() => { process.stderr.write('Web startup refused. Check owner configuration, PORT and session lock.\n'); process.exitCode = 1; });
}
