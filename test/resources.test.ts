import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { PiResources } from '../server/resources.js';
import { createPiSession } from '../server/agent.js';
import { nativeSandboxTools } from '../server/pi-tools.js';
import { SettingsStore } from '../server/settings.js';
import { WorkspaceFiles } from '../sandbox/files.js';
import { executeCommand } from '../sandbox/commands.js';
import type { Sandbox } from '../server/docker.js';
import type { TaskEvent } from '../shared/types.js';
import { resourcePackage } from './resource-package.js';
import { Workbench } from '../server/workbench.js';
import { TaskStore } from '../server/store.js';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-resources-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = await resourcePackage(directory);
  const resources = new PiResources(join(directory, 'private'));
  return { directory, source, resources };
}

test('native Pi package settings persist install, filtering, update and removal without changing local source files', async t => {
  const { directory, source, resources } = await fixture(t);
  const empty = await resources.catalog(); assert.deepEqual(empty.packages, []); assert.deepEqual(empty.skills, []);
  const installed = await resources.change('install', source);
  const packageSource = installed.packages[0].source;
  assert.equal(installed.packages.length, 1); assert.equal(installed.packages[0].installed, true);
  assert.equal(installed.packages[0].skills, 1); assert.equal(installed.packages[0].extensions, 1); assert.equal(installed.packages[0].prompts, 1);
  assert.equal(installed.skills[0].command, '/skill:fixture-skill');
  const saved = JSON.parse(await readFile(join(resources.agentDir, 'settings.json'), 'utf8'));
  assert.equal(resolve(resources.agentDir, saved.packages[0]), source);
  const restored = new PiResources(join(directory, 'private'));
  assert.equal((await restored.catalog()).skills.length, 1);
  const disabled = await restored.change('disable', packageSource);
  assert.equal(disabled.packages[0].enabled, false); assert.equal(disabled.packages[0].skills, 1);
  assert.deepEqual(disabled.skills, []); assert.deepEqual(disabled.extensions, []); assert.deepEqual(disabled.prompts, []);
  assert.equal((await restored.change('enable', packageSource)).skills.length, 1);
  await restored.change('install', source); assert.equal((await restored.catalog()).packages.length, 1);
  await restored.change('update', packageSource);
  assert.deepEqual((await restored.change('remove', packageSource)).packages, []);
  assert.match(await readFile(join(source, 'skills/fixture-skill/SKILL.md'), 'utf8'), /NATIVE_SKILL_BODY/);
});

test('Pi resource discovery includes its own skills directory and rejects invalid package operations without saving', async t => {
  const { resources, directory } = await fixture(t);
  const path = join(resources.agentDir, 'skills', 'direct-skill'); await mkdir(path, { recursive: true });
  await cp(join(directory, 'native-pi-fixture/skills/fixture-skill/SKILL.md'), join(path, 'SKILL.md'));
  assert.equal((await resources.catalog()).skills[0].name, 'fixture-skill');
  for (const source of ['', '-dangerous-option', 'npm:fake\n--flag', 'nul\0path']) await assert.rejects(resources.change('install', source));
  await assert.rejects(resources.change('remove', '/not-configured'), /尚未安装/);
  assert.deepEqual((await resources.catalog()).packages, []);
});

async function remoteFixture(directory: string) {
  const root = join(directory, 'workspace'); await mkdir(root);
  const files = new WorkspaceFiles(root); const commands: string[] = [];
  const localPath = (path: string) => path.startsWith('/workspace/') ? path.slice('/workspace/'.length) : path === '/workspace' ? '' : path;
  const sandbox: Sandbox = {
    url: 'http://fixture.invalid', token: 'fixture', async stop() {}, async destroy() {},
    async copyResources(source, destination) { await cp(source, join(root, localPath(destination)), { recursive: true }); },
    async request<T>(path: string, body?: any, signal?: AbortSignal) {
      if (path.startsWith('/file?')) return await files.read(localPath(new URL(path, 'http://fixture').searchParams.get('path')!)) as T;
      if (path === '/file') return await files.write(localPath(body.path), body.content, body) as T;
      if (path === '/command') { commands.push(body.command); return await executeCommand(body.command.split('/workspace/').join(root + '/'), root, signal) as T; }
      throw new Error('Unexpected fixture request: ' + path);
    },
  };
  return { sandbox, files, commands };
}

test('official Pi read, write, multi-edit and Bash operations use sandbox paths and reject arbitrary host reads', async t => {
  const { directory } = await fixture(t); const { sandbox, files } = await remoteFixture(directory);
  const events: TaskEvent[] = [];
  const tools = nativeSandboxTools(sandbox, [], join(directory, 'session'), event => events.push(event));
  const run = (name: string, args: object) => tools.find(tool => tool.name === name)!.execute('native-test', args, undefined, undefined, undefined as never);
  await run('write', { path: 'example.txt', content: 'first\nsecond\nthird\n' });
  await run('edit', { path: 'example.txt', edits: [{ oldText: 'first', newText: 'ONE' }, { oldText: 'third', newText: 'THREE' }] });
  assert.equal((await files.read('example.txt')).content, 'ONE\nsecond\nTHREE\n');
  const result = await run('read', { path: 'example.txt', offset: 2, limit: 1 }); assert.match(JSON.stringify(result), /second/); assert.doesNotMatch(JSON.stringify(result), /ONE/);
  await assert.rejects(run('read', { path: '/etc/passwd' }), /路径超出了/);
  await run('bash', { command: 'printf NATIVE_BASH_OK', timeout: 3 });
  assert.ok(events.some(event => event.type === 'terminal' && event.entry.output.includes('NATIVE_BASH_OK')));
});

test('real Pi SDK loads native skills, dynamic discovery, templates, extension tools and slash commands', { timeout: 20_000 }, async t => {
  const { directory, source, resources } = await fixture(t);
  await resources.change('install', source);
  const { sandbox, files, commands } = await remoteFixture(directory);
  const settings = new SettingsStore(join(directory, 'private')); await settings.load();
  await settings.update({ protocol: 'openai', model: 'offline-native', baseUrl: 'https://fixture.invalid/v1', apiKey: 'fictional-key' });
  const session = await createPiSession('native-fixture', sandbox, settings, () => {}, () => {}, join(directory, 'session'), resources);
  t.after(() => session.dispose());
  assert.ok(session.getActiveToolNames().includes('fixture_ping'));
  assert.ok(session.resourceLoader.getSkills().skills.some(skill => skill.name === 'dynamic-fixture'));
  assert.match(await readFile(join(directory, 'workspace/.picoding/pi-skills', session.resourceLoader.getSkills().skills.find(skill => skill.name === 'dynamic-fixture')!.baseDir.split('/').at(-1)!, 'SKILL.md'), 'utf8'), /DYNAMIC_SKILL_BODY/);
  let calls = 0;
  session.agent.streamFunction = (model, context) => {
    assert.match(session.systemPrompt, /<available_skills>/);
    const step = calls++;
    if (step === 0) { assert.match(JSON.stringify(context.messages), /NATIVE_SKILL_BODY/); assert.match(JSON.stringify(context.messages), /References are relative to \/workspace\/\.picoding\/pi-skills/); }
    const content: AssistantMessage['content'] = step === 0 ? [{ type: 'toolCall', id: 'native-ping', name: 'fixture_ping', arguments: { word: 'OK' } }] : step === 1 ? [{ type: 'toolCall', id: 'native-helper', name: 'bash', arguments: { command: 'python3 ' + join(source, 'skills/fixture-skill/scripts/check.py') } }] : [{ type: 'text', text: 'NATIVE_ALL_OK' }];
    const answer: AssistantMessage = { role: 'assistant', provider: model.provider, model: model.id, api: model.api, content, stopReason: step < 2 ? 'toolUse' : 'stop', timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = createAssistantMessageEventStream(); queueMicrotask(() => { stream.push({ type: 'start', partial: answer }); stream.push({ type: 'done', reason: step < 2 ? 'toolUse' : 'stop', message: answer }); }); return stream;
  };
  await session.prompt('/skill:fixture-skill run the native helper');
  assert.equal(calls, 3); assert.equal((await files.read('native-helper.txt')).content, 'NATIVE_HELPER_OK');
  assert.ok(commands.some(command => command.includes('/workspace/.picoding/pi-skills/'))); assert.equal(await readFile(join(source, 'skills/fixture-skill/scripts/check.py'), 'utf8').then(text => text.includes('NATIVE_HELPER_OK')), true);
  await session.prompt('/fixture-echo hello'); assert.equal(calls, 3); assert.match(JSON.stringify(session.messages.at(-1)), /NATIVE_COMMAND_OK:hello/);
  session.agent.streamFunction = (model, context) => {
    assert.match(JSON.stringify(context.messages), /NATIVE_PROMPT_BODY: review code/);
    const answer: AssistantMessage = { role: 'assistant', provider: model.provider, model: model.id, api: model.api, content: [{ type: 'text', text: 'NATIVE_TEMPLATE_OK' }], stopReason: 'stop', timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const stream = createAssistantMessageEventStream(); queueMicrotask(() => { stream.push({ type: 'start', partial: answer }); stream.push({ type: 'done', reason: 'stop', message: answer }); }); return stream;
  };
  await session.prompt('/fixture-review code'); assert.equal(session.getLastAssistantText(), 'NATIVE_TEMPLATE_OK');
});

test('human takeover during skill transfer cancels initialization before the model can run and retains task messages', { timeout: 15_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-skill-abort-'));
  const resources = new PiResources(directory); await resources.change('install', await resourcePackage(directory));
  const store = new TaskStore(join(directory, 'tasks')); await store.load();
  const settings = new SettingsStore(directory); await settings.load();
  await settings.update({ protocol: 'openai', model: 'offline-abort', baseUrl: 'https://fixture.invalid/v1', apiKey: 'fictional-key' });
  let started!: () => void; const transferring = new Promise<void>(resolve => { started = resolve; });
  const sandbox: Sandbox & { start: () => Promise<void> } = { url: 'http://fixture.invalid', token: 'fixture', async start() {}, async stop() {}, async destroy() {},
    async request<T>() { return { output: '', exitCode: 0, ok: true } as T; },
    copyResources: async (_source, _destination, signal) => { started(); await new Promise<void>((_resolve, reject) => { signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }); }); },
  };
  const workbench = new Workbench(store, settings, () => sandbox, resources);
  t.after(async () => { await workbench.shutdown(); await rm(directory, { recursive: true, force: true }); });
  const task = await workbench.create('skill initialization');
  while (task.status === 'creating') await new Promise(resolve => setTimeout(resolve, 5));
  const sending = workbench.send(task.id, '/skill:fixture-skill do the task'); await transferring;
  await assert.rejects(workbench.changeResources('disable', (await resources.catalog()).packages[0].source), /先停止/);
  await workbench.abort(task.id, true); await sending;
  assert.equal(task.status, 'paused'); assert.equal(task.error, undefined); assert.equal(task.messages.length, 1);
  assert.equal(task.messages[0].text, '/skill:fixture-skill do the task');
});
