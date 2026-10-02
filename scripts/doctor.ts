import { dockerHealth } from '../server/docker.js';
import { SettingsStore } from '../server/settings.js';
import { networkDispatcher } from '../server/network.js';

const settings = new SettingsStore();
await settings.load();
const docker = await dockerHealth();
const model = settings.public();
const [major, minor] = process.versions.node.split('.').map(Number);
const nodeReady = major > 22 || (major === 22 && minor >= 19);
let proxyReady = true;
try { const dispatcher = networkDispatcher(); await dispatcher.destroy(); }
catch (error) { proxyReady = false; console.error(error instanceof Error ? error.message : String(error)); }
console.log(JSON.stringify({ node: { version: process.version, ready: nodeReady }, docker, model: { protocol: model.protocol, baseUrl: model.baseUrl, model: model.model || '(未填写)', configured: model.configured, proxyReady } }, null, 2));
process.exitCode = nodeReady && proxyReady && docker.available && docker.imageReady ? 0 : 1;
