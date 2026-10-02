import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { createApp } from '../server/app.js';
import { config } from '../server/config.js';
import { SettingsStore } from '../server/settings.js';
import { TaskStore } from '../server/store.js';
import { Workbench } from '../server/workbench.js';
import { TerminalSockets } from '../sandbox/terminal-sockets.js';
import type { Task } from '../shared/types.js';
import type { TerminalOutput } from '../shared/terminal.js';

test('real terminal WebSockets enforce takeover, origin, reconnect and release', async t => {
  const root = await mkdtemp(join(tmpdir(), 'picoding-terminal-ws-'));
  await mkdir(join(root, '.picoding'));
  const pool = new TerminalSockets(root);
  const worker = createServer();
  let authenticated = false;
  worker.on('upgrade', (request, socket, head) => {
    authenticated = request.headers.authorization === 'Bearer test-worker-token';
    if (!authenticated) { socket.destroy(); return; } pool.upgrade(request, socket, head);
  });
  await new Promise<void>(resolve => worker.listen(0, '127.0.0.1', resolve));
  const workerPort = (worker.address() as { port: number }).port;
  const store = new TaskStore(join(root, 'tasks')); await store.load();
  const settings = new SettingsStore(join(root, 'settings')); await settings.load();
  const workbench = new Workbench(store, settings);
  const task: Task = { id: randomUUID(), title: 'terminal', status: 'ready', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [], tools: [], terminal: [] };
  await store.save(task);
  t.mock.method(workbench, 'sandbox', () => ({
    url: 'http://127.0.0.1:' + workerPort, token: 'test-worker-token', async stop() {}, async destroy() {},
    async request(path: string) { if (path === '/terminal/release') await pool.suspend(); return path === '/browser' ? { url: 'about:blank', title: '', tabs: [] } : { ok: true }; },
  }));
  const server = createApp(workbench);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const url = 'ws://127.0.0.1:' + port + '/api/tasks/' + task.id + '/terminal';
  const headers = { host: '127.0.0.1:' + config.port, origin: 'http://127.0.0.1:' + config.port };
  const clients: WebSocket[] = [];
  t.after(async () => {
    for (const client of clients) client.terminate();
    await pool.close(); await workbench.shutdown();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await new Promise<void>(resolve => worker.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  async function rejected(extra: Record<string, string>) {
    const client = new WebSocket(url, { headers: { ...headers, ...extra } }); clients.push(client);
    client.on('error', () => {});
    return new Promise<number>(resolve => client.once('unexpected-response', (_, response) => { resolve(response.statusCode!); response.destroy(); client.terminate(); }));
  }
  assert.equal(await rejected({ origin: 'https://evil.invalid' }), 403);
  assert.equal(await rejected({ host: 'evil.invalid:' + config.port }), 403);
  function connect() {
    const client = new WebSocket(url, { headers }); clients.push(client);
    const events: TerminalOutput[] = [];
    client.on('message', raw => {
      const event = JSON.parse(raw.toString()) as TerminalOutput; events.push(event);
      if (event.type === 'data' || event.type === 'snapshot') client.send(JSON.stringify({ type: 'ack', count: event.data.length }));
    });
    client.on('error', () => {});
    async function until(condition: () => boolean) {
      const deadline = Date.now() + 5000;
      while (!condition()) { assert.ok(Date.now() < deadline, 'WebSocket event timeout'); await new Promise(resolve => setTimeout(resolve, 10)); }
    }
    return { client, events, until, output: () => events.flatMap(event => event.type === 'data' || event.type === 'snapshot' ? [event.data] : []).join(''), input: (data: string) => client.send(JSON.stringify({ type: 'input', data })) };
  }
  async function action(name: string) {
    return new Promise<void>((resolve, reject) => {
      const request = httpRequest('http://127.0.0.1:' + port + '/api/tasks/' + task.id + '/' + name, { method: 'POST', headers }, response => {
        let body = ''; response.on('data', chunk => { body += chunk; });
        response.on('end', () => { try { assert.equal(response.statusCode, 200, body); resolve(); } catch (error) { reject(error); } });
      });
      request.on('error', reject); request.end('{}');
    });
  }
  const first = connect(); await first.until(() => first.output().includes('\x1b]133;A\x07'));
  assert.equal(authenticated, true);
  first.input('touch forbidden\r');
  await first.until(() => first.events.some(event => event.type === 'error' && event.message.includes('接管')));
  await assert.rejects(access(join(root, 'forbidden')));
  await action('takeover');
  await first.until(() => first.events.some(event => event.type === 'mode' && event.writable));
  first.input('export PICODING_WS_VALUE=保持会话; printf "first-command-done\\n"\r');
  await first.until(() => /\r(?:\n)?first-command-done\r\n/.test(first.output()));
  first.client.close(); await new Promise<void>(resolve => first.client.once('close', () => resolve()));
  const second = connect();
  await second.until(() => second.events.some(event => event.type === 'snapshot' && event.data.includes('first-command-done')));
  second.client.send(JSON.stringify({ type: 'resize', cols: 101, rows: 53 }));
  second.input('printf "%s\\n" "$PICODING_WS_VALUE"; stty size\r');
  await second.until(() => second.output().includes('保持会话\r\n53 101\r\n'));
  await action('release'); assert.equal(task.status, 'ready');
  second.input('touch forbidden\r');
  await second.until(() => second.events.some(event => event.type === 'error' && event.message.includes('接管')));
  await assert.rejects(access(join(root, 'forbidden')));
});
