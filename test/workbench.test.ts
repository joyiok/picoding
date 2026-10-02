import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Workbench } from '../server/workbench.js';
import { TaskStore } from '../server/store.js';
import { SettingsStore } from '../server/settings.js';

test('repository import failures keep the source for retry and import before initializing the workspace', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-import-retry-'));
  const store = new TaskStore(join(directory, 'tasks')); await store.load();
  const settings = new SettingsStore(directory); await settings.load();
  let imports = 0; const calls: string[] = [];
  const workbench = new Workbench(store, settings, () => ({
    url: 'http://sandbox.invalid', token: 'test', async start() {}, async stop() {}, async destroy() {},
    async request<T>(path: string) {
      calls.push(path);
      if (path === '/import' && ++imports === 1) throw new Error('clone failed');
      return { exitCode: 0, output: '', head: 'test', branch: 'main' } as T;
    },
  }));
  t.after(async () => { await workbench.shutdown(); await rm(directory, { recursive: true, force: true }); });
  const source = { type: 'git' as const, url: 'https://example.invalid/repo.git', branch: 'main' };
  const task = await workbench.create('Existing project', undefined, source);
  await workbench.start(task.id);
  assert.equal(task.status, 'error'); assert.deepEqual(task.pendingImport, source);
  assert.deepEqual(calls, ['/import']);
  const restored = new TaskStore(store.directory); await restored.load();
  assert.deepEqual(restored.get(task.id).pendingImport, source);
  await workbench.start(task.id);
  assert.equal(task.status, 'ready'); assert.equal(task.pendingImport, undefined);
  assert.deepEqual(task.source, source); assert.deepEqual(calls, ['/import', '/import', '/command']);
  assert.equal(settings.public().configured, false); assert.equal(task.messages.length, 0);
});

test('failed sandbox startup retains the full request and retries it without duplicate messages', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-retry-'));
  const store = new TaskStore(join(directory, 'tasks')); await store.load();
  const settings = new SettingsStore(directory); await settings.load();
  let attempts = 0;
  const workbench = new Workbench(store, settings, () => ({
    url: 'http://sandbox.invalid', token: 'test',
    async start() { if (++attempts === 1) throw new Error('startup failed'); },
    async stop() {}, async destroy() {},
    async request<T>() { return { exitCode: 0, output: '' } as T; },
  }));
  t.after(async () => { await workbench.shutdown(); await rm(directory, { recursive: true, force: true }); });
  const prompt = 'Create a complete app with a request longer than the task title. Keep the full original request.';
  const task = await workbench.create('short title', prompt);
  await workbench.start(task.id); // Join the initial start, which reports failure on the task.
  assert.equal(task.status, 'error'); assert.equal(task.pendingPrompt, prompt);
  assert.equal(task.messages[0].text, prompt);
  const restored = new TaskStore(store.directory); await restored.load();
  assert.equal(restored.get(task.id).pendingPrompt, prompt);
  const sent: unknown[][] = [];
  t.mock.method(workbench, 'send', async (...args: unknown[]) => { sent.push(args); });
  await workbench.start(task.id);
  assert.deepEqual(sent, [[task.id, prompt, true]]);
  assert.equal(task.messages.length, 1); assert.equal(task.status, 'ready');
});
