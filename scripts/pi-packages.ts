import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../server/config.js';

const args = process.argv.slice(2);
if (!['install', 'remove', 'update', 'list', 'config'].includes(args[0])) {
  console.error('使用 pi 官方命令：npm run pi:packages -- install|remove|update|list|config [来源]');
  process.exitCode = 1;
} else {
  const directory = join(config.dataDir, 'pi'); await mkdir(directory, { recursive: true, mode: 0o700 });
  const entry = fileURLToPath(new URL('../node_modules/@earendil-works/pi-coding-agent/dist/cli.js', import.meta.url));
  const child = spawn(process.execPath, [entry, ...args], { stdio: 'inherit', env: { ...process.env, PI_CODING_AGENT_DIR: directory } });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => child.kill(signal));
}
