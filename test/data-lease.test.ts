import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireDataLease } from '../server/data-lease.js';

test('the data lease rejects concurrent service or maintenance access and permits reacquiring after release', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-lease-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const lease = await acquireDataLease(directory); t.after(() => lease.release());
  await assert.rejects(acquireDataLease(directory), /正在使用/);
  const alias = directory + '-alias'; await symlink(directory, alias); t.after(() => rm(alias));
  await assert.rejects(acquireDataLease(alias), /正在使用/);
  await lease.release(); const next = await acquireDataLease(directory); await next.release();
});

test('a killed control process leaves no stale data lock requiring manual cleanup', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-crash-lease-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const script = `import { acquireDataLease } from './server/data-lease.ts'; await acquireDataLease(${JSON.stringify(directory)}); process.stdout.write('ready\\n'); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  await new Promise<void>((resolve, reject) => { child.stdout.on('data', data => { if (data.toString().includes('ready')) resolve(); }); child.on('error', reject); child.on('exit', () => reject(new Error('fixture exited before acquiring lock'))); });
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  const deadline = Date.now() + 5000;
  while (true) {
    try { const lease = await acquireDataLease(directory); await lease.release(); break; }
    catch (error) { if (Date.now() >= deadline) throw error; await delay(25); }
  }
});

test('a lost lock notifies its owning service', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-lost-lease-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const lease = await acquireDataLease(directory), lost = once(lease, 'lost');
  lease.child.kill('SIGKILL'); await lost; await lease.release();
});
