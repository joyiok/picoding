import { createHash, randomUUID } from 'node:crypto';
import { relative, sep } from 'node:path';
import {
  createBashToolDefinition, createEditToolDefinition, createReadToolDefinition, createWriteToolDefinition,
  type Skill, type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { TaskEvent } from '../shared/types.js';
import { sandboxApi, type Sandbox } from './docker.js';
import { HttpError } from './http.js';

export function skillDirectory(skill: Skill) { return '/workspace/.picoding/pi-skills/' + createHash('sha256').update(skill.baseDir).digest('hex').slice(0, 24); }

/** Native Pi tools with their supported remote operations, routed to the task computer. */
export function nativeSandboxTools(sandbox: Sandbox, skills: Skill[], sessionDirectory: string, emit: (event: TaskEvent) => void): ToolDefinition[] {
  const mappings = () => skills.map(skill => ({ source: skill.baseDir, target: skillDirectory(skill) })).sort((a, b) => b.source.length - a.source.length);
  function sandboxPath(path: string) {
    for (const item of mappings()) if (path === item.source || path.startsWith(item.source + sep)) return item.target + path.slice(item.source.length).split(sep).join('/');
    // Native tool contexts use the control service's session cwd; resolve relative paths in /workspace.
    const delta = relative(sessionDirectory, path);
    if (path === sessionDirectory || path.startsWith(sessionDirectory + sep)) return '/workspace/' + delta.split(sep).join('/');
    return path;
  }
  const versions = new Map<string, string>();
  async function read(path: string) {
    const file = await sandboxApi.read(sandbox, sandboxPath(path));
    versions.set(path, file.version);
    return Buffer.from(file.content);
  }
  async function write(path: string, content: string, expectedVersion?: string) {
    await sandboxApi.write(sandbox, sandboxPath(path), content, expectedVersion ? { expectedVersion } : {});
    emit({ type: 'files_changed' });
  }
  const tools = [
    createReadToolDefinition('/workspace', { operations: { readFile: read, access: async () => {} } }),
    createWriteToolDefinition('/workspace', { operations: { writeFile: (path, content) => write(path, content), mkdir: async () => {} } }),
    createEditToolDefinition('/workspace', { operations: { readFile: read, access: async () => {}, writeFile: (path, content) => write(path, content, versions.get(path)) } }),
    createBashToolDefinition('/workspace', { exposeSessionEnvironment: false, operations: { exec: async (command, _cwd, options) => {
      for (const item of mappings()) command = command.split(item.source).join(item.target);
      const signal = options.timeout ? AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(Math.min(options.timeout, 120) * 1000)]) : options.signal;
      const result = await sandboxApi.command(sandbox, command, signal);
      options.onData(Buffer.from(result.output));
      emit({ type: 'terminal', entry: { id: randomUUID(), command, ...result, createdAt: new Date().toISOString() } }); emit({ type: 'files_changed' });
      if (result.exitCode === null) throw new HttpError(408, '沙盒命令被中断或超时');
      return { exitCode: result.exitCode };
    } } }),
  ];
  // The SDK accepts heterogeneous schemas; its terminal renderer generics are invariant.
  return tools as unknown as ToolDefinition[];
}
