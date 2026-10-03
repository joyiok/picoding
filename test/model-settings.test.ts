import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from '../server/settings.js';
import { TaskStore } from '../server/store.js';
import { Workbench } from '../server/workbench.js';
import { textReply } from './provider.js';

const first = { protocol: 'openai' as const, baseUrl: 'https://first.invalid/v1', model: 'first-model', apiKey: 'first-fixture-key', providerName: '供应商甲' };
const second = { protocol: 'openai' as const, baseUrl: 'https://second.invalid/v1', model: 'second-model', apiKey: 'second-fixture-key', providerName: '供应商乙' };
async function setup(t: TestContext, cleanup = true) {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-model-settings-'));
  if (cleanup) t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = new SettingsStore(directory); await settings.load();
  return { directory, settings };
}

test('saved suppliers isolate keys, retain per-model capabilities and remember selections after restart', async t => {
  const { directory, settings } = await setup(t);
  const a = await settings.update({ ...first, providerId: null, modelId: null, contextWindow: 8192, maxTokens: 2048 });
  const a2 = await settings.update({ ...first, apiKey: undefined, providerId: a.activeProviderId, modelId: null, model: 'second-model-at-first', contextWindow: 32768, maxTokens: 4096, supportsImages: true });
  const b = await settings.update({ ...second, providerId: null, modelId: null });
  assert.equal(b.providers.length, 2); assert.equal(b.providers[0].models.length, 2);
  assert.equal(settings.key(), second.apiKey);
  const before = await readFile(join(directory, 'settings.json'), 'utf8');
  const probe = settings.preview({ ...first, apiKey: undefined, providerId: a.activeProviderId, modelId: a.activeModelId });
  assert.equal(probe.apiKey, first.apiKey); assert.equal(probe.contextWindow, 8192);
  assert.equal(await readFile(join(directory, 'settings.json'), 'utf8'), before);
  await settings.select({ providerId: a.activeProviderId! });
  assert.equal(settings.get().model, 'second-model-at-first'); assert.equal(settings.key(), first.apiKey);
  assert.equal(settings.get().supportsImages, true);
  await settings.select({ providerId: a.activeProviderId!, modelId: a.activeModelId });
  assert.equal(settings.get().contextWindow, 8192); assert.equal(settings.get().maxTokens, 2048); assert.equal(settings.get().supportsImages, false);
  const restored = new SettingsStore(directory); await restored.load();
  assert.deepEqual(restored.public(), settings.public()); assert.equal(restored.key(), first.apiKey);
  assert.equal(JSON.stringify(restored.public()).includes(first.apiKey), false); assert.equal(JSON.stringify(restored.public()).includes(second.apiKey), false);
  assert.notEqual(a2.activeModelId, a.activeModelId);
});

test('changing a saved supplier endpoint or format requires its own key and rejects stale IDs', async t => {
  const { settings } = await setup(t);
  const a = await settings.update({ ...first, providerId: null });
  await settings.update({ ...second, providerId: null });
  for (const changed of [{ baseUrl: second.baseUrl }, { protocol: 'anthropic' as const }]) {
    assert.throws(() => settings.preview({ ...first, ...changed, providerId: a.activeProviderId, modelId: a.activeModelId, apiKey: undefined }), /重新填写密钥/);
  }
  const before = settings.public();
  await assert.rejects(settings.select({ providerId: 'missing' }), /供应商已移除/);
  await assert.rejects(settings.select({ providerId: a.activeProviderId!, modelId: before.activeModelId }), /模型已移除/);
  await assert.rejects(settings.update({ ...first, providerId: 'missing' }), /供应商已移除/);
  await assert.rejects(settings.update({ ...first, providerId: a.activeProviderId, modelId: null }), /已保存此模型/);
  assert.deepEqual(settings.public(), before);
});

test('concurrent saves preserve both suppliers and deletion chooses an available saved model', async t => {
  const { directory, settings } = await setup(t);
  const [a, b] = await Promise.all([settings.update({ ...first, providerId: null }), settings.update({ ...second, providerId: null })]);
  assert.equal(settings.public().providers.length, 2);
  const a2 = await settings.update({ ...first, apiKey: undefined, providerId: a.activeProviderId, modelId: null, model: 'another-first' });
  await settings.remove(a.activeProviderId!, a2.activeModelId);
  assert.equal(settings.public().activeModelId, a.activeModelId); assert.equal(settings.key(), first.apiKey);
  await settings.remove(a.activeProviderId!);
  assert.equal(settings.public().activeProviderId, b.activeProviderId); assert.equal(settings.key(), second.apiKey);
  await settings.remove(b.activeProviderId!, b.activeModelId);
  assert.equal(settings.public().configured, false); assert.deepEqual(settings.public().providers, []);
  const restored = new SettingsStore(directory); await restored.load(); assert.deepEqual(restored.public(), settings.public());
});

test('environment credentials stay bound to the migrated supplier and never flow into new suppliers', async t => {
  const environment = { OPENAI_API_KEY: 'environment-fixture-key', PICODING_API_BASE_URL: first.baseUrl, PICODING_MODEL: first.model };
  for (const [name, value] of Object.entries(environment)) {
    const previous = process.env[name]; process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  const { directory, settings } = await setup(t);
  const original = settings.public(); assert.equal(settings.key(), 'environment-fixture-key');
  await settings.update({ ...second, apiKey: undefined, providerId: null });
  assert.equal(settings.public().hasApiKey, false); assert.equal(settings.preview({ ...second, apiKey: undefined }).apiKey, undefined);
  await settings.select({ providerId: original.activeProviderId! }); assert.equal(settings.key(), 'environment-fixture-key');
  const restored = new SettingsStore(directory); await restored.load(); assert.equal(restored.key(), 'environment-fixture-key');
  assert.equal((await readFile(join(directory, 'settings.json'), 'utf8')).includes('environment-fixture-key'), false);
});

test('model changes block execution and overlapping changes through persistence, and failed changes allow retry', async t => {
  const { directory, settings } = await setup(t, false);
  await settings.update(first);
  const store = new TaskStore(join(directory, 'tasks')); await store.load();
  const sandbox = { url: 'http://fixture.invalid', token: 'fixture', async start() {}, async stop() {}, async destroy() {}, async request<T>() { return { exitCode: 0, output: '' } as T; } };
  const workbench = new Workbench(store, settings, () => sandbox); t.after(async () => { await workbench.shutdown(); await rm(directory, { recursive: true, force: true }); });
  const task = await workbench.create('Keep history'); await workbench.start(task.id);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  const change = workbench.changeSettings(async () => { await barrier; return settings.update({ ...first, model: 'changed' }); });
  await assert.rejects(workbench.send(task.id, 'must not run'), /模型设置正在更新/);
  await assert.rejects(workbench.changeSettings(() => settings.update(second)), /模型设置正在更新/);
  assert.equal(task.messages.length, 0); release(); await change;
  for (const status of ['creating', 'running', 'pausing'] as const) {
    task.status = status;
    await assert.rejects(workbench.changeSettings(() => settings.update(first)), /停止正在执行/);
  }
  task.status = 'ready';
  await assert.rejects(workbench.changeSettings(() => settings.update({ ...first, baseUrl: 'bad' })), /API 地址/);
  await workbench.changeSettings(() => settings.update(first)); assert.equal(settings.get().model, first.model);
});

test('real pi sessions use each selected supplier and model while preserving conversation across switches', { timeout: 20_000 }, async t => {
  const { directory, settings } = await setup(t, false);
  const requests: { url: string; body: Record<string, unknown>; key?: string }[] = [];
  const provider = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const anthropic = request.url!.startsWith('/third/');
    requests.push({ url: request.url!, body, key: String(anthropic ? request.headers['x-api-key'] : request.headers.authorization) });
    textReply(response, anthropic ? 'anthropic' : 'openai', body.model, 'Local fixture reply ' + requests.length);
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => { provider.closeAllConnections(); provider.close(); });
  const base = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
  const a = await settings.update({ ...first, baseUrl: base + '/first/v1', providerId: null, modelId: null, contextWindow: 32768, maxTokens: 2048 });
  const a2 = await settings.update({ ...first, apiKey: undefined, baseUrl: base + '/first/v1', providerId: a.activeProviderId, modelId: null, model: 'alternate-first', contextWindow: 32768, maxTokens: 4096 });
  const b = await settings.update({ ...second, baseUrl: base + '/second/v1', providerId: null, modelId: null });
  const c = await settings.update({ protocol: 'anthropic', baseUrl: base + '/third', model: 'third-model', apiKey: 'third-fixture-key', providerId: null, modelId: null, providerName: '供应商丙' });
  const store = new TaskStore(join(directory, 'tasks')); await store.load();
  const sandbox = { url: 'http://fixture.invalid', token: 'fixture', async start() {}, async stop() {}, async destroy() {}, async request<T>() { return { exitCode: 0, output: '' } as T; } };
  const workbench = new Workbench(store, settings, () => sandbox); t.after(async () => { await workbench.shutdown(); await rm(directory, { recursive: true, force: true }); });
  const task = await workbench.create('Switching fixture'); await workbench.start(task.id);
  for (const [index, selection] of [a, a2, b, c, a].entries()) {
    await workbench.changeSettings(() => settings.select({ providerId: selection.activeProviderId!, modelId: selection.activeModelId }));
    await workbench.send(task.id, 'Fixture prompt ' + (index + 1)); assert.equal(task.error, undefined);
    assert.equal(requests[index].body.model, selection.model);
    assert.equal(task.messages.length, (index + 1) * 2);
    if (index) assert.match(JSON.stringify(requests[index].body), /Fixture prompt 1/);
  }
  assert.deepEqual(requests.map(request => new URL(request.url, base).pathname), ['/first/v1/chat/completions', '/first/v1/chat/completions', '/second/v1/chat/completions', '/third/v1/messages', '/first/v1/chat/completions']);
  assert.deepEqual(requests.map(request => request.key), ['Bearer ' + first.apiKey, 'Bearer ' + first.apiKey, 'Bearer ' + second.apiKey, 'third-fixture-key', 'Bearer ' + first.apiKey]);
  assert.equal(requests[0].body.max_completion_tokens ?? requests[0].body.max_tokens, 2048); assert.equal(requests[1].body.max_completion_tokens ?? requests[1].body.max_tokens, 4096);
});

test('real pi sessions retain conversation when restored data moves to a different directory', { timeout: 20_000 }, async t => {
  const { directory, settings } = await setup(t, false);
  const restoredDirectory = directory + '-restored';
  const requests: Record<string, unknown>[] = [];
  const workbenches: Workbench[] = [];
  const provider = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
    textReply(response, 'openai', body.model, 'Relocation fixture reply ' + requests.length);
  });
  t.after(async () => {
    for (const workbench of workbenches) await workbench.shutdown();
    provider.closeAllConnections(); provider.close();
    await rm(directory, { recursive: true, force: true });
    await rm(restoredDirectory, { recursive: true, force: true });
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  await settings.update({ ...first, baseUrl: `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1` });
  // The official SDK and persisted session files are real; only the task sandbox is an adapter.
  const sandbox = { url: 'http://fixture.invalid', token: 'fixture', async start() {}, async stop() {}, async destroy() {}, async request<T>() { return { exitCode: 0, output: '' } as T; } };
  const store = new TaskStore(join(directory, 'tasks')); await store.load();
  const original = new Workbench(store, settings, () => sandbox); workbenches.push(original);
  const task = await original.create('Relocation fixture'); await original.start(task.id);
  await original.send(task.id, 'Remember the original relocation fixture prompt.');
  assert.equal(task.error, undefined);
  await original.shutdown();
  await rename(directory, restoredDirectory);
  const restoredSettings = new SettingsStore(restoredDirectory); await restoredSettings.load();
  const restoredStore = new TaskStore(join(restoredDirectory, 'tasks')); await restoredStore.load();
  const restored = new Workbench(restoredStore, restoredSettings, () => sandbox); workbenches.push(restored);
  await restored.start(task.id);
  await restored.send(task.id, 'Continue the relocation fixture after restoring.');
  assert.equal(restoredStore.get(task.id).error, undefined);
  assert.equal(requests.length, 2);
  assert.match(JSON.stringify(requests[1]), /Remember the original relocation fixture prompt/);
  assert.match(JSON.stringify(requests[1]), /Relocation fixture reply 1/);
  assert.match(JSON.stringify(requests[1]), /Continue the relocation fixture after restoring/);
});
