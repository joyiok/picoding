import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
const names = ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'no_proxy', 'NO_PROXY'];
const proxies = names.filter(name => !name.toLowerCase().startsWith('no_') && process.env[name]);
const loopback = proxies.some(name => {
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env[name]!).hostname); }
  catch { throw new Error('镜像构建代理地址无效，请检查 HTTP(S)_PROXY'); }
});
const network = process.env.PICODING_BUILD_NETWORK || (loopback && process.platform === 'linux' ? 'host' : '');
const args = ['build', ...(network ? ['--network', network] : []), ...names.filter(name => process.env[name]).flatMap(name => ['--build-arg', name]), '-t', process.env.PICODING_SANDBOX_IMAGE || 'picoding-sandbox:local', '-f', 'sandbox/Dockerfile', '.'];
const child = spawn('docker', args, { stdio: 'inherit' });
child.on('error', error => { console.error('镜像构建失败：' + error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
