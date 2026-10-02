import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { probeModel } from '../server/model-probe.js';
import { SettingsStore } from '../server/settings.js';
import { TaskStore } from '../server/store.js';
import { Workbench } from '../server/workbench.js';
import { createApp } from '../server/app.js';
import { config } from '../server/config.js';
import type { ModelSettings } from '../shared/types.js';
import { textReply } from './provider.js';

async function listen(server: Server) { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); return (server.address() as AddressInfo).port; }
function close(server: Server) { server.closeAllConnections(); server.close(); }
const defaults = { model: 'custom-probe-model', apiKey: 'probe-fixture-only', contextWindow: 8192, maxTokens: 2048, supportsImages: false };

for (const protocol of ['openai', 'anthropic'] as const) {
  test(`connection probe uses the exact unsaved ${protocol} model and credential without changing saved settings`, { timeout: 15_000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'picoding-probe-')); t.after(() => rm(directory, { recursive: true, force: true }));
    const captured: { url?: string; headers: Record<string, unknown>; body: Record<string, unknown> }[] = [];
    const provider = createServer(async (request, response) => {
      const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      captured.push({ url: request.url, headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
      textReply(response, protocol, defaults.model);
    });
    const port = await listen(provider); t.after(() => close(provider));
    const settings = new SettingsStore(directory); await settings.load();
    await settings.update({ protocol: 'openai', ...defaults, model: 'saved-model', baseUrl: 'https://saved.invalid/v1', apiKey: 'saved-fixture-only' });
    const before = await readFile(join(directory, 'settings.json'), 'utf8');
    const store = new TaskStore(join(directory, 'tasks')); await store.load();
    const workbench = new Workbench(store, settings); t.after(() => workbench.shutdown());
    const app = createApp(workbench); const appPort = await listen(app); t.after(() => close(app));
    const candidate = { ...defaults, protocol, baseUrl: `http://127.0.0.1:${port}/gateway${protocol === 'openai' ? '/v1' : ''}` };
    const result = await new Promise<{ status?: number; body: Record<string, unknown> }>((resolve, reject) => {
      const input = request({ host: '127.0.0.1', port: appPort, path: '/api/settings/test', method: 'POST', headers: { Host: `127.0.0.1:${config.port}`, 'Content-Type': 'application/json' } }, response => {
        const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      }); input.on('error', reject); input.end(JSON.stringify(candidate));
    });
    assert.equal(result.status, 200); assert.equal(result.body.model, defaults.model); assert.equal(result.body.protocol, protocol); assert.ok(Number(result.body.latencyMs) >= 0);
    assert.equal(captured.length, 1); assert.equal(captured[0].body.model, defaults.model);
    assert.equal(captured[0].url?.split('?')[0], protocol === 'openai' ? '/gateway/v1/chat/completions' : '/gateway/v1/messages');
    assert.equal(captured[0].headers[protocol === 'openai' ? 'authorization' : 'x-api-key'], protocol === 'openai' ? 'Bearer ' + defaults.apiKey : defaults.apiKey);
    assert.equal(captured[0].body[protocol === 'openai' ? 'max_completion_tokens' : 'max_tokens'], 64);
    assert.equal(captured[0].body.tools, undefined);
    assert.equal(await readFile(join(directory, 'settings.json'), 'utf8'), before); assert.equal(settings.key(), 'saved-fixture-only');
    assert.equal(settings.get().model, 'saved-model'); assert.deepEqual(await readdir(join(directory, 'tasks')), []);
    assert.equal(JSON.stringify(result.body).includes(defaults.apiKey), false);
  });
}

test('candidate validation retains a saved key only at its endpoint and never saves the probe', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-candidate-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = new SettingsStore(directory); await settings.load();
  const saved = { ...defaults, protocol: 'openai' as const, baseUrl: 'https://same.invalid/v1' };
  await settings.update(saved);
  assert.equal(settings.preview({ ...saved, model: 'another-model', apiKey: undefined }).apiKey, defaults.apiKey);
  assert.throws(() => settings.preview({ ...saved, baseUrl: 'https://other.invalid/v1', apiKey: undefined }), /重新填写密钥/);
  assert.throws(() => settings.preview({ ...saved, contextWindow: 0 }), /正整数/);
  assert.equal(settings.get().model, defaults.model);
});

test('probe errors redact credentials and stalled or cancelled requests end promptly', { timeout: 15_000 }, async t => {
  const secret = 'fixture+secret/with?encoding';
  const provider = createServer((request, response) => {
    if (request.url?.startsWith('/bad/')) { response.writeHead(401, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'Rejected ' + secret + ' ' + encodeURIComponent(secret), type: 'invalid_request_error' } })); }
    else if (request.url?.startsWith('/empty/')) textReply(response, 'openai', defaults.model, '');
    else request.resume();
  });
  const port = await listen(provider); t.after(() => close(provider));
  const candidate: ModelSettings = { ...defaults, protocol: 'openai', apiKey: secret, baseUrl: `http://127.0.0.1:${port}/bad/v1` };
  await assert.rejects(probeModel(candidate), error => {
    assert.ok(error instanceof Error); assert.equal(error.message.includes(secret), false); assert.equal(error.message.includes(encodeURIComponent(secret)), false); assert.match(error.message, /密钥已隐藏/); assert.equal(error.message.includes('invalid_request_error'), false); return true;
  });
  await assert.rejects(probeModel({ ...candidate, baseUrl: `http://127.0.0.1:${port}/empty/v1` }), /未返回有效/);
  await assert.rejects(probeModel({ ...candidate, baseUrl: `http://127.0.0.1:${port}/hang/v1` }, undefined, 120), /超时/);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 120);
  try { await assert.rejects(probeModel({ ...candidate, baseUrl: `http://127.0.0.1:${port}/hang/v1` }, controller.signal), /已取消/); }
  finally { clearTimeout(timer); }
});
