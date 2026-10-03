import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { createServer as tcpServer, type AddressInfo } from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { BrowserState, FileContent, Task } from '../shared/types.js';
import { textReply } from '../test/provider.js';

// Deterministic local SSE model, real production server, Docker, PTY and Chromium.
// All settings/session data are private temporary data. No external model is called.
const run = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'picoding-production-'));
const maintenance = await mkdtemp(join(tmpdir(), 'picoding-production-maintenance-'));
const key = 'fictional-integration-key';
const model = 'integration-custom-model';
const html = '<!doctype html><meta charset="utf-8"><title>Production fixture</title><h1>真实沙盒验收</h1><button id="increment">加一</button><p id="counter"></p><script>let n=Number(localStorage.getItem("count")||0);function paint(){document.querySelector("#counter").textContent="次数："+n}paint();document.querySelector("#increment").onclick=()=>{n++;localStorage.setItem("count",String(n));paint()}</script>';
const command = 'nohup python3 -m http.server 3000 --bind 0.0.0.0 > /tmp/production-fixture.log 2>&1 & sleep 0.4';
const steps = [
  { name: 'sandbox_write', args: { path: 'index.html', content: html } },
  { name: 'sandbox_bash', args: { command } },
  { name: 'browser', args: { action: 'navigate', url: 'http://localhost:3000' } },
  { name: 'browser', args: { action: 'click', selector: '#increment' } },
];
let turn = 0; let mode: 'normal' | 'error' | 'hang' = 'normal';
const requests: Record<string, unknown>[] = [];
const provider = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
    assert.equal(request.headers.authorization, 'Bearer ' + key); assert.equal(body.model, model);
    if (mode === 'hang') return;
    if (mode === 'error') { response.writeHead(401, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: '模型密钥无效：' + key, type: 'invalid_request_error' } })); return; }
    const step = steps[turn++];
    if (!step) { textReply(response, 'openai', model, turn === 5 ? '本地协议测试：页面已经写入、运行并在真实浏览器点击验证。' : '本地协议测试：已恢复上次会话，可以继续。'); return; }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end([
      { id: 'fixture-' + turn, object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'tool-' + turn, type: 'function', function: { name: step.name, arguments: JSON.stringify(step.args) } }] }, finish_reason: null }] },
      { id: 'fixture-' + turn, object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } },
    ].map(value => 'data: ' + JSON.stringify(value) + '\n\n').join('') + 'data: [DONE]\n\n');
  } catch (error) { response.writeHead(500); response.end(error instanceof Error ? error.message : String(error)); }
});
await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
const providerPort = (provider.address() as AddressInfo).port;
const reservation = tcpServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = (reservation.address() as AddressInfo).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
const base = 'http://127.0.0.1:' + port;
const environment = { ...process.env, PICODING_HOST: '127.0.0.1', PICODING_PORT: String(port), PICODING_DATA_DIR: directory, PICODING_API_PROTOCOL: 'openai', PICODING_API_BASE_URL: 'http://127.0.0.1:' + providerPort + '/v1', PICODING_MODEL: model, OPENAI_API_KEY: key };
let child: ReturnType<typeof spawn> | undefined; let serverLog = ''; let announced = false;
let task: Task | undefined; let terminal: WebSocket | undefined; const eventsAbort = new AbortController();
async function until(check: () => Promise<boolean> | boolean, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (!await check()) { if (Date.now() > end) throw new Error('Integration check timed out. Server: ' + serverLog.slice(-2000)); await new Promise(resolve => setTimeout(resolve, 100)); }
}
async function api<T = Record<string, unknown>>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(base + '/api' + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
}
async function launch() {
  announced = false; serverLog = '';
  child = spawn(process.execPath, ['dist/server/index.js'], { stdio: ['ignore', 'pipe', 'pipe'], env: environment });
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { serverLog = (serverLog + chunk.toString()).slice(-10_000); if (serverLog.includes('PiCoding is ready at')) announced = true; });
  await until(async () => { if (child?.exitCode !== null) throw new Error('Production process exited: ' + serverLog); if (!announced) return false; try { await api('/health'); return true; } catch { return false; } }, 45_000);
}
async function stop(signal: NodeJS.Signals = 'SIGTERM') {
  const current = child; if (!current || current.exitCode !== null || current.signalCode !== null) return;
  const exit = new Promise<void>(resolve => current.once('exit', () => resolve())); current.kill(signal);
  const timer = setTimeout(() => current.kill('SIGKILL'), 12_000);
  try { await exit; } finally { clearTimeout(timer); child = undefined; }
  if (signal === 'SIGTERM') assert.equal(current.exitCode, 0, serverLog);
}
async function ready() { await until(async () => { const latest = await api<Task>('/tasks/' + task!.id); if (latest.status === 'error') throw new Error(latest.error); return latest.status === 'ready'; }, 90_000); }
async function prompt(text: string) {
  const count = (await api<Task>('/tasks/' + task!.id)).messages.length;
  await api('/tasks/' + task!.id + '/messages', { text });
  await until(async () => { const latest = await api<Task>('/tasks/' + task!.id); return latest.status === 'ready' && latest.messages.length > count + 1; }, 90_000);
  return api<Task>('/tasks/' + task!.id);
}
function report(check: string) { console.log(JSON.stringify({ check, result: 'pass' })); }
try {
  await launch();
  const page = await fetch(base + '/'); assert.match(page.headers.get('content-type') || '', /text\/html/); const pageHtml = await page.text();
  const assetPaths = [...pageHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1]); assert.ok(assetPaths.length >= 2);
  for (const path of assetPaths) { const response = await fetch(base + path); assert.equal(response.status, 200); assert.ok((await response.text()).length > 100); }
  report('production HTML, JavaScript and CSS');
  await api('/settings', { protocol: 'openai', baseUrl: 'http://127.0.0.1:' + providerPort + '/v1', model, apiKey: key, contextWindow: 128000, maxTokens: 16384, supportsImages: false });
  task = await api<Task>('/tasks', { title: 'Temporary production integration' }); await ready();
  const eventResponse = await fetch(base + '/api/tasks/' + task.id + '/events', { signal: eventsAbort.signal });
  assert.match(eventResponse.headers.get('content-type') || '', /text\/event-stream/);
  const reader = eventResponse.body!.getReader(); let eventText = '';
  const readEvents = (async () => { try { while (true) { const result = await reader.read(); if (result.done) break; eventText += Buffer.from(result.value).toString(); } } catch { if (!eventsAbort.signal.aborted) throw new Error('Event stream disconnected unexpectedly'); } })();
  const built = await prompt('Build and verify the deterministic fixture project.');
  assert.equal(built.tools.length, 4); assert.ok(built.tools.every(tool => tool.status === 'done'), JSON.stringify(built.tools)); assert.match(built.messages.at(-1)!.text, /页面已经写入/);
  const file = await api<FileContent>('/tasks/' + task.id + '/file?path=index.html'); assert.equal(file.content, html);
  assert.ok(requests.length >= 5); assert.ok(requests.every(request => request.max_completion_tokens === 16_384)); assert.equal(JSON.stringify(requests).includes('data:image'), false);
  await until(() => eventText.includes('"type":"browser"') && eventText.includes('"type":"terminal"') && eventText.includes('页面已经写入'));
  eventsAbort.abort(); await readEvents;
  await api('/tasks/' + task.id + '/takeover', {});
  const state = await api<BrowserState & { snapshot: string }>('/tasks/' + task.id + '/browser', { action: 'snapshot' }); assert.match(state.snapshot, /次数：1/);
  const secretCheck = await api<{ output: string }>('/tasks/' + task.id + '/command', { command: 'python3 -c "import os; print(bool(os.getenv(\'OPENAI_API_KEY\')), bool(os.getenv(\'ANTHROPIC_API_KEY\')))"' }); assert.match(secretCheck.output, /False False/);
  const desktop = await fetch(base + '/api/tasks/' + task.id + '/desktop/vnc.html'); assert.equal(desktop.status, 200); assert.match(await desktop.text(), /noVNC/);
  report('official pi tool loop, SSE, isolated files, real shared Chromium and noVNC');
  const terminalMessages: { type: string; data?: string; writable?: boolean }[] = [];
  terminal = new WebSocket(base.replace('http:', 'ws:') + '/api/tasks/' + task.id + '/terminal', { headers: { Origin: base } });
  terminal.on('message', value => terminalMessages.push(JSON.parse(value.toString())));
  await until(() => terminal?.readyState === WebSocket.OPEN && terminalMessages.some(message => message.type === 'mode' && message.writable));
  terminal.send(JSON.stringify({ type: 'input', data: 'printf "PRODUCTION_TTY_OK\\n"\r' }));
  await until(() => /\r(?:\n)?PRODUCTION_TTY_OK\r\n/.test(terminalMessages.map(message => message.data || '').join('')));
  terminal.close(); await until(() => terminal?.readyState === WebSocket.CLOSED); terminal = undefined;
  await api('/tasks/' + task.id + '/release', {}); report('production interactive terminal and ownership handoff');
  const archiveResponse = await fetch(base + '/api/tasks/' + task.id + '/archive'); assert.equal(archiveResponse.status, 200);
  const archive = join(directory, 'project.tar.gz'); await writeFile(archive, Buffer.from(await archiveResponse.arrayBuffer()));
  const { stdout: entries } = await run('tar', ['-tzf', archive]); assert.match(entries, /\.\/index\.html/); assert.equal(/\.\/(?:\.git|\.picoding|node_modules)\//.test(entries), false); report('project export');
  const portConflictData = join(maintenance, 'port-conflict');
  await mkdir(join(portConflictData, 'tasks'), { recursive: true, mode: 0o700 });
  // Give the separate instance an interrupted task so a port failure must precede container recovery.
  await writeFile(join(portConflictData, 'tasks', task.id + '.json'), await readFile(join(directory, 'tasks', task.id + '.json')), { mode: 0o600 });
  for (const [data, expected, check] of [
    [directory, /正在使用这个数据目录/, 'data-directory startup conflict leaves the running task untouched'],
    [portConflictData, /EADDRINUSE/, 'occupied-port startup leaves the running task untouched'],
  ] as const) {
    const conflicting = spawn(process.execPath, ['dist/server/index.js'], { env: { ...environment, PICODING_DATA_DIR: data }, stdio: ['ignore', 'ignore', 'pipe'] });
    let conflictError = ''; conflicting.stderr.on('data', value => conflictError += value.toString());
    const conflictTimer = setTimeout(() => conflicting.kill('SIGKILL'), 5000);
    const conflictCode = await new Promise<number | null>(resolve => conflicting.on('exit', resolve)); clearTimeout(conflictTimer);
    assert.equal(conflictCode, 1); assert.match(conflictError, expected);
    assert.equal((await api<Task>('/tasks/' + task.id)).status, 'ready');
    assert.equal((await run('docker', ['inspect', '--format', '{{.State.Running}}', 'picoding-' + task.id])).stdout.trim(), 'true');
    assert.equal((await api<FileContent>('/tasks/' + task.id + '/file?path=index.html')).content, html); report(check);
  }
  await stop(); await launch();
  const restored = await api<Task>('/tasks/' + task.id); assert.equal(restored.status, 'stopped'); assert.equal(restored.tools.length, 4);
  await api('/tasks/' + task.id + '/start', {}); await ready(); assert.equal((await api<FileContent>('/tasks/' + task.id + '/file?path=index.html')).content, html);
  const continued = await prompt('Continue the previous fixture session after restarting.'); assert.match(continued.messages.at(-1)!.text, /已恢复上次会话/);
  const resumedWire = JSON.stringify(requests.at(-1)); assert.match(resumedWire, /Build and verify the deterministic fixture project/); assert.match(resumedWire, /tool-4/);
  await api('/tasks/' + task.id + '/takeover', {}); await api('/tasks/' + task.id + '/command', { command });
  const restoredBrowser = await api<BrowserState & { snapshot: string }>('/tasks/' + task.id + '/browser', { action: 'navigate', url: 'http://localhost:3000' }); assert.match(restoredBrowser.snapshot, /次数：1/);
  await api('/tasks/' + task.id + '/release', {}); report('graceful restart, files, pi history and Chromium profile persistence');
  mode = 'error'; const rejected = await prompt('Check an authentication error.'); const error = rejected.messages.at(-1)!.error; assert.match(error || '', /模型密钥无效/); assert.equal(error?.includes(key), false);
  mode = 'normal'; assert.match((await prompt('Retry after the model error.')).messages.at(-1)!.text, /已恢复/);
  mode = 'hang'; const previousRequests = requests.length; await api('/tasks/' + task.id + '/messages', { text: 'Cancel a stalled local model request.' }); await until(() => requests.length > previousRequests);
  await api('/tasks/' + task.id + '/abort', {}); await ready(); mode = 'normal'; assert.match((await prompt('Continue after cancellation.')).messages.at(-1)!.text, /已恢复/); report('authentication failure recovery and stalled-request cancellation');
  await stop('SIGKILL'); await run('docker', ['inspect', '--format', '{{.State.Running}}', 'picoding-' + task.id]);
  await launch(); assert.equal((await api<Task>('/tasks/' + task.id)).status, 'stopped');
  await assert.rejects(run('docker', ['inspect', 'picoding-' + task.id]));
  await api('/tasks/' + task.id + '/start', {}); await ready(); assert.equal((await api<FileContent>('/tasks/' + task.id + '/file?path=index.html')).content, html); report('crash recovery removes interrupted containers and keeps project volume');
  const fixture = await api<{ output: string }>('/tasks/' + task.id + '/command', { command: 'python3 -c "from pathlib import Path;Path(\'fixture.bin\').write_bytes(bytes(range(256)))" && ln -s index.html fixture-link && git rev-parse --is-inside-work-tree' }); assert.match(fixture.output, /true/);
  await stop();
  const backup = join(maintenance, 'backup'), restoredData = join(maintenance, 'restored');
  const settingsBeforeBackup = await readFile(join(directory, 'settings.json'), 'utf8');
  assert.ok(settingsBeforeBackup.includes(key), 'The backup fixture must contain its provider credential');
  const created = await run(process.execPath, ['dist/scripts/backup.js', 'create', backup], { env: environment }); assert.equal(created.stdout.includes(key), false);
  await assert.rejects(run(process.execPath, ['dist/scripts/backup.js', 'restore', backup], { env: { ...environment, PICODING_DATA_DIR: restoredData } }), /同名项目卷/);
  await run('docker', ['volume', 'rm', 'picoding-work-' + task.id]);
  const restoredBackup = await run(process.execPath, ['dist/scripts/backup.js', 'restore', backup], { env: { ...environment, PICODING_DATA_DIR: restoredData } }); assert.equal(restoredBackup.stdout.includes(key), false);
  assert.equal(await readFile(join(restoredData, 'settings.json'), 'utf8'), settingsBeforeBackup); assert.equal((await stat(join(restoredData, 'settings.json'))).mode & 0o777, 0o600);
  environment.PICODING_DATA_DIR = restoredData; await launch();
  assert.equal((await api<Task>('/tasks/' + task.id)).status, 'stopped');
  await api('/tasks/' + task.id + '/start', {}); await ready(); assert.equal((await api<FileContent>('/tasks/' + task.id + '/file?path=index.html')).content, html);
  const bytes = await api<{ output: string }>('/tasks/' + task.id + '/command', { command: 'python3 -c "from pathlib import Path;print(Path(\'fixture.bin\').read_bytes().hex());print(Path(\'fixture-link\').readlink())" && git rev-parse --is-inside-work-tree' }); assert.match(bytes.output, new RegExp(Buffer.from(Array.from({ length: 256 }, (_, i) => i)).toString('hex'))); assert.match(bytes.output, /index\.html/); assert.match(bytes.output, /true/);
  const afterBackup = await prompt('Continue after restoring the complete backup.'); assert.match(afterBackup.messages.at(-1)!.text, /已恢复/); assert.match(JSON.stringify(requests.at(-1)), /Build and verify the deterministic fixture project/);
  await api('/tasks/' + task.id + '/takeover', {}); await api('/tasks/' + task.id + '/command', { command });
  const backupBrowser = await api<BrowserState & { snapshot: string }>('/tasks/' + task.id + '/browser', { action: 'navigate', url: 'http://localhost:3000' }); assert.match(backupBrowser.snapshot, /次数：1/);
  await api('/tasks/' + task.id + '/release', {}); report('compiled backup CLI restores actual Docker bytes, links, Git, settings, pi history and Chromium profile');
  await api('/tasks/' + task.id, undefined, 'DELETE'); task = undefined;
  await stop(); console.log(JSON.stringify({ result: 'Production integration passed using local simulated model only', modelRequests: requests.length }));
} finally {
  eventsAbort.abort(); terminal?.terminate();
  if (task && child?.exitCode === null) { try { await api('/tasks/' + task.id, undefined, 'DELETE'); } catch { /* Exact-name fallback below. */ } }
  await stop().catch(() => {});
  if (task) {
    await run('docker', ['rm', '-f', 'picoding-' + task.id]).catch(() => {});
    await run('docker', ['rm', '-f', 'picoding-proxy-' + task.id]).catch(() => {});
    await run('docker', ['volume', 'rm', 'picoding-work-' + task.id]).catch(() => {});
  }
  provider.closeAllConnections(); provider.close(); await rm(directory, { recursive: true, force: true }); await rm(maintenance, { recursive: true, force: true });
}
