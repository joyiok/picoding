import { mkdir, readFile, rename, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Task } from '../shared/types.js';
import { config } from './config.js';
import { HttpError } from './http.js';

export class TaskStore {
  readonly interruptedIds: string[] = [];
  private tasks = new Map<string, Task>();
  private writes = new Map<string, Promise<void>>();
  constructor(readonly directory = join(config.dataDir, 'tasks')) {}

  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const file of await readdir(this.directory)) {
      if (!/^[a-f\d-]{36}\.json$/.test(file)) continue;
      try {
        const task = JSON.parse(await readFile(join(this.directory, file), 'utf8')) as Task;
        if (`${task.id}.json` !== file || !Array.isArray(task.messages)) continue;
        if (!['stopped', 'error'].includes(task.status)) {
          this.interruptedIds.push(task.id);
          task.status = 'stopped'; task.error = '工作台已重启，点击「启动环境」继续此任务';
        }
        for (const message of task.messages) message.streaming = false;
        for (const tool of task.tools) if (tool.status === 'running') { tool.status = 'error'; tool.output = '工作台重启，操作已中断'; }
        this.tasks.set(task.id, task);
      } catch (error) { console.error(`无法读取任务 ${file}`, error); }
    }
  }

  list() { return [...this.tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  get(id: string) {
    const task = this.tasks.get(id);
    if (!task) throw new HttpError(404, '任务不存在');
    return task;
  }
  async save(task: Task) {
    this.tasks.set(task.id, task);
    const serialized = JSON.stringify(task);
    const previous = this.writes.get(task.id) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const path = join(this.directory, `${task.id}.json`);
      await writeFile(`${path}.tmp`, serialized, { mode: 0o600 });
      await rename(`${path}.tmp`, path);
    });
    this.writes.set(task.id, next);
    try { await next; } finally { if (this.writes.get(task.id) === next) this.writes.delete(task.id); }
  }
  async delete(id: string) {
    await this.writes.get(id)?.catch(() => {});
    await unlink(join(this.directory, `${id}.json`));
    this.tasks.delete(id);
  }
  async flush() { await Promise.all([...this.writes.values()]); }
}
