import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { UpdateManager, writeUpdateJob } from '../server/updates.js';
import { runUpdate, type UpdateOperations } from '../server/update-runner.js';
import { updateActive, type UpdateJob } from '../shared/updates.js';
import { createApp } from '../server/app.js';
import { config } from '../server/config.js';
import { AccessControl } from '../server/access.js';
import { SettingsStore } from '../server/settings.js';
import { TaskStore } from '../server/store.js';
import { Workbench } from '../server/workbench.js';

const current = 'a'.repeat(40), latest = 'b'.repeat(40);
const version = { version: '0.1.0', commit: current, dirty: false };
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const release = (sha = latest) => ({ sha, commit: { message: 'A new feature\nDetails', committer: { date: '2026-10-04T00:00:00Z' } } });
const github = (async (input: string | URL | Request) => reply(String(input).includes('/compare/') ? { status: 'ahead' } : release())) as typeof fetch;
async function setup(t: { after(fn: () => Promise<void>): void }, dirty = false) {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-update-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  await writeFile(join(directory, 'enabled.json'), '{"version":1}', { mode: 0o600 });
  return { directory, updates: new UpdateManager(directory, Promise.resolve({ ...version, dirty }), github) };
}

test('updates pin the official main commit, hide GitHub details and persist an exclusive request across restarts', async t => {
  const { directory, updates } = await setup(t);
  assert.equal((await updates.status()).available, false);
  const checked = await updates.check();
  assert.equal(checked.enabled, true); assert.equal(checked.available, true);
  assert.equal(checked.latest?.url, `https://github.com/joyiok/picoding/commit/${latest}`);
  assert.equal(checked.latest?.title, 'A new feature');
  await assert.rejects(updates.request('c'.repeat(40)), /重新检查/);
  const requested = await updates.request(latest);
  assert.equal(requested.job?.phase, 'queued'); assert.equal(updateActive(requested.job), true);
  assert.equal((await stat(join(directory, 'request.json'))).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(join(directory, 'request.json'), 'utf8')).commit, latest);
  const restarted = new UpdateManager(directory, Promise.resolve(version), github);
  assert.equal((await restarted.status()).job?.id, requested.job?.id);
  await assert.rejects(updates.request(latest), /等待完成/);
  await rm(join(directory, 'request.json'));
  await writeUpdateJob(directory, { ...requested.job!, phase: 'succeeded', message: 'done' });
  assert.equal((await restarted.status()).job?.phase, 'succeeded');
  assert.equal(updateActive((await restarted.status()).job), false);
});

test('update checks reject divergent or malformed releases, rate limits and stale results after a failure', async t => {
  const { directory } = await setup(t);
  let status = 200, comparison = 'ahead', value = release();
  const fetcher = (async (input: string | URL | Request) => reply(String(input).includes('/compare/') ? { status: comparison } : value, status)) as typeof fetch;
  const updates = new UpdateManager(directory, Promise.resolve(version), fetcher);
  await updates.check(); status = 429;
  await assert.rejects(updates.check(), /次数已达上限/);
  assert.equal((await updates.status()).available, false);
  await assert.rejects(updates.request(latest), /重新检查/);
  status = 200; comparison = 'diverged';
  await assert.rejects(updates.check(), /main 分支不一致/);
  value = release('bad'); await assert.rejects(updates.check(), /无效的版本信息/);
  const dirty = new UpdateManager(directory, Promise.resolve({ ...version, dirty: true }), github);
  await dirty.check(); await assert.rejects(dirty.request(latest), /本地修改/);
  const disabled = new UpdateManager(undefined, Promise.resolve(version), github);
  await disabled.check(); await assert.rejects(disabled.request(latest), /尚未启用/);
  value = release(current); comparison = 'ahead';
  const same = await updates.check(); assert.equal(same.available, false);
  await assert.rejects(updates.request(current), /重新检查/);
});

test('concurrent update requests produce exactly one durable job', async t => {
  const { updates } = await setup(t); await updates.check();
  const results = await Promise.allSettled([updates.request(latest), updates.request(latest)]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(results.filter(value => value.status === 'rejected').length, 1);
});

function initialJob(): UpdateJob { const now = new Date().toISOString(); return { id: randomUUID(), commit: latest, phase: 'queued', message: 'queued', startedAt: now, updatedAt: now }; }
function operations(fail?: string) {
  const calls: string[] = [], api = {} as UpdateOperations;
  for (const name of ['prepare', 'stop', 'backup', 'activate', 'start', 'healthy', 'rollback'] as const) {
    let invoked = 0;
    api[name] = async () => { calls.push(name); if (name === fail && invoked++ === 0) throw new Error('fixture failure'); };
  }
  return { calls, api };
}
test('the updater builds first, backs up before activation, and only reports success after health acceptance', async () => {
  const { calls, api } = operations(), phases: string[] = [];
  const job = await runUpdate(initialJob(), api, async job => { phases.push(job.phase); });
  assert.equal(job.phase, 'succeeded');
  assert.deepEqual(calls, ['prepare', 'stop', 'backup', 'activate', 'start', 'healthy']);
  assert.deepEqual(phases, ['preparing', 'backing-up', 'restarting', 'succeeded']);
});
test('build and backup failures keep the old program; activation and startup failures restore it', async () => {
  for (const failed of ['prepare', 'backup', 'activate', 'healthy']) {
    const { calls, api } = operations(failed);
    const job = await runUpdate(initialJob(), api, async () => {});
    assert.equal(job.phase, 'failed');
    if (failed === 'prepare') assert.deepEqual(calls, ['prepare']);
    else {
      assert.equal(calls.at(-1), 'healthy');
      assert.equal(calls.includes('rollback'), ['activate', 'healthy'].includes(failed));
      assert.equal(calls.includes('activate'), failed !== 'backup');
    }
  }
  const { api } = operations('healthy'); api.rollback = async () => { throw new Error('rollback failure'); };
  const job = await runUpdate(initialJob(), api, async () => {});
  assert.equal(job.phase, 'failed'); assert.match(job.message, /原服务未能恢复/);
});

function request(server: Server, path: string, method = 'GET', body?: unknown, cookie?: string, origin?: string): Promise<{ status: number; body: any }> {
  return new Promise(resolve => {
    const input = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { url: `/api${path}`, method, headers: { host: `127.0.0.1:${config.port}`, ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) } });
    const response = new EventEmitter() as any;
    response.setHeader = () => {}; response.writeHead = (status: number) => { response.statusCode = status; response.headersSent = true; };
    response.end = (text: string) => resolve({ status: response.statusCode, body: JSON.parse(text || '{}') });
    server.emit('request', input as IncomingMessage, response as ServerResponse);
  });
}
test('update APIs require authentication, block busy tasks and mutations while the durable job is active', async t => {
  const { directory, updates } = await setup(t);
  const settings = new SettingsStore(directory), store = new TaskStore(join(directory, 'tasks')); await settings.load(); await store.load();
  const workbench = new Workbench(store, settings);
  const access = new AccessControl({ host: '127.0.0.1', port: config.port, password: 'fictional-update-password' });
  const server = createApp(workbench, access, updates); t.after(async () => { await workbench.shutdown(); access.close(); });
  assert.equal((await request(server, '/updates')).status, 401);
  assert.equal((await request(server, '/updates/check', 'POST', {})).status, 401);
  assert.equal((await request(server, '/updates/install', 'POST', { commit: latest })).status, 401);
  const loginInput = Object.assign(new EventEmitter(), { headers: { host: `127.0.0.1:${config.port}` }, socket: { remoteAddress: '127.0.0.1' } }) as unknown as IncomingMessage;
  const cookie = (await access.login(loginInput, 'fictional-update-password')).cookie.split(';')[0];
  assert.equal((await request(server, '/updates/check', 'POST', {}, cookie, 'https://evil.invalid')).status, 403);
  assert.equal((await request(server, '/updates/check', 'POST', {}, cookie)).status, 200);
  const task = { id: randomUUID(), title: 'Running task', status: 'running' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [], tools: [], terminal: [] };
  await store.save(task);
  assert.equal((await request(server, '/updates/install', 'POST', { commit: latest }, cookie)).status, 409);
  await store.save({ ...task, status: 'stopped' });
  assert.equal((await request(server, '/updates/install', 'POST', { commit: 'malformed' }, cookie)).status, 409);
  const installed = await request(server, '/updates/install', 'POST', { commit: latest }, cookie);
  assert.equal(installed.status, 202); assert.equal(installed.body.job.phase, 'queued');
  assert.equal((await request(server, '/tasks')).status, 401);
  assert.equal((await request(server, '/tasks', 'GET', undefined, cookie)).status, 200);
  assert.equal((await request(server, '/settings', 'POST', { protocol: 'openai', model: 'test', baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture-key' }, cookie)).status, 503);
  assert.equal((await request(server, '/updates/install', 'POST', { commit: latest }, cookie)).status, 409);
  await rm(join(directory, 'request.json'));
  await writeUpdateJob(directory, { ...installed.body.job, phase: 'failed', message: 'fixture build failed' });
  // A failed preparation leaves the original process alive; the next request releases its maintenance guard.
  assert.equal((await request(server, '/updates/install', 'POST', { commit: latest }, cookie)).status, 202);
});
