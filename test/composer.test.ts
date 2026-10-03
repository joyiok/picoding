import { after, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { Window, type HTMLInputElement as FixtureInput } from 'happy-dom';
import type { PublicSettings, Task } from '../shared/types.js';
import type { AccessStatus } from '../server/access.js';
import type { UpdateStatus } from '../shared/updates.js';

const styles = registerHooks({ load(url, context, next) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export {};', shortCircuit: true };
  // Node 22's synchronous hooks require source for CommonJS loaded through tsx.
  if (context.format === 'commonjs' && url.startsWith('file:') && /\.c?js$/.test(url)) return { format: 'commonjs', source: readFileSync(new URL(url), 'utf8'), shortCircuit: true };
  return next(url, context);
} });
after(() => styles.deregister());

const taskA = '11111111-1111-4111-8111-111111111111';
const taskB = '22222222-2222-4222-8222-222222222222';
const taskC = '33333333-3333-4333-8333-333333333333';
function task(id: string, title: string): Task {
  return { id, title, status: 'ready', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z', messages: [], tools: [], terminal: [] };
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }

// A DOM fixture with explicit API replies; no Docker, browser or real model is used.
async function setup(t: TestContext, protectedAccess = false) {
  const window = new Window({ url: 'http://127.0.0.1:4310', width: 1280, settings: { disableIframePageLoading: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const streams: Events[] = [];
  class Events {
    onopen?: () => void; onerror?: () => void; onmessage?: () => void;
    private closed = false;
    constructor() { streams.push(this); queueMicrotask(() => { if (!this.closed) this.onopen?.(); }); }
    close() { this.closed = true; }
    reconnect() { if (!this.closed) this.onopen?.(); }
  }
  const globals: Record<string, unknown> = {
    window, document: window.document, navigator: window.navigator, location: window.location,
    HTMLElement: window.HTMLElement, HTMLIFrameElement: window.HTMLIFrameElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
    EventSource: Events, IS_REACT_ACT_ENVIRONMENT: true, confirm: () => true,
    requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  };
  for (const [key, value] of Object.entries(globals)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const tasks = [task(taskA, 'Task A'), task(taskB, 'Task B')];
  let modelSettings: PublicSettings = { configured: true, hasApiKey: true, protocol: 'openai', model: 'fixture', baseUrl: 'https://fixture.invalid/v1', contextWindow: 128000, maxTokens: 16384, supportsImages: false, activeProviderId: 'first-provider', activeModelId: 'first-model', providers: [
    { id: 'first-provider', name: '供应商甲', protocol: 'openai', baseUrl: 'https://fixture.invalid/v1', hasApiKey: true, selectedModelId: 'first-model', models: [
      { id: 'first-model', model: 'fixture', contextWindow: 128000, maxTokens: 16384, supportsImages: false },
      { id: 'alternate-model', model: 'alternate-fixture', contextWindow: 32768, maxTokens: 4096, supportsImages: true },
    ] },
    { id: 'second-provider', name: '供应商乙', protocol: 'anthropic', baseUrl: 'https://second.invalid', hasApiKey: true, selectedModelId: 'second-model', models: [{ id: 'second-model', model: 'second-fixture', contextWindow: 8192, maxTokens: 2048, supportsImages: false }] },
  ] };
  let access: AccessStatus = { required: protectedAccess, authenticated: !protectedAccess };
  let updateStatus: UpdateStatus = { current: { version: '0.1.0', commit: 'a'.repeat(40), dirty: false }, available: false, enabled: true };
  const calls: string[] = [];
  const pending: { path: string; body?: unknown; resolve: (reply: Response) => void }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
    const path = String(input);
    calls.push(path);
    if (options?.method === 'POST' || options?.method === 'DELETE' || options?.method === 'PATCH') {
      return new Promise<Response>(resolve => { pending.push({ path, body: options.body ? JSON.parse(String(options.body)) : undefined, resolve }); });
    }
    if (path === '/api/auth') return json(access);
    if (path === '/api/tasks') return json(tasks);
    if (path === '/api/health') return json({ docker: { available: true, imageReady: true }, model: { configured: true }, version: 'test' });
    if (path === '/api/settings') return json(modelSettings);
    if (path === '/api/updates') return json(updateStatus);
    if (path.endsWith('/browser')) return json({ url: 'about:blank', title: '', tabs: [] });
    if (path.includes('/files?')) return json([]);
    throw new Error('Unexpected DOM fixture request: ' + path);
  });
  let root: Root | undefined;
  t.after(async () => {
    await act(async () => { for (const request of pending) request.resolve(json({ ok: true })); root?.unmount(); await setImmediate(); });
    await window.happyDOM.abort();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  });
  const { createRoot } = await import('react-dom/client');
  const { App } = await import('../web/App.js');
  const { AccessGate } = protectedAccess ? await import('../web/AccessGate.js') : { AccessGate: undefined };
  const container = window.document.createElement('div'); window.document.body.append(container);
  async function mount() { root = createRoot(container as unknown as HTMLElement); await act(async () => { root!.render(createElement(AccessGate || App)); }); }
  await mount();
  const composer = () => {
    const input = window.document.querySelector('textarea[aria-label="向 pi 描述任务"]'); assert.ok(input);
    return input as unknown as HTMLTextAreaElement;
  };
  async function click(selector: string) {
    const button = window.document.querySelector(selector); assert.ok(button, selector);
    await act(async () => { (button as unknown as HTMLElement).click(); });
  }
  async function select(title: string) {
    const button = [...window.document.querySelectorAll('.task-nav-item')].find(item => item.textContent.includes(title)); assert.ok(button);
    await act(async () => { (button as unknown as HTMLElement).click(); });
  }
  async function type(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(composer(), value);
      composer().dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event);
    });
    assert.equal(composer().value, value);
  }
  async function reply(value: unknown, status = 200) {
    const request = pending.shift(); assert.ok(request, 'Expected a pending API request');
    if (status === 200 && request.path.startsWith('/api/auth/')) access = value as AccessStatus;
    if (status === 200 && ['/api/settings', '/api/settings/select'].includes(request.path)) modelSettings = value as PublicSettings;
    if ((status === 200 || status === 202) && request.path.startsWith('/api/updates/')) updateStatus = value as UpdateStatus;
    await act(async () => { request.resolve(json(value, status)); });
    return request;
  }
  const selected = () => window.document.querySelector('.task-nav-item[aria-current="page"]')?.textContent.trim();
  async function remount() { await act(async () => { root!.unmount(); }); await mount(); }
  function beforeUnload() {
    const event = new window.Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented;
  }
  async function typeInput(selector: string, value: string) {
    const input = window.document.querySelector<FixtureInput>(selector); assert.ok(input);
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
  }
  const typePassword = (value: string) => typeInput('#access-password', value);
  async function expireAccess() {
    access = { required: true, authenticated: false };
    await act(async () => { window.dispatchEvent(new window.Event('picoding:unauthorized')); });
  }
  async function option(selector: string, value: string) {
    const input = window.document.querySelector(selector); assert.ok(input);
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new window.Event('change', { bubbles: true })); });
  }
  async function reconnect() { await act(async () => { for (const stream of streams) stream.reconnect(); }); }
  return { composer, click, select, type, reply, selected, remount, tasks, pending, storage: window.sessionStorage, beforeUnload, typePassword, typeInput, calls, document: window.document, expireAccess, option, reconnect, settings: () => modelSettings };
}

test('task switching preserves each message draft and the new-task draft', async t => {
  const ui = await setup(t);
  await ui.type('New project draft');
  await ui.select('Task A'); await ui.type('Draft for A');
  await ui.select('Task B'); await ui.type('Draft for B');
  await ui.select('Task A'); assert.equal(ui.composer().value, 'Draft for A');
  await ui.select('Task B'); assert.equal(ui.composer().value, 'Draft for B');
  await ui.click('.new-task'); assert.equal(ui.composer().value, 'New project draft');
});

test('a successful send preserves the next message typed while its request was pending', async t => {
  const ui = await setup(t);
  await ui.select('Task A'); await ui.type('Send this first');
  await ui.click('button[aria-label="发送任务"]');
  await ui.type('Keep this next message'); await ui.reply({ ok: true });
  assert.equal(ui.composer().value, 'Keep this next message');
  assert.equal(ui.selected(), 'Task A');
});

test('a late send reply clears only the submitted task draft without touching the current task', async t => {
  const ui = await setup(t);
  await ui.select('Task A'); await ui.type('Send from A'); await ui.click('button[aria-label="发送任务"]');
  await ui.select('Task B'); await ui.type('Keep B'); await ui.reply({ ok: true });
  assert.equal(ui.selected(), 'Task B'); assert.equal(ui.composer().value, 'Keep B');
  await ui.select('Task A'); assert.equal(ui.composer().value, '');
});

test('creating a task cannot replace a task selected while the creation request was pending', async t => {
  const ui = await setup(t);
  await ui.type('Create C'); await ui.click('button[aria-label="发送任务"]');
  await ui.select('Task B'); await ui.type('Still working on B');
  const created = task(taskC, 'Task C'); ui.tasks.push(created); await ui.reply(created);
  assert.equal(ui.selected(), 'Task B'); assert.equal(ui.composer().value, 'Still working on B');
  await ui.select('Task C'); assert.equal(ui.composer().value, '');
});

test('a new task carries the next typed message into its own composer', async t => {
  const ui = await setup(t);
  await ui.type('Create C'); await ui.click('button[aria-label="发送任务"]');
  await ui.type('Next request for C');
  const created = task(taskC, 'Task C'); ui.tasks.push(created); await ui.reply(created);
  assert.equal(ui.selected(), 'Task C'); assert.equal(ui.composer().value, 'Next request for C');
  await ui.click('.new-task'); assert.equal(ui.composer().value, '');
});

test('deletion does not replace a different task selected during the request', async t => {
  const ui = await setup(t);
  await ui.select('Task A'); await ui.type('Discard A when deleted');
  await ui.click('button[aria-label="删除任务"]');
  await ui.select('Task B'); await ui.type('Keep B after deletion');
  ui.tasks.splice(ui.tasks.findIndex(item => item.id === taskA), 1); await ui.reply({ ok: true });
  assert.equal(ui.selected(), 'Task B'); assert.equal(ui.composer().value, 'Keep B after deletion');
});

test('refresh restores the selected task and message drafts while failed sends preserve input', async t => {
  const ui = await setup(t);
  await ui.type('New task draft');
  await ui.select('Task A'); await ui.type('A saved draft');
  await ui.select('Task B'); await ui.type('B saved draft');
  await ui.remount();
  assert.equal(ui.selected(), 'Task B'); assert.equal(ui.composer().value, 'B saved draft');
  await ui.click('button[aria-label="发送任务"]'); await ui.reply({ error: 'Fixture gateway unavailable' }, 503);
  assert.equal(ui.composer().value, 'B saved draft');
  await ui.select('Task A'); assert.equal(ui.composer().value, 'A saved draft');
  await ui.click('.new-task'); assert.equal(ui.composer().value, 'New task draft');
});

test('refresh falls back to a new task when the saved task has been removed', async t => {
  const ui = await setup(t);
  await ui.type('Keep new project'); await ui.select('Task A'); await ui.type('A draft');
  ui.tasks.splice(ui.tasks.findIndex(item => item.id === taskA), 1); await ui.remount();
  assert.equal(ui.selected(), undefined); assert.equal(ui.composer().value, 'Keep new project');
});

test('editing and retyping the submitted text counts as a new draft', async t => {
  const ui = await setup(t);
  await ui.select('Task A'); await ui.type('Same request'); await ui.click('button[aria-label="发送任务"]');
  await ui.type('Temporary edit'); await ui.type('Same request'); await ui.reply({ ok: true });
  assert.equal(ui.composer().value, 'Same request');
});

test('storage failures preserve in-memory drafts and trigger page-exit protection', async t => {
  const ui = await setup(t);
  t.mock.method(ui.storage, 'setItem', () => { throw new Error('Fixture storage quota exhausted'); });
  await ui.type('Keep this even when storage fails');
  await ui.select('Task A'); await ui.select('Task B'); await ui.click('.new-task');
  assert.equal(ui.composer().value, 'Keep this even when storage fails');
  assert.equal(ui.beforeUnload(), true);
  await ui.type(''); assert.equal(ui.beforeUnload(), false);
});

test('login gate checks access before requesting private tasks and preserves an incorrect password for retry', async t => {
  const ui = await setup(t, true);
  assert.equal(ui.calls.includes('/api/tasks'), false);
  assert.match(ui.document.querySelector('h1')!.textContent, /登录/);
  await ui.typePassword('wrong-password'); await ui.click('.access-submit');
  assert.deepEqual(ui.pending[0].body, { password: 'wrong-password' });
  await ui.reply({ error: '访问密码不正确' }, 401);
  assert.equal(ui.document.querySelector<FixtureInput>('#access-password')!.value, 'wrong-password');
  assert.match(ui.document.querySelector('[role="alert"]')!.textContent, /不正确/);
  assert.equal(ui.calls.includes('/api/tasks'), false);
  await ui.typePassword('correct-fixture-password'); await ui.click('.access-submit');
  await ui.reply({ required: true, authenticated: true, expiresAt: Date.now() + 3600_000 });
  assert.equal(ui.calls.includes('/api/tasks'), true);
  assert.equal(ui.document.querySelector('#access-password'), null);
});

test('logout locks the workspace and reauthentication keeps the current task and message draft', async t => {
  const ui = await setup(t, true);
  await ui.typePassword('fixture-password'); await ui.click('.access-submit'); await ui.reply({ required: true, authenticated: true, expiresAt: Date.now() + 3600_000 });
  await ui.select('Task A'); await ui.type('Keep this message while logged out');
  await ui.click('button[aria-label="退出登录"]'); await ui.reply({ required: true, authenticated: false });
  assert.equal(ui.document.querySelector('.access-workspace')!.hasAttribute('hidden'), true);
  assert.equal(ui.document.querySelector<FixtureInput>('#access-password')!.value, '');
  await ui.typePassword('fixture-password'); await ui.click('.access-submit'); await ui.reply({ required: true, authenticated: true, expiresAt: Date.now() + 3600_000 });
  assert.equal(ui.selected(), 'Task A'); assert.equal(ui.composer().value, 'Keep this message while logged out');
  assert.equal(ui.document.querySelector('.access-workspace')!.hasAttribute('hidden'), false);
});

test('an expired API session shows login without discarding the current draft', async t => {
  const ui = await setup(t, true);
  await ui.typePassword('fixture-password'); await ui.click('.access-submit'); await ui.reply({ required: true, authenticated: true, expiresAt: Date.now() + 3600_000 });
  await ui.type('Draft before session expiration'); await ui.expireAccess();
  assert.ok(ui.document.querySelector('#access-password'));
  await ui.typePassword('fixture-password'); await ui.click('.access-submit'); await ui.reply({ required: true, authenticated: true, expiresAt: Date.now() + 3600_000 });
  assert.equal(ui.composer().value, 'Draft before session expiration');
});

test('task search filters names without losing the active task or its composer draft', async t => {
  const ui = await setup(t); await ui.select('Task A'); await ui.type('Keep A while searching');
  await ui.typeInput('input[aria-label="搜索任务"]', 'task b');
  assert.equal(ui.document.querySelectorAll('.task-nav-item').length, 1);
  assert.match(ui.document.querySelector('.task-nav-item')!.textContent, /Task B/);
  assert.equal(ui.composer().value, 'Keep A while searching'); assert.match(ui.document.querySelector('.header-title')!.textContent, /Task A/);
  await ui.typeInput('input[aria-label="搜索任务"]', 'no matching fixture'); assert.match(ui.document.querySelector('.task-list-empty')!.textContent, /没有找到/);
  await ui.click('button[aria-label="清空任务搜索"]'); assert.equal(ui.document.querySelectorAll('.task-nav-item').length, 2); assert.equal(ui.selected(), 'Task A');
});

test('task rename updates the title and navigation without touching message input', async t => {
  const ui = await setup(t); await ui.select('Task A'); await ui.type('Keep message during rename');
  await ui.click('button[aria-label="重命名任务"]'); await ui.typeInput('#task-new-name', '采购项目');
  await ui.click('.task-name-dialog button[type="submit"], .task-name-dialog .dialog-footer .primary');
  assert.equal(ui.pending[0].path, '/api/tasks/' + taskA); assert.deepEqual(ui.pending[0].body, { title: '采购项目' });
  await ui.reply({ id: taskA, title: '采购项目', updatedAt: '2026-10-03T01:00:00Z' });
  assert.equal(ui.document.querySelector('.task-name-dialog'), null); assert.equal(ui.selected(), '采购项目'); assert.equal(ui.composer().value, 'Keep message during rename');
});

test('failed task rename keeps the entered name for retry and cancellation keeps the old title', async t => {
  const ui = await setup(t); await ui.select('Task A'); await ui.click('button[aria-label="重命名任务"]');
  await ui.typeInput('#task-new-name', 'Retain renamed draft'); await ui.click('.task-name-dialog .primary');
  await ui.reply({ error: 'Fixture save failure' }, 503);
  assert.equal(ui.document.querySelector<FixtureInput>('#task-new-name')!.value, 'Retain renamed draft'); assert.equal(ui.selected(), 'Task A');
  assert.match(ui.document.querySelector('.task-name-dialog [role="alert"]')!.textContent, /save failure/);
  await ui.click('button[aria-label="关闭任务名称"]'); assert.equal(ui.document.querySelector('.task-name-dialog'), null); assert.equal(ui.selected(), 'Task A');
});

test('an open settings modal is suspended during session expiry and restored with its unsaved fields', async t => {
  const ui = await setup(t, true);
  await ui.typePassword('fixture-password'); await ui.click('.access-submit'); await ui.reply({ required: true, authenticated: true, expiresAt: Date.now() + 3600_000 });
  await ui.click('.model-button'); await ui.click('.model-menu .text-button'); await ui.typeInput('#model', 'unsaved-model-fixture');
  const dialog = ui.document.querySelector('dialog')!; assert.equal(dialog.hasAttribute('open'), true);
  await ui.expireAccess(); assert.equal(dialog.hasAttribute('open'), false); assert.ok(ui.document.querySelector('#access-password'));
  await ui.typePassword('fixture-password'); await ui.click('.access-submit'); await ui.reply({ required: true, authenticated: true, expiresAt: Date.now() + 3600_000 });
  assert.equal(dialog.hasAttribute('open'), true); assert.equal(ui.document.querySelector<FixtureInput>('#model')!.value, 'unsaved-model-fixture');
});

test('quick switching sends only saved IDs, retains the draft and keeps the current model on failure', async t => {
  const ui = await setup(t); await ui.select('Task A'); await ui.type('Keep message while switching');
  await ui.click('.model-button'); await ui.option('.model-menu select:first-of-type', 'second-provider');
  await ui.reconnect(); assert.equal(ui.document.querySelector('select')!.value, 'second-provider');
  await ui.click('.model-menu .primary');
  assert.deepEqual(ui.pending[0].body, { providerId: 'second-provider', modelId: 'second-model' });
  assert.equal(ui.pending[0].path, '/api/settings/select');
  await ui.reply({ error: 'Fixture switch failure' }, 503);
  assert.match(ui.document.querySelector('.model-button')!.textContent, /供应商甲/);
  assert.match(ui.document.querySelector('.model-menu [role="alert"]')!.textContent, /switch failure/);
  assert.equal(ui.document.querySelector('select')!.value, 'second-provider');
  await ui.click('.model-menu .primary');
  const settings = ui.settings(), provider = settings.providers[1], model = provider.models[0];
  await ui.reply({ ...settings, ...model, protocol: provider.protocol, baseUrl: provider.baseUrl, activeProviderId: provider.id, activeModelId: model.id });
  assert.equal(ui.document.querySelector('.model-menu'), null); assert.match(ui.document.querySelector('.model-button')!.textContent, /供应商乙.*second-fixture/);
  assert.equal(ui.composer().value, 'Keep message while switching'); assert.equal(ui.selected(), 'Task A');
});

test('model settings keep unsaved drafts for each supplier and add a model without exposing its stored key', async t => {
  const ui = await setup(t); await ui.click('.model-button'); await ui.click('.model-menu .text-button');
  await ui.typeInput('#model', 'unsaved-first');
  await ui.typeInput('#provider-name', '供应商甲的新名称');
  await ui.option('#saved-provider', 'second-provider'); assert.equal(ui.document.querySelector<FixtureInput>('#model')!.value, 'second-fixture');
  assert.equal(ui.document.querySelector<FixtureInput>('#api-key')!.value, '');
  await ui.option('#saved-provider', 'first-provider'); assert.equal(ui.document.querySelector<FixtureInput>('#model')!.value, 'unsaved-first');
  await ui.option('#saved-model', ''); await ui.typeInput('#model', 'new-model');
  assert.equal(ui.document.querySelector<FixtureInput>('#provider-name')!.value, '供应商甲的新名称');
  assert.equal(ui.document.querySelector<FixtureInput>('#api-key')!.required, false);
  await ui.click('.settings-dialog .primary');
  const body = ui.pending[0].body as Record<string, unknown>;
  assert.equal(body.providerId, 'first-provider'); assert.equal(body.modelId, null); assert.equal(body.model, 'new-model'); assert.equal(body.providerName, '供应商甲的新名称'); assert.equal('apiKey' in body, false);
  await ui.reply({ error: 'Fixture save failure' }, 503);
  assert.equal(ui.document.querySelector<FixtureInput>('#model')!.value, 'new-model');
  assert.match(ui.document.querySelector('.settings-dialog [role="alert"]')!.textContent, /save failure/);
  await ui.option('#saved-provider', '');
  assert.equal(ui.document.querySelector<FixtureInput>('#api-key')!.required, true); assert.equal(ui.document.querySelector<FixtureInput>('#base-url')!.value, '');
});

test('quick switching is unavailable while any task is executing', async t => {
  const ui = await setup(t); ui.tasks[0].status = 'running'; await ui.remount();
  await ui.click('.model-button'); await ui.option('.model-menu select:first-of-type', 'second-provider');
  assert.equal(ui.document.querySelector('.model-menu .primary')!.hasAttribute('disabled'), true);
  assert.match(ui.document.querySelector('.model-menu [role="status"]')!.textContent, /先停止/);
  await ui.click('.model-menu .text-button');
  assert.equal(ui.document.querySelector('.settings-dialog .primary')!.hasAttribute('disabled'), true);
});

test('system updates retain model drafts, require explicit confirmation, pin the checked commit and show durable progress', async t => {
  const ui = await setup(t); await ui.type('Keep composer draft');
  await ui.click('.model-button'); await ui.click('.model-menu .text-button');
  await ui.typeInput('#model', 'unsaved-model');
  await ui.click('.settings-tabs button:last-child');
  assert.equal(ui.document.querySelector('.update-actions .primary')!.hasAttribute('disabled'), true);
  await ui.click('.update-actions .secondary');
  const status: UpdateStatus = { current: { version: '0.1.0', commit: 'a'.repeat(40), dirty: false }, latest: { commit: 'b'.repeat(40), title: '模拟更新：新增功能', date: '2026-10-04T00:00:00Z', url: 'https://github.com/joyiok/picoding/commit/' + 'b'.repeat(40) }, available: true, enabled: true, checkedAt: new Date().toISOString() };
  const checked = await ui.reply(status); assert.equal(checked.path, '/api/updates/check');
  await ui.click('.update-actions .primary');
  assert.equal(ui.pending.length, 0); assert.match(ui.document.querySelector('.update-confirm')!.textContent, /先保存未保存的编辑/);
  assert.equal(ui.document.activeElement, ui.document.querySelector('.update-confirm'));
  assert.equal(ui.document.querySelector('.update-confirm')!.getAttribute('aria-labelledby'), 'updates-confirm-warning');
  await ui.click('.update-confirm .secondary');
  assert.equal(ui.document.activeElement, ui.document.querySelector('.update-actions .primary'));
  await ui.click('.update-actions .primary');
  await ui.click('.update-confirm .primary');
  assert.equal(ui.pending[0].path, '/api/updates/install'); assert.deepEqual(ui.pending[0].body, { commit: 'b'.repeat(40) });
  await ui.reply({ ...status, job: { id: 'fixture-job', commit: 'b'.repeat(40), phase: 'preparing', message: '正在构建模拟更新', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }, 202);
  assert.match(ui.document.querySelector('.update-progress')!.textContent, /正在构建模拟更新/);
  assert.equal(ui.document.querySelector('.update-actions .primary')!.hasAttribute('disabled'), true);
  await ui.click('.settings-tabs button:first-child');
  assert.equal(ui.document.querySelector<FixtureInput>('#model')!.value, 'unsaved-model');
  assert.equal(ui.composer().value, 'Keep composer draft');
});

test('a failed update check clears an old install target and leaves a retryable error', async t => {
  const ui = await setup(t); await ui.click('.model-button'); await ui.click('.model-menu .text-button');
  await ui.click('.settings-tabs button:last-child'); await ui.click('.update-actions .secondary');
  await ui.reply({ error: 'GitHub 暂时不可用' }, 502);
  assert.equal(ui.document.querySelector('.update-actions .primary')!.hasAttribute('disabled'), true);
  assert.match(ui.document.querySelector('.system-updates [role="alert"]')!.textContent, /GitHub 暂时不可用/);
  assert.equal(ui.document.querySelector('.update-actions .secondary')!.hasAttribute('disabled'), false);
});
