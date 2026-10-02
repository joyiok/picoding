import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkOrigin } from '../server/http.js';
import { SettingsStore } from '../server/settings.js';
import { TaskStore } from '../server/store.js';
import type { Task } from '../shared/types.js';
import type { IncomingMessage } from 'node:http';

test('task restore preserves history and marks interrupted work as stopped', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-state-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new TaskStore(directory); await store.load();
  const task: Task = { id: randomUUID(), title: '真实任务', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'running', messages: [{ id: 'message', role: 'assistant', text: 'partial', streaming: true, createdAt: new Date().toISOString() }], tools: [{ id: 'tool', name: 'sandbox_write', args: {}, status: 'running', createdAt: new Date().toISOString() }], terminal: [] };
  await Promise.all([store.save(task), store.save({ ...task, title: '保存后的任务' })]);
  const restored = new TaskStore(directory); await restored.load();
  const result = restored.get(task.id);
  assert.equal(result.title, '保存后的任务'); assert.equal(result.status, 'stopped');
  assert.equal(result.messages[0].text, 'partial'); assert.equal(result.messages[0].streaming, false);
  assert.equal(result.tools[0].status, 'error');
});

test('settings keep API keys private and retain existing keys when omitted', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = new SettingsStore(directory); await settings.load();
  await settings.update({ protocol: 'openai', model: 'test-model', baseUrl: 'https://example.invalid/v1', apiKey: 'test-secret' });
  assert.equal(JSON.stringify(settings.public()).includes('test-secret'), false);
  assert.equal(settings.public().hasApiKey, true);
  assert.equal((await stat(join(directory, 'settings.json'))).mode & 0o777, 0o600);
  await settings.update({ protocol: 'openai', model: 'other-model', baseUrl: 'https://example.invalid/v1' });
  assert.equal(settings.key(), 'test-secret');
});

test('local API rejects cross-site requests', () => {
  const allowed = new Set(['http://127.0.0.1:4310']);
  assert.throws(() => checkOrigin({ headers: { origin: 'https://evil.invalid' } } as IncomingMessage, allowed), /无权访问/);
  assert.throws(() => checkOrigin({ headers: { 'sec-fetch-site': 'cross-site' } } as IncomingMessage, allowed), /跨站/);
  assert.doesNotThrow(() => checkOrigin({ headers: { origin: 'http://127.0.0.1:4310' } } as IncomingMessage, allowed));
});

test('both API formats require a custom endpoint and never reuse a stored key at another endpoint', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-protocol-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = new SettingsStore(directory); await settings.load();
  for (const protocol of ['openai', 'anthropic'] as const) {
    await assert.rejects(settings.update({ protocol, model: 'my-model', baseUrl: '', apiKey: 'test-secret' }), /API 地址/);
    await settings.update({ protocol, model: 'my-model', baseUrl: 'https://my-gateway.invalid/api', apiKey: 'test-secret' });
    assert.equal(settings.public().protocol, protocol); assert.equal(settings.public().configured, true);
    await assert.rejects(settings.update({ protocol, model: 'my-model', baseUrl: 'https://other-gateway.invalid/api' }), /重新填写密钥/);
    assert.equal(settings.get().baseUrl, 'https://my-gateway.invalid/api');
  }
});

test('legacy settings retain the custom endpoint, model and credential during protocol migration', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-settings-migrate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ provider: 'compatible', model: 'tenant-model', baseUrl: 'https://tenant.invalid/v1', apiKey: 'test-secret' }));
  const settings = new SettingsStore(directory); await settings.load();
  assert.equal(settings.get().protocol, 'openai'); assert.equal(settings.get().model, 'tenant-model');
  assert.equal(settings.get().baseUrl, 'https://tenant.invalid/v1'); assert.equal(settings.key(), 'test-secret');
  assert.equal('provider' in settings.public(), false);
  assert.equal(settings.get().contextWindow, 128_000);
  assert.equal(settings.get().maxTokens, 16_384);
  assert.equal(settings.get().supportsImages, true);
});

test('model capacities and image preference survive restart and retain the API key', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-capabilities-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = new SettingsStore(directory); await settings.load();
  assert.equal(settings.public().supportsImages, false);
  const connection = { protocol: 'openai' as const, model: 'my-model', baseUrl: 'https://tenant.invalid/v1' };
  await settings.update({ ...connection, apiKey: 'test-secret', contextWindow: 32_768, maxTokens: 4096, supportsImages: true });
  const restored = new SettingsStore(directory); await restored.load();
  assert.equal(restored.public().contextWindow, 32_768);
  assert.equal(restored.public().maxTokens, 4096);
  assert.equal(restored.public().supportsImages, true);
  await restored.update({ ...connection, supportsImages: false });
  const reloaded = new SettingsStore(directory); await reloaded.load();
  assert.equal(reloaded.public().supportsImages, false);
  assert.equal(reloaded.public().contextWindow, 32_768);
  assert.equal(reloaded.public().maxTokens, 4096);
  assert.equal(reloaded.key(), 'test-secret');
  assert.equal(JSON.stringify(reloaded.public()).includes('test-secret'), false);
});
