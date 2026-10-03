import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AppVersion } from '../shared/updates.js';

const exec = promisify(execFile);
export async function sourceVersion(directory = process.cwd()): Promise<AppVersion> {
  const { version } = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  try {
    const [{ stdout: commit }, { stdout: changes }] = await Promise.all([
      exec('git', ['rev-parse', 'HEAD'], { cwd: directory, timeout: 5000 }),
      exec('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: directory, timeout: 5000 }),
    ]);
    return { version, commit: commit.trim(), dirty: Boolean(changes.trim()) };
  } catch { return { version, commit: null, dirty: false }; }
}
export async function runningVersion(): Promise<AppVersion> {
  try {
    const value = JSON.parse(await readFile(resolve('dist/version.json'), 'utf8'));
    if (typeof value.version === 'string' && (value.commit === null || /^[a-f\d]{40}$/.test(value.commit)) && typeof value.dirty === 'boolean') return value;
  } catch { /* Older builds do not have a manifest. */ }
  return sourceVersion();
}
