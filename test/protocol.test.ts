import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPiSession } from '../server/agent.js';
import { SettingsStore } from '../server/settings.js';
import type { Sandbox } from '../server/docker.js';

for (const protocol of ['openai', 'anthropic'] as const) {
  test(`pi SDK sends ${protocol} format to the user endpoint with the exact custom model ID`, { timeout: 15_000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), `picoding-wire-${protocol}-`));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const requests: { url?: string; headers: Record<string, unknown>; body: Record<string, unknown> }[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({ url: request.url, headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const model = 'tenant-defined-model-not-in-catalog';
      if (protocol === 'openai') {
        response.end([
          { id: 'reply', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: { role: 'assistant', content: 'custom endpoint works' }, finish_reason: null }] },
          { id: 'reply', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } },
        ].map(value => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n');
      } else {
        response.end([
          { type: 'message_start', message: { id: 'reply', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'custom endpoint works' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } },
          { type: 'message_stop' },
        ].map(value => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`).join(''));
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const port = (server.address() as AddressInfo).port;
    const settings = new SettingsStore(directory); await settings.load();
    await settings.update({ protocol, model: 'tenant-defined-model-not-in-catalog', baseUrl: `http://127.0.0.1:${port}/gateway${protocol === 'openai' ? '/v1' : ''}`, apiKey: 'wire-test-secret', contextWindow: 32_768, maxTokens: 2048, supportsImages: false });
    const sandbox: Sandbox = { url: 'http://unused.invalid', token: 'test', async request<T>() { throw new Error('No tool call expected'); }, async stop() {}, async destroy() {} };
    const session = await createPiSession(`wire-${protocol}`, sandbox, settings, () => {}, () => {}, join(directory, 'session'));
    t.after(() => session.dispose());
    const historicalImage = Buffer.from('historical screenshot fixture').toString('base64');
    session.sessionManager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'Screenshot from an earlier model configuration.' }, { type: 'image', data: historicalImage, mimeType: 'image/jpeg' }], timestamp: Date.now() });
    await session.prompt('Say that the custom endpoint works.');
    assert.equal(session.getLastAssistantText(), 'custom endpoint works');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.model, 'tenant-defined-model-not-in-catalog');
    assert.ok(JSON.stringify(requests[0].body).includes('Screenshot from an earlier model configuration.'));
    assert.equal(JSON.stringify(requests[0].body).includes(historicalImage), false);
    assert.equal(requests[0].body[protocol === 'openai' ? 'max_completion_tokens' : 'max_tokens'], 2048);
    assert.equal(requests[0].url?.split('?')[0], protocol === 'openai' ? '/gateway/v1/chat/completions' : '/gateway/v1/messages');
    assert.equal(requests[0].headers[protocol === 'openai' ? 'authorization' : 'x-api-key'], protocol === 'openai' ? 'Bearer wire-test-secret' : 'wire-test-secret');
    assert.equal(session.model?.api, protocol === 'openai' ? 'openai-completions' : 'anthropic-messages');
    assert.equal(session.model?.contextWindow, 32_768);
    assert.equal(session.model?.maxTokens, 2048);
    assert.deepEqual(session.model?.input, ['text']);
  });
}
