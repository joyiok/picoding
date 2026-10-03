import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { AccessControl } from '../server/access.js';
import { config } from '../server/config.js';
import { createApp } from '../server/app.js';
import { TaskStore } from '../server/store.js';
import { SettingsStore } from '../server/settings.js';
import { Workbench } from '../server/workbench.js';

const password = 'fixture-access-password-only';
const options = { host: '127.0.0.1', port: config.port, password };
const request = (headers: Record<string, string> = {}) => ({ headers: { host: `127.0.0.1:${config.port}`, ...headers } }) as IncomingMessage;
const cookie = (value: string) => value.split(';')[0];
const address = (server: Server) => `http://127.0.0.1:${(server.address() as { port: number }).port}`;
async function listen(server: Server) { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); }
async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-access-'));
  const store = new TaskStore(join(directory, 'tasks')); await store.load();
  const settings = new SettingsStore(directory); await settings.load();
  const workbench = new Workbench(store, settings), access = new AccessControl(options);
  const server = createApp(workbench, access), sockets = new Set<Socket>();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await listen(server);
  t.after(async () => { access.close(); await workbench.shutdown(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  const id = randomUUID(), now = new Date().toISOString();
  await store.save({ id, title: 'Private fixture task', status: 'stopped', createdAt: now, updatedAt: now, messages: [], tools: [], terminal: [] });
  function stream(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
    return new Promise<IncomingMessage>((resolve, reject) => {
      const req = httpRequest(address(server) + path, { method, headers: { host: `127.0.0.1:${config.port}`, 'Content-Type': 'application/json', ...headers } }, resolve);
      req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  async function api(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
    const response = await stream(path, method, body, headers); const parts: Buffer[] = [];
    for await (const chunk of response) parts.push(Buffer.from(chunk));
    const text = Buffer.concat(parts).toString();
    return { status: response.statusCode!, headers: response.headers, body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
  }
  async function login() { const reply = await api('/api/auth/login', 'POST', { password }); assert.equal(reply.status, 200); return cookie(reply.headers['set-cookie']![0]); }
  return { server, workbench, access, id, api, stream, login };
}

test('remote access configuration refuses missing protection, weak passwords and unsafe origins', () => {
  for (const invalid of [
    { host: '0.0.0.0', port: config.port },
    { ...options, host: '0.0.0.0' },
    { ...options, password: 'short' },
    { ...options, publicOrigin: 'http://workbench.invalid' },
    { ...options, publicOrigin: 'https://workbench.invalid/path' },
    { ...options, publicOrigin: 'https://user:secret@workbench.invalid' },
    { ...options, publicOrigin: 'https://workbench.invalid', password: undefined },
  ]) assert.throws(() => new AccessControl(invalid));
  const access = new AccessControl({ ...options, host: '0.0.0.0', publicOrigin: 'https://workbench.invalid' });
  assert.doesNotThrow(() => access.checkRequest(request({ host: 'workbench.invalid', origin: 'https://workbench.invalid' })));
  assert.throws(() => access.checkRequest(request({ host: 'workbench.invalid', origin: 'http://workbench.invalid' })));
  assert.throws(() => access.checkRequest(request({ host: 'evil.invalid', 'x-forwarded-host': 'workbench.invalid' })));
  assert.throws(() => access.checkRequest(request({ host: 'workbench.invalid', 'sec-fetch-site': 'cross-site' })));
});

test('all private HTTP routes require login before task, model, file or desktop access', async t => {
  const ui = await setup(t);
  assert.deepEqual((await ui.api('/api/auth')).body, { required: true, authenticated: false });
  for (const path of ['/api/tasks', '/api/settings', '/api/health', '/api/resources', `/api/tasks/${ui.id}/events`, `/api/tasks/${ui.id}/archive`, `/api/tasks/${ui.id}/desktop/vnc.html`]) assert.equal((await ui.api(path)).status, 401, path);
  assert.equal((await ui.api('/api/auth/login', 'POST', { password: 'incorrect-password' })).status, 401);
  assert.equal((await ui.api('/api/auth/login', 'POST', { password }, { origin: 'https://evil.invalid' })).status, 403);
  const signedIn = await ui.login();
  assert.equal((await ui.api('/api/tasks', 'GET', undefined, { cookie: signedIn })).status, 200);
  assert.equal((await ui.api('/api/settings', 'GET', undefined, { cookie: signedIn })).status, 200);
  assert.equal((await ui.api('/api/tasks', 'GET', undefined, { cookie: signedIn + '; ' + signedIn })).status, 401);
  assert.equal((await ui.api('/api/auth/logout', 'POST', {}, { cookie: signedIn })).status, 200);
  assert.equal((await ui.api('/api/tasks', 'GET', undefined, { cookie: signedIn })).status, 401);
});

test('HTTPS sessions have protected cookies, expire server-side, revoke streams and do not survive restart', async () => {
  let now = Date.now();
  const access = new AccessControl({ ...options, publicOrigin: 'https://workbench.invalid' }, () => now);
  const login = await access.login(request(), password);
  assert.match(login.cookie, /^__Host-picoding_session=[a-f\d]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/);
  const signedIn = request({ cookie: cookie(login.cookie) });
  assert.equal(access.status(signedIn).authenticated, true);
  const connection = new EventEmitter(); let disconnected = false;
  access.protectConnection(signedIn, connection, () => { disconnected = true; connection.emit('close'); });
  now = login.status.expiresAt;
  assert.equal(access.status(signedIn).authenticated, false); assert.equal(disconnected, true);
  assert.throws(() => access.require(signedIn));
  assert.equal(new AccessControl(options).status(signedIn).authenticated, false);
  access.close();
});

test('login throttling bounds repeated password hashing and recovers after its window', async () => {
  let now = Date.now(); const access = new AccessControl(options, () => now);
  for (let i = 0; i < 20; i++) await assert.rejects(access.login(request(), 'wrong-password'), { status: 401 });
  await assert.rejects(access.login(request(), password), { status: 429 });
  now += 60_001; assert.equal((await access.login(request(), password)).status.authenticated, true); access.close();
});

test('logging out closes an already authenticated event stream without stopping the task', async t => {
  const ui = await setup(t), signedIn = await ui.login();
  const events = await ui.stream(`/api/tasks/${ui.id}/events`, 'GET', undefined, { cookie: signedIn });
  assert.equal(events.statusCode, 200); assert.match(events.headers['content-type']!, /event-stream/);
  events.resume(); const ended = once(events, 'end');
  await ui.api('/api/auth/logout', 'POST', {}, { cookie: signedIn }); await ended;
  assert.equal(ui.workbench.store.get(ui.id).title, 'Private fixture task');
});

test('desktop and terminal websocket upgrades reject anonymous clients before touching a sandbox', async t => {
  const ui = await setup(t); let contacted = false;
  t.mock.method(ui.workbench, 'sandbox', () => { contacted = true; throw new Error('must not run'); });
  for (const path of ['terminal', 'desktop/websockify']) {
    const result = await new Promise<number>((resolve, reject) => {
      const client = new WebSocket(address(ui.server).replace('http:', 'ws:') + `/api/tasks/${ui.id}/${path}`, { headers: { host: `127.0.0.1:${config.port}` } });
      client.on('unexpected-response', (_, response) => { response.resume(); client.terminate(); resolve(response.statusCode!); });
      client.on('error', () => {}); client.on('open', () => { client.terminate(); reject(new Error('unauthorized socket opened')); });
    });
    assert.equal(result, 403);
  }
  assert.equal(contacted, false);
});

test('desktop proxy isolates session cookies and disconnects an authenticated websocket on logout', async t => {
  const ui = await setup(t), signedIn = await ui.login();
  const upstream = createServer((request, response) => { assert.equal(request.headers.cookie, undefined); assert.equal(request.headers.authorization, 'Bearer worker-fixture'); response.setHeader('Set-Cookie', 'picoding_session=untrusted'); response.end('desktop asset fixture'); });
  const sockets = new WebSocketServer({ server: upstream });
  sockets.on('connection', (client, request) => { assert.equal(request.headers.cookie, undefined); assert.equal(request.headers.authorization, 'Bearer worker-fixture'); client.send('desktop fixture connected'); });
  await listen(upstream);
  t.after(async () => { for (const client of sockets.clients) client.terminate(); sockets.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); });
  t.mock.method(ui.workbench, 'sandbox', () => ({ url: address(upstream), token: 'worker-fixture' }) as never);
  const asset = await ui.api(`/api/tasks/${ui.id}/desktop/vnc.html`, 'GET', undefined, { cookie: signedIn });
  assert.equal(asset.status, 200); assert.equal(asset.headers['set-cookie'], undefined);
  const client = new WebSocket(address(ui.server).replace('http:', 'ws:') + `/api/tasks/${ui.id}/desktop/websockify`, { headers: { host: `127.0.0.1:${config.port}`, cookie: signedIn } });
  client.on('error', () => {}); await once(client, 'message');
  const closed = once(client, 'close'); await ui.api('/api/auth/logout', 'POST', {}, { cookie: signedIn }); await closed;
});
