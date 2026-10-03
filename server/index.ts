import { config } from './config.js';
import { TaskStore } from './store.js';
import { SettingsStore } from './settings.js';
import { Workbench } from './workbench.js';
import { createApp } from './app.js';
import { configureNetwork } from './network.js';
import { dockerHealth } from './docker.js';
import { AccessControl } from './access.js';
import { acquireDataLease } from './data-lease.js';

const access = new AccessControl(config);
const lease = process.platform === 'win32' ? undefined : await acquireDataLease(config.dataDir);
const network = configureNetwork();
const store = new TaskStore(); const settings = new SettingsStore();
await store.load(); await settings.load();
const workbench = new Workbench(store, settings);
const server = createApp(workbench, access);
let stopping = false;
async function shutdown() {
  if (stopping) return; stopping = true;
  server.close();
  await workbench.shutdown();
  server.closeAllConnections();
  await network.close();
  await lease?.release();
}
lease?.once('lost', () => { console.error('数据目录锁意外中断，正在停止工作台'); process.exitCode = 1; void shutdown(); });
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
try {
  // Own the listening port before touching containers from interrupted tasks.
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  if (store.interruptedIds.length && (await dockerHealth()).available) await workbench.restoreInterruptedSandboxes();
  console.log(`PiCoding is ready at ${access.publicOrigin || `http://${config.host}:${config.port}`}`);
} catch (error) {
  console.error(`工作台启动失败：${error instanceof Error ? error.message : String(error)}`);
  server.close(); workbench.events.close(); await network.destroy(); await lease?.release(); process.exitCode = 1;
}
