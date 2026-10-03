import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Workbench } from '../server/workbench.js';
import { SettingsStore } from '../server/settings.js';
import { TaskStore } from '../server/store.js';
import type { Sandbox } from '../server/docker.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function setup(t: TestContext, overrides: Partial<Sandbox> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-lifecycle-'));
  const store = new TaskStore(join(directory, 'tasks')); await store.load();
  const settings = new SettingsStore(directory); await settings.load();
  const sandbox = {
    url: 'http://sandbox.invalid', token: 'test', async start() {}, async stop() {}, async destroy() {},
    async request<T>() { return { exitCode: 0, output: '' } as T; }, ...overrides,
  };
  const workbench = new Workbench(store, settings, () => sandbox);
  t.after(async () => { await workbench.shutdown(); await rm(directory, { recursive: true, force: true }); });
  const task = await workbench.create('Lifecycle'); await workbench.start(task.id);
  return { workbench, store, task, sandbox };
}

test('stop waits for a cancelled command to settle and saves its final history', async t => {
  const result = deferred<{ exitCode: number | null; output: string }>();
  const requested = deferred();
  let signal: AbortSignal | undefined;
  let stopped = 0;
  t.after(() => result.resolve({ exitCode: null, output: 'Cancelled' }));
  const { workbench, store, task } = await setup(t, {
    async stop() { stopped++; },
    async request<T>(path: string, body?: unknown, inputSignal?: AbortSignal) {
      if (path === '/command' && (body as { command: string }).command === 'slow') {
        signal = inputSignal; requested.resolve(); return result.promise as Promise<T>;
      }
      return { exitCode: 0, output: '' } as T;
    },
  });
  const command = workbench.command(task.id, 'slow'); await requested.promise;
  let finished = false;
  const stopping = workbench.stop(task.id).then(() => { finished = true; });
  await setImmediate();
  assert.equal(signal?.aborted, true);
  assert.equal(finished, false, 'Stopping must wait for command history before completing');
  assert.equal(stopped, 0, 'The worker must remain available until the command settles');
  await assert.rejects(workbench.command(task.id, 'another'), /当前操作|停止|结束/);
  result.resolve({ exitCode: null, output: 'Cancelled' });
  await Promise.all([command, stopping]);
  assert.equal(task.status, 'stopped'); assert.equal(stopped, 1);
  const restored = new TaskStore(store.directory); await restored.load();
  assert.equal(restored.get(task.id).terminal.at(-1)?.output, 'Cancelled');
});

test('concurrent stop requests share one environment shutdown', async t => {
  const entered = deferred(); const completed = deferred();
  let stops = 0;
  t.after(() => completed.resolve());
  const { workbench, task } = await setup(t, { async stop() { stops++; entered.resolve(); await completed.promise; } });
  const first = workbench.stop(task.id); await entered.promise;
  const second = workbench.stop(task.id); await setImmediate();
  assert.equal(stops, 1);
  completed.resolve(); await Promise.all([first, second]);
  assert.equal(task.status, 'stopped'); assert.equal(stops, 1);
});

test('deletion waits for commands and blocks restart until project destruction finishes', async t => {
  const result = deferred<{ exitCode: number | null; output: string }>();
  const destroying = deferred(); const destroyed = deferred();
  let destroys = 0;
  t.after(() => { result.resolve({ exitCode: null, output: 'Cancelled' }); destroyed.resolve(); });
  const { workbench, store, task } = await setup(t, {
    async destroy() { destroys++; destroying.resolve(); await destroyed.promise; },
    async request<T>(path: string, body?: unknown) {
      if (path === '/command' && (body as { command: string }).command === 'slow') return result.promise as Promise<T>;
      return { exitCode: 0, output: '' } as T;
    },
  });
  const command = workbench.command(task.id, 'slow');
  const removing = workbench.remove(task.id);
  await setImmediate(); assert.equal(destroys, 0);
  result.resolve({ exitCode: null, output: 'Cancelled' });
  await destroying.promise;
  await assert.rejects(workbench.start(task.id), /删除|停止|结束/);
  await assert.rejects(workbench.remove(task.id), /删除|停止|结束/);
  const stopping = workbench.stop(task.id);
  destroyed.resolve(); await Promise.all([command, removing, stopping]);
  assert.equal(destroys, 1);
  assert.throws(() => store.get(task.id), /任务不存在/);
  await store.flush();
  await assert.rejects(readFile(join(store.directory, task.id + '.json')), { code: 'ENOENT' });
});

test('shutdown waits for cancelled command history before flushing task data', async t => {
  const result = deferred<{ exitCode: number | null; output: string }>();
  t.after(() => result.resolve({ exitCode: null, output: 'Final output' }));
  const { workbench, store, task } = await setup(t, {
    async request<T>(path: string, body?: unknown) {
      if (path === '/command' && (body as { command: string }).command === 'slow') return result.promise as Promise<T>;
      return { exitCode: 0, output: '' } as T;
    },
  });
  const command = workbench.command(task.id, 'slow');
  let finished = false;
  const shutdown = workbench.shutdown().then(() => { finished = true; });
  await setImmediate(); assert.equal(finished, false);
  result.resolve({ exitCode: null, output: 'Final output' });
  await Promise.all([command, shutdown]);
  const restored = new TaskStore(store.directory); await restored.load();
  assert.equal(restored.get(task.id).terminal.at(-1)?.output, 'Final output');
  assert.equal(restored.get(task.id).status, 'stopped');
});

test('a cancelled HTTP command remains visible in terminal history', async t => {
  const { workbench, task } = await setup(t, {
    async request<T>(path: string, body?: unknown, signal?: AbortSignal) {
      if (path === '/command' && (body as { command: string }).command === 'slow') {
        return new Promise<T>((_resolve, reject) => { signal?.addEventListener('abort', () => reject(signal.reason), { once: true }); });
      }
      return { exitCode: 0, output: '' } as T;
    },
  });
  const command = workbench.command(task.id, 'slow');
  await workbench.stop(task.id);
  const entry = await command;
  assert.equal(entry.exitCode, null); assert.match(entry.output, /操作已取消/);
  assert.equal(task.terminal.at(-1)?.command, 'slow');
});

test('returning control cannot make a stopping task ready again', async t => {
  const returning = deferred(); const returned = deferred();
  const stopping = deferred(); const stopped = deferred();
  t.after(() => { returned.resolve(); stopped.resolve(); });
  const { workbench, task } = await setup(t, {
    async stop() { stopping.resolve(); await stopped.promise; },
    async request<T>(path: string) {
      if (path === '/terminal/release') { returning.resolve(); await returned.promise; }
      return { exitCode: 0, output: '', url: 'about:blank', title: '', tabs: [] } as T;
    },
  });
  await workbench.abort(task.id, true);
  const release = workbench.release(task.id); await returning.promise;
  const stop = workbench.stop(task.id);
  returned.resolve(); await stopping.promise;
  assert.equal(task.status, 'pausing');
  await assert.rejects(workbench.send(task.id, 'new request'), /停止/);
  stopped.resolve(); await Promise.all([release, stop]);
  assert.equal(task.status, 'stopped');
});

test('failed shutdown retains task data and releases its guard for a successful retry', async t => {
  let stops = 0;
  const { workbench, store, task } = await setup(t, {
    async stop() { if (++stops === 1) throw new Error('Temporary Docker failure'); },
  });
  await assert.rejects(workbench.stop(task.id), /Temporary Docker failure/);
  assert.equal(task.status, 'error'); assert.equal(store.list().length, 1);
  const restored = new TaskStore(store.directory); await restored.load();
  assert.equal(restored.get(task.id).error, 'Temporary Docker failure');
  await workbench.stop(task.id); assert.equal(task.status, 'stopped');
  await workbench.start(task.id); assert.equal(task.status, 'ready');
  assert.equal(task.error, undefined);
});
