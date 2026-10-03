import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

export const leaseFile = '.service.lock';
export class DataLease extends EventEmitter {
  private releasing = false;
  private released?: Promise<void>;
  constructor(readonly child: ChildProcess) {
    super(); child.once('exit', () => { if (!this.releasing) this.emit('lost'); });
  }
  check() { if (this.child.exitCode !== null || this.child.signalCode !== null) throw new Error('数据目录锁已中断，维护任务不能继续'); }
  release() {
    if (this.released) return this.released;
    this.releasing = true;
    this.released = new Promise<void>(resolve => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) return resolve();
      this.child.once('exit', () => resolve()); this.child.stdin!.end();
    });
    return this.released;
  }
}

export async function acquireDataLease(directory: string): Promise<DataLease> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(await realpath(directory), leaseFile);
  const child = spawn('flock', ['--no-fork', '--exclusive', '--nonblock', '--conflict-exit-code', '73', file, process.execPath, '-e', "process.stdout.write('locked\\n'); process.stdin.resume(); process.stdin.on('end',()=>process.exit(0));"], { stdio: ['pipe', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let settled = false, output = '', errors = '';
    const timer = setTimeout(() => fail(new Error('无法取得数据目录锁，请检查 flock')), 5000);
    function fail(error: Error) { if (settled) return; settled = true; clearTimeout(timer); child.kill(); reject(error); }
    child.on('error', () => fail(new Error('需要 util-linux 提供的 flock；Windows 请在 WSL 中运行')));
    child.stderr!.on('data', chunk => { errors = (errors + chunk.toString()).slice(-2048); });
    child.once('exit', code => fail(new Error(code === 73 ? '工作台或维护任务正在使用这个数据目录，请先停止后重试' : errors || '数据目录锁已中断')));
    child.stdout!.on('data', async chunk => {
      output += chunk.toString(); if (!output.includes('locked\n') || settled) return;
      try { await chmod(file, 0o600); }
      catch (error) { fail(error instanceof Error ? error : new Error(String(error))); return; }
      if (settled) return; settled = true; clearTimeout(timer); resolve(new DataLease(child));
    });
  });
}
