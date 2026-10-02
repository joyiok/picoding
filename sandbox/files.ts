import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { FileEntry, FileWriteOptions } from '../shared/types.js';
import { HttpError } from '../server/http.js';

const MAX_FILE_SIZE = 2 * 1024 * 1024;
export class WorkspaceFiles {
  private writes = new Map<string, Promise<unknown>>();
  constructor(readonly root: string) { this.root = resolve(root); }

  async path(input: string, create = false) {
    if (typeof input !== 'string' || input.includes('\0')) throw new HttpError(400, '无效的文件路径');
    const target = resolve(this.root, input || '.');
    this.check(target);
    // Check existing ancestors before making a directory: a symlink may escape the workspace.
    let existing = target;
    while (true) {
      try { this.check(await realpath(existing)); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) throw error;
        const parent = dirname(existing);
        if (parent === existing) throw new HttpError(403, '路径超出了项目目录');
        existing = parent;
      }
    }
    return target;
  }
  private check(path: string) {
    const delta = relative(this.root, path);
    if (delta === '..' || delta.startsWith('../') || isAbsolute(delta)) throw new HttpError(403, '路径超出了项目目录');
  }

  async list(input = ''): Promise<FileEntry[]> {
    const directory = await this.path(input);
    const entries = await readdir(directory, { withFileTypes: true });
    const result: FileEntry[] = [];
    for (const entry of entries) {
      if (['.git', 'node_modules', '.picoding'].includes(entry.name) || entry.isSymbolicLink()) continue;
      const full = join(directory, entry.name);
      const info = await lstat(full);
      result.push({ name: entry.name, path: relative(this.root, full), type: entry.isDirectory() ? 'directory' : 'file', size: info.size });
    }
    return result.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1);
  }

  async read(input: string) {
    const file = await this.path(input);
    const info = await stat(file);
    if (!info.isFile()) throw new HttpError(400, '请选择文件');
    if (info.size > MAX_FILE_SIZE) throw new HttpError(413, '文件超过 2 MB，请通过终端查看或下载项目');
    const content = await readFile(file);
    if (content.includes(0)) throw new HttpError(415, '这个文件是二进制文件，请下载项目后查看');
    return { path: input, content: content.toString('utf8'), version: this.version(content) };
  }

  private version(content: Buffer | string) { return createHash('sha256').update(content).digest('hex'); }

  private async serialize<T>(input: string, operation: () => Promise<T>): Promise<T> {
    const key = resolve(this.root, input);
    const previous = this.writes.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.writes.set(key, next);
    try { return await next; } finally { if (this.writes.get(key) === next) this.writes.delete(key); }
  }

  write(input: string, content: string, options: FileWriteOptions = {}) {
    return this.serialize(input, () => this.writeUnlocked(input, content, options));
  }

  private async writeUnlocked(input: string, content: string, options: FileWriteOptions = {}) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_FILE_SIZE) throw new HttpError(413, '文件内容不能超过 2 MB');
    const file = await this.path(input, true);
    await mkdir(dirname(file), { recursive: true });
    if (options.expectedVersion !== undefined) {
      let current: Buffer;
      try { current = await readFile(file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(409, '文件已被删除，请重新读取'); throw error; }
      if (this.version(current) !== options.expectedVersion) throw new HttpError(409, '文件已在电脑上发生变化。你的草稿已保留，请重新载入并合并改动后保存。');
    }
    try { await writeFile(file, content, { encoding: 'utf8', flag: options.createOnly ? 'wx' : 'w' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new HttpError(409, '这个文件已存在，请使用另一个路径'); throw error; }
    return { ok: true as const, version: this.version(content) };
  }

  edit(input: string, oldText: string, newText: string) {
    return this.serialize(input, () => this.editUnlocked(input, oldText, newText));
  }

  private async editUnlocked(input: string, oldText: string, newText: string) {
    if (!oldText) throw new HttpError(400, '要替换的文本不能为空');
    const file = await this.read(input);
    const first = file.content.indexOf(oldText);
    if (first < 0) throw new HttpError(409, '没有找到要替换的原始文本，请重新读取文件');
    if (file.content.indexOf(oldText, first + oldText.length) >= 0) throw new HttpError(409, '原始文本出现多次，请包含更多上下文');
    return this.writeUnlocked(input, file.content.slice(0, first) + newText + file.content.slice(first + oldText.length), { expectedVersion: file.version });
  }
}
