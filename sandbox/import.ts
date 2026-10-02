import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { gitProjectSource } from '../shared/project.js';
import type { GitProjectSource, ImportResult } from '../shared/types.js';
import { HttpError } from '../server/http.js';

const execute = promisify(execFile);
const gitEnv = () => ({
  ...process.env, WORKER_TOKEN: undefined, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/false',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_LFS_SKIP_SMUDGE: '1',
});

// Import only into a fresh task. Staging and final workspace share a volume,
// so moving entries does not silently copy over existing project files.
export async function importRepository(root: string, input: GitProjectSource, signal?: AbortSignal): Promise<ImportResult> {
  const source = gitProjectSource(input);
  const metadata = join(root, '.picoding');
  const marker = join(metadata, 'import.json');
  try {
    const saved = JSON.parse(await readFile(marker, 'utf8'));
    if (JSON.stringify(saved.source) === JSON.stringify(source)) return saved.result;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  async function assertFresh() {
    for (const name of await readdir(root)) {
      if (name === '.picoding') continue;
      // The desktop creates an empty download directory in every fresh volume.
      if (name === 'downloads' && (await lstat(join(root, name))).isDirectory() && !(await readdir(join(root, name))).length) continue;
      throw new HttpError(409, '导入仓库需要空白工作区，请新建任务');
    }
  }
  await assertFresh();
  await mkdir(metadata, { recursive: true });
  const staging = join(metadata, 'import-' + randomUUID());
  const moved: string[] = [];
  try {
    const options = { env: gitEnv(), timeout: 120_000, maxBuffer: 100_000, signal };
    try {
      await execute('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', 'clone', '--depth', '1', '--single-branch', ...(source.branch ? ['--branch', source.branch] : []), '--', source.url, staging], options);
    } catch {
      if (signal?.aborted) throw new HttpError(409, '仓库导入已取消');
      throw new HttpError(400, '仓库导入失败，请检查公开仓库地址、分支和任务电脑的网络连接');
    }
    const names = await readdir(staging);
    if (names.includes('.picoding')) throw new HttpError(409, '仓库包含工作台保留目录 .picoding，请改名后导入');
    await assertFresh();
    if (names.includes('downloads')) await rmdir(join(root, 'downloads')).catch(error => { if (error.code !== 'ENOENT') throw error; });
    const head = (await execute('git', ['-C', staging, 'rev-parse', 'HEAD'], options)).stdout.trim();
    const branch = (await execute('git', ['-C', staging, 'branch', '--show-current'], options)).stdout.trim();
    for (const name of names) { await rename(join(staging, name), join(root, name)); moved.push(name); }
    const result = { head, branch };
    await writeFile(marker, JSON.stringify({ source, result }), { mode: 0o600 });
    return result;
  } catch (error) {
    for (const name of moved.reverse()) await rename(join(root, name), join(staging, name));
    throw error;
  } finally { await rm(staging, { recursive: true, force: true }); }
}
