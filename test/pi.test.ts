import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { createPiSession } from '../server/agent.js';
import { SettingsStore } from '../server/settings.js';
import type { Sandbox } from '../server/docker.js';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

test('real pi SDK executes a sandbox tool and settles a streamed conversation offline', { timeout: 15_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-pi-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = new SettingsStore(directory); await settings.load();
  await settings.update({ protocol: 'openai', model: 'offline-test', baseUrl: 'https://example.invalid/v1', apiKey: 'test-secret' });
  const requests: { path: string; body: unknown }[] = [];
  const sandbox: Sandbox = {
    url: 'http://unused.invalid', token: 'test-worker-token',
    async request<T>(path: string, body?: unknown) { requests.push({ path, body }); return { ok: true } as T; },
    async stop() {}, async destroy() {},
  };
  const events: AgentSessionEvent[] = [];
  const session = await createPiSession('offline-test', sandbox, settings, () => {}, event => events.push(event), join(directory, 'session'));
  t.after(() => session.dispose());
  assert.deepEqual(session.getActiveToolNames().sort(), ['sandbox_read', 'sandbox_write', 'sandbox_edit', 'sandbox_ls', 'sandbox_bash', 'browser'].sort());
  let calls = 0;
  // A scripted model transport is used only by this test; the production session uses the configured API.
  session.agent.streamFunction = model => {
    const stream = createAssistantMessageEventStream();
    const first = calls++ === 0;
    const answer: AssistantMessage = {
      role: 'assistant', provider: model.provider, model: model.id, api: model.api,
      content: first ? [{ type: 'toolCall', id: 'write-1', name: 'sandbox_write', arguments: { path: 'hello.txt', content: 'hello from pi' } }] : [{ type: 'text', text: '已完成。' }],
      stopReason: first ? 'toolUse' : 'stop', timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    queueMicrotask(() => { stream.push({ type: 'start', partial: answer }); stream.push({ type: 'done', reason: answer.stopReason as 'stop' | 'toolUse', message: answer }); });
    return stream;
  };
  await session.prompt('Create hello.txt');
  assert.equal(calls, 2);
  assert.deepEqual(requests, [{ path: '/file', body: { path: 'hello.txt', content: 'hello from pi' } }]);
  assert.equal(session.getLastAssistantText(), '已完成。');
  assert.ok(events.some(event => event.type === 'tool_execution_start'));
  assert.ok(events.some(event => event.type === 'agent_settled'));
});

for (const supportsImages of [false, true]) {
  test(`real pi browser tool ${supportsImages ? 'includes' : 'omits'} screenshots and preserves page text for a small context model`, { timeout: 15_000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'picoding-pi-images-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const settings = new SettingsStore(directory); await settings.load();
    await settings.update({ protocol: 'openai', model: 'small-context', baseUrl: 'https://example.invalid/v1', apiKey: 'test-secret', contextWindow: 16_384, maxTokens: 2048, supportsImages });
    // The worker response is a test fixture; the real SDK still runs the tool loop.
    const screenshot = Buffer.from('fixture screenshot').toString('base64');
    const sandbox: Sandbox = {
      url: 'http://unused.invalid', token: 'test',
      async request<T>(path: string) {
        assert.equal(path, '/browser');
        return { url: 'http://localhost:3000', title: 'Test page', tabs: [], snapshot: '- heading "页面内容"', screenshot } as T;
      }, async stop() {}, async destroy() {},
    };
    const session = await createPiSession('image-test', sandbox, settings, () => {}, () => {}, join(directory, 'session'));
    t.after(() => session.dispose());
    session.sessionManager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'An earlier page screenshot.' }, { type: 'image', data: screenshot, mimeType: 'image/jpeg' }], timestamp: Date.now() });
    const compaction = session.settingsManager.getCompactionSettings(session.model);
    assert.ok(compaction.reserveTokens + compaction.keepRecentTokens < 16_384);
    let calls = 0;
    session.agent.streamFunction = (model, context) => {
      const first = calls++ === 0;
      const history = context.messages.find(message => message.role === 'user' && Array.isArray(message.content) && message.content.some(block => block.type === 'text' && block.text.includes('An earlier page screenshot.')));
      assert.ok(history && history.role === 'user' && Array.isArray(history.content));
      assert.equal(history.content.some(block => block.type === 'image'), supportsImages);
      if (!first) {
        const result = context.messages.find(message => message.role === 'toolResult');
        assert.ok(result && result.role === 'toolResult');
        assert.ok(result.content.some(block => block.type === 'text' && block.text.includes('页面内容')));
        assert.equal(result.content.some(block => block.type === 'image'), supportsImages);
      }
      const stream = createAssistantMessageEventStream();
      const answer: AssistantMessage = {
        role: 'assistant', provider: model.provider, model: model.id, api: model.api,
        content: first ? [{ type: 'toolCall', id: 'browser-1', name: 'browser', arguments: { action: 'snapshot' } }] : [{ type: 'text', text: '页面已验证。' }],
        stopReason: first ? 'toolUse' : 'stop', timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      queueMicrotask(() => { stream.push({ type: 'start', partial: answer }); stream.push({ type: 'done', reason: answer.stopReason as 'stop' | 'toolUse', message: answer }); });
      return stream;
    };
    await session.prompt('Verify this page.');
    assert.equal(calls, 2);
    assert.equal(session.getLastAssistantText(), '页面已验证。');
  });
}
