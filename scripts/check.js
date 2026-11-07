import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['src', 'test', 'scripts'].filter(dir => existsSync(dir)).flatMap(dir => readdirSync(dir).filter(x => x.endsWith('.js')).map(x => `${dir}/${x}`));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checks passed: ${files.length} files`);
