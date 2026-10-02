import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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
}

export class DockerSandbox implements Sandbox {
  readonly token = randomBytes(32).toString('hex');
  url = '';
  constructor(readonly id: string) {
    if (!/^[a-f\d-]{36}$/.test(id)) throw new Error('无效的任务 ID');
  }
  get name() { return `picoding-${this.id}`; }
  get volume() { return `picoding-work-${this.id}`; }

  async start() {
    // Only remove a container with this task's exact, application-generated name.
    await this.stop();
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
      '--env', `WORKER_TOKEN=${this.token}`, config.image,
    ]);
    try {
      const port = await docker(['inspect', '--format', '{{(index (index .NetworkSettings.Ports "4311/tcp") 0).HostPort}}', this.name]);
      if (!/^\d+$/.test(port)) throw new Error('Docker 未分配沙盒端口');
      this.url = `http://127.0.0.1:${port}`;
      const deadline = Date.now() + 45_000;
      let lastError = '';
      while (Date.now() < deadline) {
        try { await this.request('/health', undefined, AbortSignal.timeout(2000)); return; }
        catch (error) { lastError = errorMessage(error); await new Promise(resolve => setTimeout(resolve, 500)); }
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

  async stop() {
    try { await docker(['rm', '-f', this.name]); }
    catch (error) { if (!/No such container/i.test(errorMessage(error))) throw error; }
  }
  async destroy() {
    await this.stop();
    try { await docker(['volume', 'rm', this.volume]); }
    catch (error) { if (!/No such volume/i.test(errorMessage(error))) throw error; }
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
