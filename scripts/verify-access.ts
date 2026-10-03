import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Real compiled control service with private fixture data; no TLS, Docker or model is simulated as real.
const directory = await mkdtemp(join(tmpdir(), 'picoding-production-access-'));
const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = (reservation.address() as { port: number }).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
const base = `http://127.0.0.1:${port}`, origin = 'https://workbench.example.invalid';
const password = 'production-fixture-password-only', id = randomUUID(), now = new Date().toISOString();
let child: ChildProcess | undefined, output = '';
async function launch() {
  child = spawn(process.execPath, ['dist/server/index.js'], { env: { ...process.env, PICODING_HOST: '127.0.0.1', PICODING_PORT: String(port), PICODING_DATA_DIR: directory, PICODING_PUBLIC_ORIGIN: origin, PICODING_ACCESS_PASSWORD: password, PICODING_API_PROTOCOL: 'openai', PICODING_API_BASE_URL: '', PICODING_MODEL: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout!.on('data', data => { output += data.toString(); }); child.stderr!.on('data', data => { output += data.toString(); });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(output);
    try { if ((await api('/api/auth')).status === 200) return; } catch {}
    await delay(50);
  }
  throw new Error('Compiled server startup timed out: ' + output);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const current = child, exited = new Promise<void>(resolve => current.once('exit', () => resolve()));
  current.kill('SIGTERM'); const timer = setTimeout(() => current.kill('SIGKILL'), 10_000);
  try { await exited; assert.equal(current.exitCode, 0, output); } finally { clearTimeout(timer); child = undefined; }
}
function stream(path: string, method = 'GET', body?: unknown, cookie?: string, requestedOrigin = origin) {
  return new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const request = httpRequest(base + path, { method, headers: { Host: new URL(origin).host, Origin: requestedOrigin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } }, resolve);
    request.setTimeout(5000, () => request.destroy(new Error('Access fixture request timed out'))); request.on('error', reject);
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function api(path: string, method = 'GET', body?: unknown, cookie?: string, requestedOrigin?: string) {
  const response = await stream(path, method, body, cookie, requestedOrigin), parts: Buffer[] = [];
  for await (const chunk of response) parts.push(Buffer.from(chunk));
  return { status: response.statusCode, headers: response.headers, text: Buffer.concat(parts).toString() };
}
const report = (check: string) => console.log(JSON.stringify({ check, result: 'pass' }));
try {
  await mkdir(join(directory, 'tasks'));
  await writeFile(join(directory, 'tasks', `${id}.json`), JSON.stringify({ id, title: 'Temporary private access fixture', status: 'stopped', createdAt: now, updatedAt: now, messages: [], tools: [], terminal: [] }), { mode: 0o600 });
  await launch();
  const html = await api('/'); assert.equal(html.status, 200); assert.match(html.headers['content-type']!, /text\/html/);
  assert.equal((await api('/', 'HEAD')).text, '');
  for (const [, asset] of html.text.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) assert.equal((await api(asset)).status, 200);
  report('compiled production login shell and static assets');
  for (const route of ['/api/tasks', '/api/settings', '/api/health', `/api/tasks/${id}/events`, `/api/tasks/${id}/archive`]) assert.equal((await api(route)).status, 401);
  assert.equal((await api('/api/auth/login', 'POST', { password }, undefined, 'https://evil.invalid')).status, 403);
  assert.equal((await api('/api/auth/login', 'POST', { password: 'incorrect-password' })).status, 401);
  const login = await api('/api/auth/login', 'POST', { password }); assert.equal(login.status, 200);
  const setCookie = login.headers['set-cookie']![0]; assert.match(setCookie, /HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/);
  const cookie = setCookie.split(';')[0];
  const tasks = await api('/api/tasks', 'GET', undefined, cookie); assert.equal(tasks.status, 200); assert.match(tasks.text, /Temporary private access fixture/);
  report('authenticated APIs and rejected anonymous or foreign-origin requests');
  const events = await stream(`/api/tasks/${id}/events`, 'GET', undefined, cookie); assert.equal(events.statusCode, 200); events.resume();
  const ended = new Promise<void>(resolve => events.once('end', resolve));
  await api('/api/auth/logout', 'POST', {}, cookie); await ended;
  assert.equal((await api('/api/tasks', 'GET', undefined, cookie)).status, 401);
  report('logout invalidates the session and disconnects production SSE');
  const again = await api('/api/auth/login', 'POST', { password }); const oldCookie = again.headers['set-cookie']![0].split(';')[0];
  await stop(); await launch(); assert.equal((await api('/api/tasks', 'GET', undefined, oldCookie)).status, 401);
  assert.equal(output.includes(password), false);
  report('graceful restart invalidates sessions without exposing credentials');
} finally { await stop(); await rm(directory, { recursive: true, force: true }); }
