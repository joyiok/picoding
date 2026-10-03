import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

// Real compiled control service with private fixture data; no TLS, Docker or model is simulated as real.
const directory = await mkdtemp(join(tmpdir(), 'picoding-production-access-'));
const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = (reservation.address() as { port: number }).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
const base = `http://127.0.0.1:${port}`, origin = 'https://workbench.example.invalid';
const id = randomUUID(), now = new Date().toISOString();
let password = '';
let child: ChildProcess | undefined, output = '';
const run = promisify(execFile);
async function passwordCommand(action: string) {
  return run(process.execPath, ['dist/scripts/access.js', action], { env: { ...process.env, PICODING_DATA_DIR: directory, PICODING_ACCESS_PASSWORD: '' } });
}
async function configurePassword(action: string) {
  const result = await passwordCommand(action), match = result.stdout.match(/访问密码：(\S+)/);
  assert.ok(match, 'Password CLI did not report its generated password');
  password = match[1];
  assert.equal((await readFile(join(directory, 'access.json'), 'utf8')).includes(password), false);
  assert.equal((await stat(join(directory, 'access.json'))).mode & 0o777, 0o600);
}
async function launch() {
  child = spawn(process.execPath, ['dist/server/index.js'], { env: { ...process.env, PICODING_HOST: '127.0.0.1', PICODING_PORT: String(port), PICODING_DATA_DIR: directory, PICODING_PUBLIC_ORIGIN: origin, PICODING_ACCESS_PASSWORD: '', PICODING_API_PROTOCOL: 'openai', PICODING_API_BASE_URL: '', PICODING_MODEL: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  await configurePassword('init');
  assert.deepEqual(JSON.parse((await passwordCommand('status')).stdout), { loginEnabled: true, source: 'file' });
  await assert.rejects(passwordCommand('init'), /已初始化/);
  await launch();
  await assert.rejects(passwordCommand('reset'), /正在使用/);
  report('compiled password initialization stores only a hash and refuses live-service changes');
  const html = await api('/'); assert.equal(html.status, 200); assert.match(html.headers['content-type']!, /text\/html/);
  assert.equal((await api('/', 'HEAD')).text, '');
  for (const [, asset] of html.text.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) assert.equal((await api(asset)).status, 200);
  report('compiled production login shell and static assets');
  for (const route of ['/api/tasks', '/api/settings', '/api/health', `/api/tasks/${id}/events`, `/api/tasks/${id}/archive`]) assert.equal((await api(route)).status, 401);
  assert.equal((await api(`/api/tasks/${id}`, 'PATCH', { title: 'Anonymous rename' })).status, 401);
  assert.equal((await api('/api/auth/login', 'POST', { password }, undefined, 'https://evil.invalid')).status, 403);
  assert.equal((await api('/api/auth/login', 'POST', { password: 'incorrect-password' })).status, 401);
  const login = await api('/api/auth/login', 'POST', { password }); assert.equal(login.status, 200);
  const setCookie = login.headers['set-cookie']![0]; assert.match(setCookie, /HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/);
  const cookie = setCookie.split(';')[0];
  const tasks = await api('/api/tasks', 'GET', undefined, cookie); assert.equal(tasks.status, 200); assert.match(tasks.text, /Temporary private access fixture/);
  report('authenticated APIs and rejected anonymous or foreign-origin requests');
  assert.equal((await api(`/api/tasks/${id}`, 'PATCH', { title: 'Foreign rename' }, cookie, 'https://evil.invalid')).status, 403);
  const renamed = await api(`/api/tasks/${id}`, 'PATCH', { title: '  已整理的任务  ' }, cookie); assert.equal(renamed.status, 200); assert.equal(JSON.parse(renamed.text).title, '已整理的任务');
  const events = await stream(`/api/tasks/${id}/events`, 'GET', undefined, cookie); assert.equal(events.statusCode, 200); events.resume();
  const ended = new Promise<void>(resolve => events.once('end', resolve));
  await api('/api/auth/logout', 'POST', {}, cookie); await ended;
  assert.equal((await api('/api/tasks', 'GET', undefined, cookie)).status, 401);
  report('logout invalidates the session and disconnects production SSE');
  const again = await api('/api/auth/login', 'POST', { password }); const oldCookie = again.headers['set-cookie']![0].split(';')[0];
  await stop(); await launch(); assert.equal((await api('/api/tasks', 'GET', undefined, oldCookie)).status, 401);
  const restarted = await api('/api/auth/login', 'POST', { password }); const freshCookie = restarted.headers['set-cookie']![0].split(';')[0];
  const persisted = await api(`/api/tasks/${id}`, 'GET', undefined, freshCookie); assert.equal(persisted.status, 200); assert.equal(JSON.parse(persisted.text).title, '已整理的任务');
  report('authenticated task renaming persists through production restart');
  assert.equal(output.includes(password), false);
  report('graceful restart invalidates sessions without exposing credentials');
  const oldPassword = password;
  await stop(); await configurePassword('reset'); await launch();
  assert.equal((await api('/api/auth/login', 'POST', { password: oldPassword })).status, 401);
  assert.equal((await api('/api/tasks', 'GET', undefined, freshCookie)).status, 401);
  assert.equal((await api('/api/auth/login', 'POST', { password })).status, 200);
  assert.equal(output.includes(oldPassword) || output.includes(password), false);
  report('compiled password rotation rejects old passwords and sessions after restart');
  await stop(); await writeFile(join(directory, 'access.json'), 'private-corrupt-credential-fixture');
  await assert.rejects(launch(), /访问密码文件无效/);
  await configurePassword('reset'); await launch();
  assert.equal((await api('/api/auth/login', 'POST', { password })).status, 200);
  assert.equal(output.includes('private-corrupt-credential-fixture'), false);
  report('corrupt credentials prevent startup and release the data lock for offline recovery');
} finally { await stop(); await rm(directory, { recursive: true, force: true }); }
