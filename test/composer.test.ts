import { after, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { Task } from '../shared/types.js';

const styles = registerHooks({ load(url, context, next) {
  return url.endsWith('.css') ? { format: 'module', source: 'export {};', shortCircuit: true } : next(url, context);
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
async function setup(t: TestContext) {
  const window = new Window({ url: 'http://127.0.0.1:4310', width: 1280, settings: { disableIframePageLoading: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  class Events {
    onopen?: () => void; onerror?: () => void; onmessage?: () => void;
    private closed = false;
    constructor() { queueMicrotask(() => { if (!this.closed) this.onopen?.(); }); }
    close() { this.closed = true; }
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
  const pending: { path: string; body?: unknown; resolve: (reply: Response) => void }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
    const path = String(input);
    if (options?.method === 'POST' || options?.method === 'DELETE') {
      return new Promise<Response>(resolve => { pending.push({ path, body: options.body ? JSON.parse(String(options.body)) : undefined, resolve }); });
    }
    if (path === '/api/tasks') return json(tasks);
    if (path === '/api/health') return json({ docker: { available: true, imageReady: true }, model: { configured: true }, version: 'test' });
    if (path === '/api/settings') return json({ configured: true, hasApiKey: true, protocol: 'openai', model: 'fixture', baseUrl: 'https://fixture.invalid/v1', contextWindow: 128000, maxTokens: 16384, supportsImages: false });
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
  const container = window.document.createElement('div'); window.document.body.append(container);
  async function mount() { root = createRoot(container as unknown as HTMLElement); await act(async () => { root!.render(createElement(App)); }); }
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
    await act(async () => { request.resolve(json(value, status)); });
    return request;
  }
  const selected = () => window.document.querySelector('.task-nav-item[aria-current="page"]')?.textContent.trim();
  async function remount() { await act(async () => { root!.unmount(); }); await mount(); }
  function beforeUnload() {
    const event = new window.Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented;
  }
  return { composer, click, select, type, reply, selected, remount, tasks, pending, storage: window.sessionStorage, beforeUnload };
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
