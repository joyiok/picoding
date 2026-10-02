import { config } from './config.js';
import { TaskStore } from './store.js';
import { SettingsStore } from './settings.js';
import { Workbench } from './workbench.js';
import { createApp } from './app.js';

if (!['127.0.0.1', 'localhost'].includes(config.host)) throw new Error('第一版是本地单用户工作台，PICODING_HOST 必须为 127.0.0.1 或 localhost');
const store = new TaskStore(); const settings = new SettingsStore();
await store.load(); await settings.load();
const workbench = new Workbench(store, settings);
const server = createApp(workbench);
server.on('error', error => { console.error(`工作台启动失败：${error.message}`); process.exitCode = 1; });
server.listen(config.port, config.host, () => console.log(`PiCoding is ready at http://${config.host}:${config.port}`));
let stopping = false;
async function shutdown() {
  if (stopping) return; stopping = true;
  server.close();
  await workbench.shutdown();
  server.closeAllConnections();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
