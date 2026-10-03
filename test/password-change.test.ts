import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AccessControl } from '../server/access.js';
import { loadAccessCredential, saveAccessPassword, createAccessCredential } from '../server/access-password.js';
import { acquireDataLease } from '../server/data-lease.js';
import { config } from '../server/config.js';
import { createApp } from '../server/app.js';
import { TaskStore } from '../server/store.js';
import { SettingsStore } from '../server/settings.js';
import { Workbench } from '../server/workbench.js';

const password = 'original-password-fixture', replacement = 'replacement-password-fixture';
const options = { host: '127.0.0.1', port: config.port };
const cookie = (value: string) => value.split(';')[0];
const request = (token: string) => ({ headers: { host: `127.0.0.1:${config.port}`, cookie: token } }) as IncomingMessage;
async function setup(t: TestContext, environmentPassword?: string) {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-password-change-'));
  await saveAccessPassword(directory, password);
  const lease = await acquireDataLease(directory);
  const access = new AccessControl({ ...options, credential: await loadAccessCredential(directory), dataDir: directory, password: environmentPassword });
  const store = new TaskStore(join(directory, 'tasks')); await store.load();
  const settings = new SettingsStore(directory); await settings.load();
  const workbench = new Workbench(store, settings), server = createApp(workbench, access);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t.after(async () => {
    access.close(); await workbench.shutdown(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await lease.release(); await rm(directory, { recursive: true, force: true });
  });
  function stream(path: string, token = '', body?: unknown, origin?: string) {
    return new Promise<IncomingMessage>((resolve, reject) => {
      const req = httpRequest(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { host: `127.0.0.1:${config.port}`, cookie: token, 'Content-Type': 'application/json', ...(origin ? { origin } : {}) } }, resolve);
      req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  async function api(path: string, token = '', body?: unknown, origin?: string) {
    const response = await stream(path, token, body, origin);
    const chunks: Buffer[] = []; for await (const chunk of response) chunks.push(Buffer.from(chunk));
    return { status: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()), cookie: response.headers['set-cookie']?.[0] };
  }
  async function login(value = environmentPassword || password) { const reply = await api('/api/auth/login', '', { password: value }); assert.equal(reply.status, 200); return cookie(reply.cookie!); }
  return { access, api, stream, directory, workbench, store, login };
}

test('password settings and mutations reject anonymous and foreign-origin requests', async t => {
  const ui = await setup(t), body = { currentPassword: password, newPassword: replacement, confirmation: replacement };
  assert.equal((await ui.api('/api/auth/password')).status, 401);
  assert.equal((await ui.api('/api/auth/password', '', body)).status, 401);
  const signedIn = await ui.login();
  assert.equal((await ui.api('/api/auth/password', signedIn, body, 'https://foreign.invalid')).status, 403);
  assert.equal((await ui.api('/api/auth/password', signedIn)).body.enabled, true);
});

test('online password rotation persists only a hash, refreshes the current cookie and revokes other sessions and SSE', async t => {
  const ui = await setup(t), first = await ui.login(), second = await ui.login();
  const id = randomUUID(), now = new Date().toISOString();
  await ui.store.save({ id, title: 'Unaffected task', status: 'stopped', createdAt: now, updatedAt: now, messages: [], tools: [], terminal: [] });
  const events = await ui.stream(`/api/tasks/${id}/events`, second); events.resume(); const ended = once(events, 'end');
  const changed = await ui.api('/api/auth/password', first, { currentPassword: password, newPassword: replacement, confirmation: replacement });
  assert.equal(changed.status, 200); assert.equal(changed.body.authenticated, true); assert.ok(changed.cookie);
  await ended;
  const current = cookie(changed.cookie!); assert.notEqual(current, first);
  assert.equal((await ui.api('/api/settings', current)).status, 200);
  assert.equal((await ui.api('/api/settings', first)).status, 401);
  assert.equal((await ui.api('/api/settings', second)).status, 401);
  assert.equal((await ui.api('/api/auth/login', '', { password })).status, 401);
  assert.equal((await ui.api('/api/auth/login', '', { password: replacement })).status, 200);
  const text = await readFile(join(ui.directory, 'access.json'), 'utf8');
  assert.equal(text.includes(replacement), false); assert.equal(text.includes(password), false);
  assert.equal((await stat(join(ui.directory, 'access.json'))).mode & 0o777, 0o600);
  const restarted = new AccessControl({ ...options, credential: await loadAccessCredential(ui.directory), dataDir: ui.directory });
  try { assert.equal((await restarted.login(request(''), replacement)).status.authenticated, true); await assert.rejects(restarted.login(request(''), password), { status: 401 }); }
  finally { restarted.close(); }
  assert.equal(ui.store.get(id).title, 'Unaffected task');
});

test('incorrect current passwords, weak passwords, mismatches and unchanged passwords preserve credentials and sessions', async t => {
  const ui = await setup(t), signedIn = await ui.login(), file = join(ui.directory, 'access.json'), before = await readFile(file, 'utf8');
  for (const body of [
    { currentPassword: 'incorrect-fixture', newPassword: replacement, confirmation: replacement },
    { currentPassword: password, newPassword: 'short', confirmation: 'short' },
    { currentPassword: password, newPassword: replacement, confirmation: 'different-password-fixture' },
    { currentPassword: password, newPassword: password, confirmation: password },
    { currentPassword: password, newPassword: 42, confirmation: 42 },
  ]) {
    assert.equal((await ui.api('/api/auth/password', signedIn, body)).status, 400);
    assert.equal(await readFile(file, 'utf8'), before);
    assert.equal((await ui.api('/api/settings', signedIn)).status, 200);
  }
});

test('environment-managed passwords expose a disabled setting and cannot be overwritten online', async t => {
  const ui = await setup(t, 'environment-password-fixture'), signedIn = await ui.login(), before = await readFile(join(ui.directory, 'access.json'), 'utf8');
  assert.equal((await ui.api('/api/auth/password', signedIn)).body.enabled, false);
  assert.equal((await ui.api('/api/auth/password', signedIn, { currentPassword: 'environment-password-fixture', newPassword: replacement, confirmation: replacement })).status, 409);
  assert.equal(await readFile(join(ui.directory, 'access.json'), 'utf8'), before);
});

test('online rotation serializes competing rotations and prevents old-password logins during persistence', async t => {
  const ui = await setup(t), signedIn = await ui.login();
  const changing = ui.access.changePassword(request(signedIn), password, replacement, replacement);
  await assert.rejects(ui.access.changePassword(request(signedIn), password, 'other-password-fixture', 'other-password-fixture'), { status: 409 });
  await assert.rejects(ui.access.login(request(''), password), { status: 409 });
  assert.equal((await changing).status.authenticated, true);
});

test('a changed credential file is preserved and failed rotation retains the current authenticated session', async t => {
  const ui = await setup(t), signedIn = await ui.login(), file = join(ui.directory, 'access.json');
  const external = JSON.stringify(await createAccessCredential('external-password-fixture')) + '\n'; await writeFile(file, external);
  const reply = await ui.api('/api/auth/password', signedIn, { currentPassword: password, newPassword: replacement, confirmation: replacement });
  assert.equal(reply.status, 500); assert.equal(await readFile(file, 'utf8'), external);
  assert.equal((await ui.api('/api/settings', signedIn)).status, 200);
  assert.equal((await ui.api('/api/auth/login', '', { password })).status, 200);
  assert.equal((await readdir(ui.directory)).some(file => file.endsWith('.tmp')), false);
});

test('maintenance waits for password persistence and updates cannot overlap it', async t => {
  const ui = await setup(t);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const changing = ui.workbench.changeAccess(() => gate);
  try {
    assert.throws(() => ui.workbench.beginUpdate(), { status: 409 });
    await assert.rejects(ui.workbench.changeAccess(async () => {}), { status: 409 });
    let stopped = false; const stopping = ui.workbench.shutdown().then(() => { stopped = true; });
    await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(stopped, false);
    release(); await changing; await stopping; assert.equal(stopped, true);
  } finally { release(); await changing; }
});
