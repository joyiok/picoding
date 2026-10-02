import { dockerHealth } from '../server/docker.js';
import { SettingsStore } from '../server/settings.js';

const settings = new SettingsStore();
await settings.load();
const docker = await dockerHealth();
const model = settings.public();
console.log(JSON.stringify({ node: process.version, docker, model: { protocol: model.protocol, baseUrl: model.baseUrl, model: model.model || '(未填写)', configured: model.configured } }, null, 2));
process.exitCode = docker.available && docker.imageReady ? 0 : 1;
