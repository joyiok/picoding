import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { config } from '../server/config.js';
import { SettingsStore } from '../server/settings.js';
import { TaskStore } from '../server/store.js';
import { Workbench } from '../server/workbench.js';
import { WorkspaceFiles } from '../sandbox/files.js';
import type { FileWriteOptions, Task } from '../shared/types.js';
import { maxUploadBytes } from '../shared/types.js';
import { resourcePackage } from './resource-package.js';

type Reply = { status: number; body: Record<string, unknown> };
// Exercise the real HTTP router without listening on a socket in this restricted workspace.
function request(server: Server, path: string, method = 'GET', body?: unknown, extraHeaders: Record<string, string> = {}): Promise<Reply> {
  return new Promise(resolve => {
    const input = Object.assign(Readable.from(body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]), {
      url: `/api${path}`, method, headers: { host: `127.0.0.1:${config.port}`, ...extraHeaders },
    });
    const response = new EventEmitter() as EventEmitter & { headersSent: boolean; statusCode: number; setHeader: () => void; writeHead: (status: number) => void; end: (text?: string) => void };
    response.headersSent = false;
    response.setHeader = () => {};
    response.writeHead = status => { response.statusCode = status; response.headersSent = true; };
    response.end = text => resolve({ status: response.statusCode, body: JSON.parse(text || '{}') });
    server.emit('request', input as IncomingMessage, response as unknown as ServerResponse);
  });
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-api-'));
  const store = new TaskStore(join(directory, 'tasks')); await store.load();
  const settings = new SettingsStore(directory); await settings.load();
  const workbench = new Workbench(store, settings);
  return { directory, store, settings, workbench, server: createApp(workbench), async close() { await workbench.shutdown(); await rm(directory, { recursive: true, force: true }); } };
}

test('task renaming persists and publishes metadata while preserving running conversations', async t => {
  const state = await setup(); t.after(() => state.close());
  const now = new Date().toISOString(), id = randomUUID();
  const task: Task = { id, title: 'Original title', status: 'running', createdAt: now, updatedAt: now, messages: [{ id: randomUUID(), role: 'user', text: 'Keep conversation', createdAt: now }], tools: [], terminal: [] };
  await state.store.save(task);
  let published = false; const unsubscribe = state.workbench.events.listen(id, event => { if (event.type === 'task' && event.task.title === 'Updated project') published = true; }); t.after(unsubscribe);
  const saved = await request(state.server, '/tasks/' + id, 'PATCH', { title: '  Updated project  ' });
  assert.equal(saved.status, 200); assert.equal(saved.body.title, 'Updated project'); assert.equal(published, true);
  assert.equal(state.store.get(id).status, 'running'); assert.equal(state.store.get(id).messages[0].text, 'Keep conversation');
  assert.equal(JSON.parse(await readFile(join(state.store.directory, id + '.json'), 'utf8')).title, 'Updated project');
  for (const title of ['', '   ', null, 'x'.repeat(121)]) assert.equal((await request(state.server, '/tasks/' + id, 'PATCH', { title })).status, 400);
  assert.equal(state.store.get(id).title, 'Updated project');
  assert.equal((await request(state.server, '/tasks/' + id, 'PATCH', { title: 'Foreign' }, { origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await request(state.server, '/tasks/' + randomUUID(), 'PATCH', { title: 'Missing' })).status, 404);
});

test('task renaming respects the workbench shutdown guard', async t => {
  const state = await setup(); t.after(() => state.close());
  const now = new Date().toISOString(), id = randomUUID();
  await state.store.save({ id, title: 'Keep original', status: 'stopped', createdAt: now, updatedAt: now, messages: [], tools: [], terminal: [] });
  await state.workbench.shutdown();
  assert.equal((await request(state.server, '/tasks/' + id, 'PATCH', { title: 'Changed' })).status, 503);
  assert.equal(state.store.get(id).title, 'Keep original');
});

test('HTTP settings routes hide credentials and reject malformed settings', async t => {
  const state = await setup(); t.after(() => state.close());
  const saved = await request(state.server, '/settings', 'POST', { protocol: 'openai', model: 'test-model', baseUrl: 'https://example.invalid/v1', apiKey: 'test-only-secret' });
  assert.equal(saved.status, 200); assert.equal(saved.body.hasApiKey, true);
  const settings = await request(state.server, '/settings');
  assert.equal(JSON.stringify(settings.body).includes('test-only-secret'), false);
  assert.equal((await request(state.server, '/settings', 'POST', null)).status, 400);
  assert.equal((await request(state.server, '/settings', 'POST', { protocol: 'openai', model: 'test', baseUrl: 'invalid' })).status, 400);
  assert.equal(state.settings.key(), 'test-only-secret');
  assert.equal((await request(state.server, '/models')).status, 404);
  const changed = await request(state.server, '/settings', 'POST', { protocol: 'anthropic', model: 'my-custom-model', baseUrl: 'https://tenant.invalid', apiKey: 'different-test-secret' });
  assert.equal(changed.status, 200); assert.equal(changed.body.protocol, 'anthropic');
  assert.equal(changed.body.model, 'my-custom-model'); assert.equal(changed.body.baseUrl, 'https://tenant.invalid');
  assert.equal(changed.body.configured, true);
});

test('HTTP router rejects foreign origins and DNS rebinding hosts', async t => {
  const state = await setup(); t.after(() => state.close());
  assert.equal((await request(state.server, '/tasks')).status, 200);
  assert.equal((await request(state.server, '/tasks', 'GET', undefined, { host: `evil.invalid:${config.port}` })).status, 403);
  assert.equal((await request(state.server, '/tasks', 'GET', undefined, { origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await request(state.server, '/tasks', 'GET', undefined, { 'sec-fetch-site': 'cross-site' })).status, 403);
});

test('HTTP Pi package routes use native settings, retain model keys and support filtering and reload', async t => {
  const state = await setup(); t.after(() => state.close());
  await state.settings.update({ protocol: 'openai', model: 'unchanged', baseUrl: 'https://fixture.invalid/v1', apiKey: 'private-model-key' });
  const source = await resourcePackage(state.directory);
  assert.equal((await request(state.server, '/resources')).status, 200);
  const installed = await request(state.server, '/resources/packages', 'POST', { action: 'install', source });
  assert.equal(installed.status, 200); assert.equal((installed.body.skills as unknown[]).length, 1);
  const configuredSource = (installed.body.packages as { source: string }[])[0].source;
  const disabled = await request(state.server, '/resources/packages', 'POST', { action: 'disable', source: configuredSource });
  assert.equal(disabled.status, 200); assert.deepEqual(disabled.body.skills, []);
  assert.equal((await request(state.server, '/resources/packages', 'POST', { action: 'enable', source: configuredSource })).status, 200);
  assert.equal((await request(state.server, '/resources/reload', 'POST', {})).status, 200);
  assert.equal((await request(state.server, '/resources/packages', 'POST', { action: 'update', source: configuredSource })).status, 200);
  assert.equal(state.settings.key(), 'private-model-key'); assert.equal(JSON.stringify(installed.body).includes('private-model-key'), false);
  assert.equal((await request(state.server, '/resources/packages', 'POST', { action: 'remove', source: configuredSource })).status, 200);
  assert.deepEqual((await request(state.server, '/resources')).body.packages, []);
});

test('HTTP Pi package management rejects invalid actions and changes while an agent is running', async t => {
  const state = await setup(); t.after(() => state.close());
  assert.equal((await request(state.server, '/resources/packages', 'POST', { action: 'invalid', source: 'npm:fake' })).status, 400);
  assert.equal((await request(state.server, '/resources/packages', 'POST', { action: 'install', source: '-flag' })).status, 400);
  const now = new Date().toISOString();
  await state.store.save({ id: randomUUID(), title: 'busy', status: 'running', createdAt: now, updatedAt: now, messages: [], tools: [], terminal: [] });
  assert.equal((await request(state.server, '/resources/packages', 'POST', { action: 'install', source: '/missing-fixture' })).status, 409);
  assert.equal((await request(state.server, '/resources/reload', 'POST', {})).status, 409);
  assert.deepEqual((await request(state.server, '/resources')).body.packages, []);
});

test('HTTP model capacities reject invalid values without replacing the saved configuration', async t => {
  const state = await setup(); t.after(() => state.close());
  const settings = { protocol: 'openai', model: 'custom-model', baseUrl: 'https://tenant.invalid/v1', apiKey: 'test-secret', contextWindow: 16_384, maxTokens: 2048, supportsImages: false };
  assert.equal((await request(state.server, '/settings', 'POST', settings)).status, 200);
  for (const invalid of [
    { contextWindow: 0 }, { contextWindow: -1 }, { contextWindow: 1.5 }, { contextWindow: '128000' }, { contextWindow: null },
    { maxTokens: 0 }, { maxTokens: -1 }, { maxTokens: 1.5 }, { maxTokens: 32_768 },
    { supportsImages: 'false' }, { supportsImages: null },
  ]) assert.equal((await request(state.server, '/settings', 'POST', { ...settings, ...invalid })).status, 400);
  const saved = await request(state.server, '/settings');
  assert.equal(saved.body.contextWindow, 16_384);
  assert.equal(saved.body.maxTokens, 2048);
  assert.equal(saved.body.supportsImages, false);
  assert.equal(state.settings.key(), 'test-secret');
});

test('HTTP file saves require a version and preserve newer workspace content', async t => {
  const state = await setup(); t.after(() => state.close());
  const workspace = join(state.directory, 'workspace');
  await mkdir(workspace);
  const files = new WorkspaceFiles(workspace);
  const task: Task = { id: randomUUID(), title: 'files', status: 'ready', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [], tools: [], terminal: [] };
  await state.store.save(task);
  t.mock.method(state.workbench, 'sandbox', () => ({
    url: 'http://sandbox.invalid', token: 'test', async stop() {}, async destroy() {},
    async request<T>(path: string, body?: { path: string; content: string } & FileWriteOptions) {
      if (path === '/file' && body) return files.write(body.path, body.content, body) as Promise<T>;
      throw new Error('Unexpected worker request');
    },
  }));
  const route = `/tasks/${task.id}/file`;
  assert.equal((await request(state.server, route, 'POST', { path: 'app.ts', content: '', createOnly: true })).status, 200);
  assert.equal((await request(state.server, route, 'POST', { path: 'app.ts', content: '', createOnly: true })).status, 409);
  assert.equal((await request(state.server, route, 'POST', { path: 'app.ts', content: 'missing version' })).status, 400);
  assert.equal((await request(state.server, route, 'POST', { path: 'app.ts', content: 'bad flag', createOnly: 'true' })).status, 400);
  const original = await files.read('app.ts');
  await files.write('app.ts', 'new agent content');
  const conflict = await request(state.server, route, 'POST', { path: 'app.ts', content: 'old draft', expectedVersion: original.version });
  assert.equal(conflict.status, 409);
  assert.equal((await files.read('app.ts')).content, 'new agent content');
});

test('HTTP binary uploads enforce task state, relative paths, size limits and exclusive creation', async t => {
  const state = await setup(); t.after(() => state.close());
  const workspace = join(state.directory, 'workspace'); await mkdir(workspace);
  const files = new WorkspaceFiles(workspace);
  const task: Task = { id: randomUUID(), title: 'upload', status: 'ready', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [], tools: [], terminal: [] };
  await state.store.save(task);
  t.mock.method(state.workbench, 'sandbox', () => ({
    url: 'http://sandbox.invalid', token: 'test', async stop() {}, async destroy() {},
    async request<T>(path: string, body?: { path: string; content: string }) {
      assert.equal(path, '/upload'); assert.ok(body);
      return files.upload(body.path, Buffer.from(body.content, 'base64')) as Promise<T>;
    },
  }));
  const route = '/tasks/' + task.id + '/upload?path=';
  const content = Buffer.from([0, 255, 128, 1]);
  const saved = await request(state.server, route + 'assets/data.bin', 'POST', content);
  assert.equal(saved.status, 200); assert.equal(saved.body.size, content.length);
  assert.equal((await request(state.server, route + 'assets/data.bin', 'POST', content)).status, 409);
  assert.equal((await request(state.server, route + '../escape.bin', 'POST', content)).status, 400);
  assert.equal((await request(state.server, route + '.picoding/settings.json', 'POST', content)).status, 403);
  assert.equal((await request(state.server, route + 'large.bin', 'POST', Buffer.alloc(maxUploadBytes + 1))).status, 413);
  task.status = 'running';
  assert.equal((await request(state.server, route + 'busy.bin', 'POST', content)).status, 409);
  assert.equal((await request(state.server, '/tasks', 'POST', { source: { type: 'git', url: 'file:///tmp/repo' } })).status, 400);
});
