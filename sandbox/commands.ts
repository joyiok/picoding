import { spawn } from 'node:child_process';
import type { CommandResult } from '../shared/types.js';

// This module is invoked by the container worker, never by the host control server.
export function executeCommand(command: string, cwd: string, signal?: AbortSignal, timeout = 120_000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', ['-lc', command], { cwd, env: { ...process.env, WORKER_TOKEN: undefined }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let truncated = false; let settled = false; let timedOut = false;
    const limit = 100_000;
    const collect = (data: Buffer) => {
      const chunk = data.toString();
      if (output.length + chunk.length > limit) truncated = true;
      output = (output + chunk).slice(0, limit);
    };
    const kill = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const abort = () => { kill(); };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); } });
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (timedOut) output += '\n[命令执行超过 120 秒，已停止。长时间运行的服务请使用 nohup … > /tmp/app.log 2>&1 &]';
      if (signal?.aborted) output += '\n[操作已取消]';
      resolve({ output, exitCode, truncated });
    });
    if (signal?.aborted) abort();
  });
}
