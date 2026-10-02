import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserAction, BrowserState, CommandResult, FileContent, FileEntry, FileWriteOptions } from '../shared/types.js';
import { config } from './config.js';
import { errorMessage, HttpError } from './http.js';

export function docker(args: string[], timeout = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let stderr = ''; let settled = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('Docker 操作超时')); }, timeout);
    function finish(error?: Error) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(output.trim());
    }
    child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    child.on('error', (error) => finish(new Error(`无法运行 Docker：${error.message}`)));
    child.on('exit', (code) => finish(code === 0 ? undefined : new Error(stderr.trim() || `Docker 退出码：${code}`)));
  });
}

export async function dockerHealth() {
  try {
    await docker(['info', '--format', '{{.ServerVersion}}'], 5000);
    try {
      await docker(['image', 'inspect', config.image, '--format', '{{.Id}}'], 5000);
      return { available: true, imageReady: true, message: '沙盒已就绪' };
    } catch {
      return { available: true, imageReady: false, message: '请先运行 npm run sandbox:build 构建环境镜像' };
    }
  } catch (error) {
    return { available: false, imageReady: false, message: `Docker 尚未就绪：${errorMessage(error)}` };
  }
}

export interface Sandbox {
  request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
  readonly url: string;
  readonly token: string;
  copyResources?(source: string, destination: string, signal?: AbortSignal): Promise<void>;
}

export class DockerSandbox implements Sandbox {
  readonly token = randomBytes(32).toString('hex');
  url = '';
  constructor(readonly id: string) {
    if (!/^[a-f\d-]{36}$/.test(id)) throw new Error('无效的任务 ID');
  }
  get name() { return `picoding-${this.id}`; }
  get volume() { return `picoding-work-${this.id}`; }

  async start(signal?: AbortSignal) {
    signal?.throwIfAborted();
    // Only remove a container with this task's exact, application-generated name.
    await this.stop();
    try {
      const proxy = await this.networkProxy();
      const proxyEnv = proxy ? ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'].flatMap(key => ['--env', key + '=' + proxy]).concat(['--env', 'NO_PROXY=localhost,127.0.0.1,::1', '--env', 'no_proxy=localhost,127.0.0.1,::1']) : [];
      await docker([
        'run', '--detach', '--init', '--name', this.name,
        '--label', 'app=picoding', '--label', `picoding.task=${this.id}`,
        '--user', '1000:1000', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges=true', '--read-only',
        '--pids-limit', '256', '--memory', config.memory, '--cpus', config.cpus,
        '--shm-size', '256m',
        '--tmpfs', '/tmp:rw,nosuid,size=512m,mode=1777',
        '--tmpfs', '/home/agent:rw,nosuid,uid=1000,gid=1000,size=512m',
        '--mount', `type=volume,src=${this.volume},dst=/workspace`,
        '--publish', '127.0.0.1::4311',
        ...proxyEnv, '--env', `WORKER_TOKEN=${this.token}`, config.image,
      ]);
      const port = await docker(['inspect', '--format', '{{(index (index .NetworkSettings.Ports "4311/tcp") 0).HostPort}}', this.name]);
      if (!/^\d+$/.test(port)) throw new Error('Docker 未分配沙盒端口');
      this.url = `http://127.0.0.1:${port}`;
      const deadline = Date.now() + 45_000;
      let lastError = '';
      while (Date.now() < deadline) {
        signal?.throwIfAborted();
        try { await this.request('/health', undefined, signal ? AbortSignal.any([signal, AbortSignal.timeout(2000)]) : AbortSignal.timeout(2000)); return; }
        catch (error) { lastError = errorMessage(error); await delay(500, undefined, { signal }); }
      }
      throw new Error(`沙盒启动失败：${lastError}`);
    } catch (error) { await this.stop().catch(() => {}); throw error; }
  }

  async request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal || AbortSignal.timeout(130_000),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: '沙盒请求失败' })) as { error?: string };
      throw new HttpError(response.status, data.error || '沙盒请求失败');
    }
    return response.json() as Promise<T>;
  }

  async copyResources(source: string, destination: string, signal?: AbortSignal) {
    if (!/^\/workspace\/\.picoding\/pi-skills\/[a-f\d]{24}$/.test(destination)) throw new Error('无效的 skill 资源目录');
    signal?.throwIfAborted();
    const prepared = await sandboxApi.command(this, `mkdir -p -- '${destination}'`, signal);
    if (prepared.exitCode !== 0) throw new Error(prepared.output || '无法准备 skill 资源目录');
    // Use standard tar and Docker transport, with extraction as the existing non-root user.
    // Only the selected skill directory is transferred; host settings/auth are never mounted.
    const controller = new AbortController();
    const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
    const pack = spawn('tar', ['--exclude=.git', '-cf', '-', '-C', source, '.'], { stdio: ['ignore', 'pipe', 'pipe'], signal: combined });
    const unpack = spawn('docker', ['exec', '-i', this.name, 'tar', '--no-same-owner', '-xf', '-', '-C', destination], { stdio: ['pipe', 'ignore', 'pipe'], signal: combined });
    let failure = '';
    for (const stream of [pack.stderr, unpack.stderr]) stream.on('data', data => { failure = (failure + data.toString()).slice(-2000); });
    const exited = (child: ChildProcess) => new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(failure || 'skill 资源传输失败'))); });
    const timer = setTimeout(() => controller.abort(), 60_000);
    try { await Promise.all([exited(pack), exited(unpack), pipeline(pack.stdout, unpack.stdin)]); }
    finally { clearTimeout(timer); controller.abort(); }
  }

  async stop() {
    // Let the worker close Chromium's persistent profile and flush storage.
    // Killing it immediately can lose changes made just before Stop.
    try { await docker(['stop', '--time', '5', this.name], 10_000); }
    catch (error) { if (!/No such container/i.test(errorMessage(error))) throw error; }
    try { await docker(['rm', '-f', this.name]); }
    catch (error) { if (!/No such container/i.test(errorMessage(error))) throw error; }
    try { await docker(['rm', '-f', 'picoding-proxy-' + this.id]); }
    catch (error) { if (!/No such container/i.test(errorMessage(error))) throw error; }
  }
  async destroy() {
    await this.stop();
    try { await docker(['volume', 'rm', this.volume]); }
    catch (error) { if (!/No such volume/i.test(errorMessage(error))) throw error; }
  }

  private async networkProxy() {
    if (!config.sandboxProxy || config.sandboxProxy === 'none') return '';
    let proxy: URL;
    try { proxy = new URL(config.sandboxProxy); }
    catch { throw new HttpError(400, '任务环境代理地址无效，请检查 PICODING_SANDBOX_PROXY'); }
    if (!['http:', 'https:'].includes(proxy.protocol)) throw new HttpError(400, '任务环境仅支持 HTTP 或 HTTPS 代理');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(proxy.hostname)) return proxy.href;
    const gateway = await docker(['network', 'inspect', 'bridge', '--format', '{{range .IPAM.Config}}{{.Gateway}}{{end}}']);
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(gateway)) throw new Error('无法找到 Docker 网桥，请为任务环境配置可访问的代理地址');
    const name = 'picoding-proxy-' + this.id;
    const token = randomBytes(32).toString('hex');
    await docker(['run', '--detach', '--init', '--name', name, '--label', 'app=picoding', '--label', 'picoding.task=' + this.id,
      '--network', 'host', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true', '--read-only',
      '--pids-limit', '32', '--memory', '128m', '--cpus', '0.25', '--entrypoint', 'node',
      '--env', 'PICODING_PROXY_RELAY=1', '--env', 'UPSTREAM_PROXY=' + proxy.href,
      '--env', 'RELAY_TOKEN=' + token, '--env', 'RELAY_GATEWAY=' + gateway,
      config.image, '/opt/picoding/dist/sandbox/forward-proxy.js']);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const port = /PROXY_PORT=(\d+)/.exec(await docker(['logs', name]))?.[1];
      if (port) return 'http://task:' + token + '@' + gateway + ':' + port;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('任务环境代理启动失败，请检查代理地址和 Docker host 网络支持');
  }
}

export const sandboxApi = {
  files: (sandbox: Sandbox, path = '') => sandbox.request<FileEntry[]>(`/files?path=${encodeURIComponent(path)}`),
  read: (sandbox: Sandbox, path: string) => sandbox.request<FileContent>(`/file?path=${encodeURIComponent(path)}`),
  write: (sandbox: Sandbox, path: string, content: string, options: FileWriteOptions = {}) => sandbox.request<{ ok: true; version: string }>('/file', { path, content, ...options }),
  command: (sandbox: Sandbox, command: string, signal?: AbortSignal) => sandbox.request<CommandResult>('/command', { command }, signal),
  browser: (sandbox: Sandbox) => sandbox.request<BrowserState>('/browser'),
  action: (sandbox: Sandbox, action: BrowserAction, signal?: AbortSignal) => sandbox.request<BrowserState & { snapshot?: string; screenshot?: string }>('/browser', action, signal),
};
