import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, lstat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, relative, sep, posix } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { create, extract, list } from 'tar';
import { config } from './config.js';
import { docker } from './docker.js';
import { acquireDataLease, leaseFile } from './data-lease.js';

const idPattern = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/;
const shaPattern = /^[a-f\d]{64}$/;
const maxExpandedBytes = 100 * 1024 ** 3;
interface BackupTask { id: string; workspace: boolean; sha256?: string; }
interface BackupManifest { version: 1; createdAt: string; controlSha256: string; tasks: BackupTask[]; }
export interface BackupVolumes {
  exists(id: string): Promise<boolean>;
  assertStopped(ids: string[]): Promise<void>;
  export(id: string, file: string): Promise<void>;
  restore(id: string, file: string): Promise<void>;
  remove(id: string): Promise<void>;
}

async function checksum(file: string) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex');
}
async function taskIds(directory: string) {
  let files: string[];
  try { files = await readdir(join(directory, 'tasks')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const ids: string[] = [];
  for (const file of files.filter(file => file.endsWith('.json'))) {
    const task = JSON.parse(await readFile(join(directory, 'tasks', file), 'utf8'));
    if (!idPattern.test(task.id) || file !== `${task.id}.json` || !Array.isArray(task.messages) || !Array.isArray(task.tools) || !Array.isArray(task.terminal)) throw new Error(`任务记录无效：${file}`);
    if (!['stopped', 'error'].includes(task.status)) throw new Error('请先正常停止工作台，再备份或恢复；中断的任务需先启动工作台完成恢复再退出');
    ids.push(task.id);
  }
  return ids.sort();
}

export async function validateArchive(file: string, control = false) {
  let size = 0, invalid: Error | undefined;
  await list({ file, strict: true, onReadEntry(entry) {
    try {
    const path = entry.path.replace(/^\.\//, '');
    if (path.startsWith('/') || path.includes('\\') || /^[a-z]:/i.test(path) || path.split('/').includes('..') || /[\u0000-\u001f\u007f]/.test(path)) throw new Error('备份含无效或越界的文件路径');
    if (!['File', 'Directory', 'SymbolicLink', 'Link'].includes(entry.type)) throw new Error('备份含不支持的文件类型');
    if (control && path === leaseFile) throw new Error('备份不能覆盖数据目录锁');
    if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
      const link = entry.linkpath; if (!link) throw new Error('备份含无效链接');
      const target = posix.resolve('/backup', entry.type === 'Link' ? '' : posix.dirname(path), link);
      if (link.startsWith('/') || link.includes('\\') || /^[a-z]:/i.test(link) || target !== '/backup' && !target.startsWith('/backup/')) throw new Error('备份含指向数据目录外的链接，请先处理该链接');
    }
    size += entry.size; if (size > maxExpandedBytes) throw new Error('单个备份归档解压后超过 100 GiB');
    } catch (error) { invalid ||= error instanceof Error ? error : new Error(String(error)); }
  } });
  if (invalid) throw invalid;
}

function volume(id: string) { if (!idPattern.test(id)) throw new Error('备份任务 ID 无效'); return 'picoding-work-' + id; }
async function volumeTransfer(id: string, file: string, restore: boolean) {
  const name = 'picoding-maintenance-' + randomUUID();
  const child = spawn('docker', ['run', '--rm', '--init', '--name', name, '--label', 'app=picoding-maintenance', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true', '--read-only', '--pids-limit', '32', '--memory', '128m', '--cpus', '1', '--user', '1000:1000', '--mount', `type=volume,src=${volume(id)},dst=/workspace${restore ? '' : ',readonly'}`, '--entrypoint', 'tar', ...(restore ? ['--interactive'] : []), config.image, restore ? '-xzf' : '-czf', '-', ...(restore ? ['--no-same-owner'] : []), '-C', '/workspace', ...(restore ? [] : ['.'])], { stdio: ['pipe', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', data => { errors = (errors + data.toString()).slice(-4096); });
  const exited = new Promise<void>((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(errors || 'Docker 备份传输失败'))); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60_000);
  try {
    if (restore) { child.stdout.resume(); await Promise.all([pipeline(createReadStream(file), child.stdin), exited]); }
    else { child.stdin.end(); await Promise.all([pipeline(child.stdout, createWriteStream(file, { flags: 'wx', mode: 0o600 })), exited]); }
  } catch (error) { child.kill('SIGKILL'); await docker(['rm', '-f', name]).catch(() => {}); throw error; }
  finally { clearTimeout(timer); }
}

export const dockerBackupVolumes: BackupVolumes = {
  async exists(id) { try { await docker(['volume', 'inspect', volume(id)]); return true; } catch (error) { if (/No such volume/i.test(String(error))) return false; throw error; } },
  async assertStopped(ids) { for (const id of ids) if (await docker(['ps', '--filter', 'volume=' + volume(id), '--format', '{{.ID}}'])) throw new Error('项目卷仍被运行中的容器使用，请先停止工作台'); },
  export: (id, file) => volumeTransfer(id, file, false),
  async restore(id, file) {
    if (await this.exists(id)) throw new Error('同名项目卷已存在，恢复不会覆盖它');
    await docker(['volume', 'create', '--label', 'app=picoding', '--label', 'picoding.task=' + id, volume(id)]);
    try { await volumeTransfer(id, file, true); } catch (error) { await this.remove(id); throw error; }
  },
  async remove(id) { await docker(['volume', 'rm', volume(id)]); },
};

export async function backupWorkspace(dataDir: string, destination: string, volumes = dockerBackupVolumes) {
  const lease = await acquireDataLease(dataDir); let created = false, output: string | undefined;
  try {
    const source = await realpath(dataDir); output = join(await realpath(dirname(resolve(destination))), basename(resolve(destination)));
    const delta = relative(source, output); if (!delta || !(delta === '..' || delta.startsWith('..' + sep) || isAbsolute(delta))) throw new Error('备份目录必须放在数据目录外');
    const ids = await taskIds(source); await volumes.assertStopped(ids);
    await mkdir(output, { mode: 0o700 }); created = true;
    const control = join(output, 'control.tar.gz');
    await create({ file: control, gzip: true, cwd: source, portable: true, strict: true, filter: path => path.replace(/^\.\//, '') !== leaseFile }, ['.']);
    await validateArchive(control, true);
    const tasks: BackupTask[] = [];
    for (const id of ids) {
      lease.check();
      const workspace = await volumes.exists(id), record: BackupTask = { id, workspace };
      if (workspace) { const file = join(output, `workspace-${id}.tar.gz`); await volumes.export(id, file); await validateArchive(file); record.sha256 = await checksum(file); }
      tasks.push(record);
    }
    const manifest: BackupManifest = { version: 1, createdAt: new Date().toISOString(), controlSha256: await checksum(control), tasks };
    lease.check();
    await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return { destination: output, tasks: tasks.length, workspaces: tasks.filter(task => task.workspace).length };
  } catch (error) { if (created && output) await rm(output, { recursive: true, force: true }); throw error; }
  finally { await lease.release(); }
}

function manifest(value: unknown): BackupManifest {
  const saved = value as BackupManifest;
  if (!saved || saved.version !== 1 || !shaPattern.test(saved.controlSha256) || !Array.isArray(saved.tasks) || saved.tasks.length > 10_000) throw new Error('备份清单无效或版本不支持');
  const seen = new Set<string>();
  for (const task of saved.tasks) {
    if (!task || !idPattern.test(task.id) || seen.has(task.id) || typeof task.workspace !== 'boolean' || task.workspace && !shaPattern.test(task.sha256 || '')) throw new Error('备份任务清单无效');
    seen.add(task.id);
  }
  return saved;
}

export async function restoreWorkspace(dataDir: string, source: string, volumes = dockerBackupVolumes) {
  const lease = await acquireDataLease(dataDir), target = await realpath(dataDir);
  let staging: string | undefined; const restored: string[] = [], moved: string[] = [];
  try {
    if ((await readdir(target)).some(file => file !== leaseFile)) throw new Error('恢复目标数据目录必须为空，不会覆盖已有设置或任务');
    const root = await realpath(source), data = manifest(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')));
    const archives = [{ file: 'control.tar.gz', sha: data.controlSha256, control: true }, ...data.tasks.filter(task => task.workspace).map(task => ({ file: `workspace-${task.id}.tar.gz`, sha: task.sha256!, control: false }))];
    for (const archive of archives) {
      const file = join(root, archive.file); if (!(await lstat(file)).isFile() || await checksum(file) !== archive.sha) throw new Error(`备份完整性校验失败：${archive.file}`);
      await validateArchive(file, archive.control);
    }
    for (const task of data.tasks) if (await volumes.exists(task.id)) throw new Error('目标机器已有同名项目卷，请在空的 Docker 环境恢复；不会覆盖项目');
    staging = await mkdtemp(join(target, '.restore-'));
    const control = join(staging, 'control'); await mkdir(control, { mode: 0o700 });
    await extract({ file: join(root, 'control.tar.gz'), cwd: control, strict: true, preserveOwner: false });
    const ids = await taskIds(control);
    if (JSON.stringify(ids) !== JSON.stringify(data.tasks.map(task => task.id).sort())) throw new Error('任务记录与备份清单不一致');
    for (const task of data.tasks) if (task.workspace) { lease.check(); await volumes.restore(task.id, join(root, `workspace-${task.id}.tar.gz`)); restored.push(task.id); }
    for (const file of await readdir(control)) { lease.check(); await rename(join(control, file), join(target, file)); moved.push(file); }
    return { tasks: data.tasks.length, workspaces: restored.length };
  } catch (error) {
    for (const file of moved) await rm(join(target, file), { recursive: true, force: true });
    const cleanup = await Promise.allSettled(restored.map(id => volumes.remove(id)));
    const failures = cleanup.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError([error, ...failures.map(result => (result as PromiseRejectedResult).reason)], '恢复失败，部分新建项目卷清理失败，请检查 Docker；原有数据未覆盖');
    throw error;
  } finally { if (staging) await rm(staging, { recursive: true, force: true }); await lease.release(); }
}
