import { randomUUID } from 'node:crypto';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { ChatMessage, Task, TaskEvent, TerminalEntry } from '../shared/types.js';
import { createPiSession } from './agent.js';
import { config } from './config.js';
import { DockerSandbox, sandboxApi, type Sandbox } from './docker.js';
import { EventHub } from './events.js';
import { errorMessage, HttpError } from './http.js';
import type { SettingsStore } from './settings.js';
import type { TaskStore } from './store.js';

export class Workbench {
  readonly events = new EventHub();
  private sandboxes = new Map<string, Sandbox>();
  private sessions = new Map<string, AgentSession>();
  private starting = new Map<string, Promise<void>>();
  private dirty = new Map<string, ReturnType<typeof setTimeout>>();
  private assistantIds = new Map<string, string>();
  private manualCommands = new Map<string, AbortController>();
  constructor(readonly store: TaskStore, readonly settings: SettingsStore, private readonly makeSandbox: (id: string) => Sandbox & { start(): Promise<void> } = id => new DockerSandbox(id)) {}

  async create(title: string, prompt?: string) {
    if (this.store.list().filter(task => !['error', 'stopped'].includes(task.status)).length >= config.maxTasks) throw new HttpError(409, `最多同时运行 ${config.maxTasks} 个环境，请先停止一个任务`);
    const now = new Date().toISOString();
    const task: Task = { id: randomUUID(), title, status: 'creating', createdAt: now, updatedAt: now, messages: prompt ? [{ id: randomUUID(), role: 'user', text: prompt, createdAt: now }] : [], tools: [], terminal: [], pendingPrompt: prompt };
    await this.store.save(task);
    void this.start(task.id).catch(error => console.error('任务启动失败', errorMessage(error)));
    return task;
  }

  async start(id: string) {
    if (this.starting.has(id)) return this.starting.get(id);
    this.validateStart(id);
    const task = this.store.get(id);
    task.status = 'creating'; delete task.error; this.changed(task);
    const sandbox = this.makeSandbox(id);
    const operation = (async () => {
      try {
        await sandbox.start();
        this.sandboxes.set(id, sandbox);
        // Establish a baseline for a fresh workspace without committing user work on restart.
        await sandboxApi.command(sandbox, 'if [ ! -d .git ]; then git init -q && git -c user.name=PiCoding -c user.email=local@picoding.invalid commit --allow-empty -qm "Initial workspace"; fi; if [ -d .git/info ]; then printf "\\n.picoding/\\nnode_modules/\\n" >> .git/info/exclude; fi');
        task.status = 'ready'; this.changed(task);
        if (task.pendingPrompt) void this.send(id, task.pendingPrompt, true).catch(error => console.error('任务执行失败', errorMessage(error)));
      } catch (error) {
        task.status = 'error'; task.error = errorMessage(error); this.changed(task);
        this.sandboxes.delete(id); await sandbox.stop().catch(() => {});
      } finally { this.starting.delete(id); await this.store.save(task); }
    })();
    this.starting.set(id, operation);
    return operation;
  }

  validateStart(id: string) {
    this.store.get(id);
    if (this.sandboxes.has(id)) throw new HttpError(409, '任务环境已经运行；如需重启，请先停止环境');
    const active = this.store.list().filter(other => other.id !== id && !['error', 'stopped'].includes(other.status)).length;
    if (active >= config.maxTasks) throw new HttpError(409, `最多同时运行 ${config.maxTasks} 个环境`);
  }

  sandbox(id: string): Sandbox {
    this.store.get(id);
    const sandbox = this.sandboxes.get(id);
    if (!sandbox) throw new HttpError(409, '任务环境尚未运行，请点击「启动环境」');
    return sandbox;
  }

  private emit(id: string, event: TaskEvent) {
    const task = this.store.get(id);
    if (event.type === 'terminal') {
      task.terminal.push(event.entry); if (task.terminal.length > 100) task.terminal.shift();
    } else if (event.type === 'browser') task.browserUrl = event.state.url;
    this.events.publish(id, event); this.schedule(task);
  }

  private changed(task: Task) { task.updatedAt = new Date().toISOString(); this.events.publish(task.id, { type: 'task', task }); this.schedule(task); }
  private schedule(task: Task) {
    if (this.dirty.has(task.id)) return;
    this.dirty.set(task.id, setTimeout(() => {
      this.dirty.delete(task.id);
      void this.store.save(task).catch(error => console.error('保存任务失败', errorMessage(error)));
    }, 250));
  }

  private onPiEvent(id: string, event: AgentSessionEvent) {
    const task = this.store.get(id);
    if (event.type === 'message_start' && event.message.role === 'assistant') {
      const message: ChatMessage = { id: randomUUID(), role: 'assistant', text: '', createdAt: new Date().toISOString(), streaming: true };
      task.messages.push(message); this.assistantIds.set(id, message.id); this.emit(id, { type: 'message', message });
    } else if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      const message = task.messages.find(message => message.id === this.assistantIds.get(id));
      if (message) { message.text += event.assistantMessageEvent.delta; this.emit(id, { type: 'message', message }); }
    } else if (event.type === 'message_end' && event.message.role === 'assistant') {
      const message = task.messages.find(message => message.id === this.assistantIds.get(id));
      if (message) {
        message.text = event.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
        message.streaming = false;
        if (event.message.stopReason === 'error') message.error = event.message.errorMessage || '模型请求失败，请检查设置后重试';
        this.emit(id, { type: 'message', message });
      }
    } else if (event.type === 'tool_execution_start') {
      const tool = { id: event.toolCallId, name: event.toolName, args: event.args as Record<string, unknown>, status: 'running' as const, createdAt: new Date().toISOString() };
      task.tools.push(tool); this.emit(id, { type: 'tool', tool });
    } else if (event.type === 'tool_execution_end') {
      const tool = task.tools.find(tool => tool.id === event.toolCallId);
      if (tool) {
        tool.status = event.isError ? 'error' : 'done';
        const result = event.result as { content?: { type: string; text?: string }[] };
        tool.output = result?.content?.filter(block => block.type === 'text').map(block => block.text || '').join('\n').slice(0, 12_000) || '';
        this.emit(id, { type: 'tool', tool });
      }
    }
  }

  async send(id: string, text: string, alreadyRecorded = false) {
    const task = this.store.get(id);
    this.validateSend(id);
    const sandbox = this.sandbox(id);
    task.status = 'running'; delete task.error;
    delete task.pendingPrompt;
    if (!alreadyRecorded) {
      const message: ChatMessage = { id: randomUUID(), role: 'user', text, createdAt: new Date().toISOString() };
      task.messages.push(message); this.emit(id, { type: 'message', message });
    }
    this.changed(task);
    try {
      let session = this.sessions.get(id);
      if (!session) {
        session = await createPiSession(id, sandbox, this.settings, event => this.emit(id, event), event => this.onPiEvent(id, event));
        this.sessions.set(id, session);
      }
      if (task.status === 'running') await session.prompt(text);
    } catch (error) { task.error = errorMessage(error); }
    finally {
      if (task.status === 'running') task.status = 'ready';
      for (const message of task.messages) message.streaming = false;
      this.changed(task); await this.store.save(task);
    }
  }

  async abort(id: string, takeover = false) {
    const task = this.store.get(id);
    const sandbox = this.sandbox(id);
    if (task.status === 'pausing') throw new HttpError(409, '正在等待当前操作停止');
    task.status = 'pausing'; this.changed(task);
    const session = this.sessions.get(id);
    session?.clearQueue();
    this.manualCommands.get(id)?.abort();
    try { await Promise.all([session?.abort(), sandbox.request('/cancel', {})]); }
    catch (error) {
      task.status = 'error'; task.error = `停止当前操作失败：${errorMessage(error)}`; this.changed(task); await this.store.save(task); throw error;
    }
    task.status = takeover ? 'paused' : 'ready';
    for (const message of task.messages) message.streaming = false;
    this.changed(task); await this.store.save(task);
  }

  async release(id: string) {
    const task = this.store.get(id);
    if (task.status !== 'paused') throw new HttpError(409, '浏览器当前未被接管');
    // Synchronize the tab selected manually in Chromium before pi can act again.
    this.emit(id, { type: 'browser', state: await sandboxApi.browser(this.sandbox(id)) });
    task.status = 'ready'; this.changed(task); await this.store.save(task);
  }

  async command(id: string, command: string) {
    const task = this.store.get(id);
    if (!['ready', 'paused'].includes(task.status) || this.manualCommands.has(id)) throw new HttpError(409, '请先停止 agent 或等待当前命令完成');
    const controller = new AbortController(); this.manualCommands.set(id, controller);
    try {
      const result = await sandboxApi.command(this.sandbox(id), command, controller.signal);
      const entry: TerminalEntry = { id: randomUUID(), command, ...result, createdAt: new Date().toISOString() };
      this.emit(id, { type: 'terminal', entry }); this.emit(id, { type: 'files_changed' }); return entry;
    } finally { this.manualCommands.delete(id); }
  }

  async stop(id: string) {
    await this.starting.get(id);
    const task = this.store.get(id);
    task.status = 'pausing'; this.changed(task);
    this.manualCommands.get(id)?.abort();
    const session = this.sessions.get(id);
    try {
      session?.clearQueue(); await session?.abort();
      this.sessions.get(id)?.dispose(); this.sessions.delete(id);
      await this.sandboxes.get(id)?.stop(); this.sandboxes.delete(id);
      task.status = 'stopped'; delete task.error;
    } catch (error) { task.status = 'error'; task.error = errorMessage(error); throw error; }
    finally { this.changed(task); await this.store.save(task); }
  }

  async remove(id: string) {
    await this.stop(id);
    await new DockerSandbox(id).destroy();
    clearTimeout(this.dirty.get(id)); this.dirty.delete(id);
    await this.store.delete(id);
  }

  invalidateSessions() {
    if (this.store.list().some(task => ['running', 'pausing'].includes(task.status))) throw new HttpError(409, '请先停止正在执行的任务，再修改模型设置');
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
  }

  validateSend(id: string) {
    const task = this.store.get(id);
    if (task.status !== 'ready') throw new HttpError(409, task.status === 'paused' ? '请先归还浏览器，再继续任务' : '请等待当前操作完成或先启动环境');
    if (this.manualCommands.has(id)) throw new HttpError(409, '请等待终端命令完成，再发送任务');
    if (!this.settings.public().configured) throw new HttpError(409, '请先在模型设置中填写 API 格式、地址、模型 ID 和密钥');
  }

  async shutdown() {
    await Promise.all([...this.starting.values()]);
    for (const controller of this.manualCommands.values()) controller.abort();
    for (const session of this.sessions.values()) { session.clearQueue(); await session.abort(); session.dispose(); }
    await Promise.all([...this.sandboxes.values()].map(sandbox => sandbox.stop()));
    for (const task of this.store.list()) if (!['error', 'stopped'].includes(task.status)) { task.status = 'stopped'; await this.store.save(task); }
    for (const timer of this.dirty.values()) clearTimeout(timer);
    this.dirty.clear(); this.events.close(); await this.store.flush();
  }
}
