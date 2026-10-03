import { dockerHealth } from '../server/docker.js';
import { SettingsStore } from '../server/settings.js';
import { networkDispatcher } from '../server/network.js';
import { AccessControl } from '../server/access.js';
import { config } from '../server/config.js';
import { loadAccessCredential } from '../server/access-password.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const settings = new SettingsStore();
await settings.load();
const docker = await dockerHealth();
const model = settings.public();
const [major, minor] = process.versions.node.split('.').map(Number);
const nodeReady = major > 22 || (major === 22 && minor >= 19);
let proxyReady = true;
try { const dispatcher = networkDispatcher(); await dispatcher.destroy(); }
catch (error) { proxyReady = false; console.error(error instanceof Error ? error.message : String(error)); }
let accessReady = true, accessMessage = '仅本机访问', loginEnabled = false;
try { const access = new AccessControl({ ...config, credential: config.password ? undefined : await loadAccessCredential(config.dataDir) }); loginEnabled = access.required; accessMessage = access.publicOrigin ? 'HTTPS 私有部署，需反向代理终止 TLS' : loginEnabled ? '本机访问已启用密码' : accessMessage; }
catch (error) { accessReady = false; accessMessage = error instanceof Error ? error.message : String(error); }
let backupReady = process.platform !== 'win32';
try { await promisify(execFile)('flock', ['--version']); } catch { backupReady = false; }
console.log(JSON.stringify({ node: { version: process.version, ready: nodeReady }, deployment: { ready: accessReady, loginEnabled, publicOrigin: config.publicOrigin || null, message: accessMessage }, maintenance: { backupReady, message: backupReady ? '数据目录互斥和备份工具可用' : '备份需要 Linux/WSL 和 util-linux flock' }, docker, model: { protocol: model.protocol, baseUrl: model.baseUrl, model: model.model || '(未填写)', configured: model.configured, proxyReady } }, null, 2));
process.exitCode = nodeReady && proxyReady && accessReady && (process.platform === 'win32' || backupReady) && docker.available && docker.imageReady ? 0 : 1;
