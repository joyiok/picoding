import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Workbench } from '../server/workbench.js';
import { TaskStore } from '../server/store.js';
import { SettingsStore } from '../server/settings.js';
import type { Task } from '../shared/types.js';
import { randomUUID } from 'node:crypto';

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

test('shutdown cancels startup and retains an unexecuted prompt for retry', { timeout: 3000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-shutdown-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new TaskStore(join(directory, 'tasks')); await store.load(); const settings = new SettingsStore(directory); await settings.load();
  let started!: () => void; const starting = new Promise<void>(resolve => { started = resolve; }); let stopped = 0;
  const workbench = new Workbench(store, settings, () => ({
    url: 'http://sandbox.invalid', token: 'test',
    async start(signal?: AbortSignal) { started(); await new Promise<void>((resolve, reject) => { if (signal?.aborted) reject(signal.reason); else signal?.addEventListener('abort', () => reject(signal.reason), { once: true }); }); },
    async stop() { stopped++; }, async destroy() {}, async request<T>() { throw new Error('Startup must not execute tools'); },
  }));
  const sent: string[] = []; t.mock.method(workbench, 'send', async (_id: string, text: string) => { sent.push(text); });
  const task = await workbench.create('Pending', 'Keep this full request'); await starting;
  await workbench.shutdown(); assert.equal(task.status, 'stopped'); assert.equal(task.pendingPrompt, 'Keep this full request'); assert.equal(task.messages.length, 1); assert.deepEqual(sent, []); assert.equal(stopped, 1);
  const restored = new TaskStore(store.directory); await restored.load(); assert.equal(restored.get(task.id).pendingPrompt, 'Keep this full request');
  await assert.rejects(workbench.create('After shutdown'), /正在关闭/);
});

test('startup recovery stops only previously interrupted task containers and preserves their data', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-recovery-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const before = new TaskStore(join(directory, 'tasks')); await before.load(); const settings = new SettingsStore(directory); await settings.load();
  const now = new Date().toISOString();
  const active: Task = { id: randomUUID(), title: 'Interrupted', status: 'running', createdAt: now, updatedAt: now, messages: [], tools: [], terminal: [] };
  const stopped: Task = { ...active, id: randomUUID(), status: 'stopped' }; await before.save(active); await before.save(stopped);
  const store = new TaskStore(before.directory); await store.load(); const cleanups: string[] = [];
  const workbench = new Workbench(store, settings, id => ({ url: '', token: 'test', async start() {}, async stop() { cleanups.push(id); }, async destroy() { throw new Error('Recovery must preserve the volume'); }, async request<T>() { throw new Error('Recovery must not execute a tool'); } }));
  t.after(() => workbench.shutdown()); await workbench.restoreInterruptedSandboxes();
  assert.deepEqual(cleanups, [active.id]); assert.equal(store.list().length, 2); assert.equal(store.get(active.id).status, 'stopped');
});
