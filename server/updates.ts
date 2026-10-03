import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, rm, link, chown } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from './http.js';
import { runningVersion } from './version.js';
import { updateActive, type AppVersion, type UpdateJob, type UpdateRelease, type UpdateStatus } from '../shared/updates.js';

export const updateRepository = 'https://github.com/joyiok/picoding.git';
export const updateApi = 'https://api.github.com/repos/joyiok/picoding';
export const validCommit = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{40}$/.test(value);
export async function writeUpdateJob(directory: string, job: UpdateJob, owner?: { uid: number; gid: number }) {
  const temporary = join(directory, `status-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(job) + '\n', { mode: 0o600, flag: 'wx' });
    if (owner) await chown(temporary, owner.uid, owner.gid);
    await rename(temporary, join(directory, 'status.json'));
  }
  finally { await rm(temporary, { force: true }); }
}
export async function readUpdateJob(directory?: string): Promise<UpdateJob | undefined> {
  if (!directory) return;
  try {
    const job = JSON.parse(await readFile(join(directory, 'status.json'), 'utf8'));
    if (!validCommit(job.commit) || typeof job.id !== 'string' || !['queued', 'preparing', 'backing-up', 'restarting', 'rolling-back', 'succeeded', 'failed'].includes(job.phase) || typeof job.message !== 'string' || !Number.isFinite(Date.parse(job.startedAt)) || !Number.isFinite(Date.parse(job.updatedAt))) throw new Error('invalid status');
    return job;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new HttpError(503, '更新状态文件无法读取，请检查服务器更新服务');
  }
}

export class UpdateManager {
  private latest?: UpdateRelease;
  private checkedAt?: string;
  private checking?: Promise<UpdateStatus>;
  private requesting = false;
  private version: Promise<AppVersion>;
  constructor(readonly directory?: string, version = runningVersion(), private readonly fetcher: typeof fetch = fetch) { this.version = version; }
  private async github(path: string): Promise<any> {
    let response: Response;
    try { response = await this.fetcher(updateApi + path, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PiCoding-updater' }, signal: AbortSignal.timeout(10_000), redirect: 'error' }); }
    catch { throw new HttpError(502, '无法连接 GitHub，请检查服务器网络后重试'); }
    if (response.status === 403 || response.status === 429) throw new HttpError(503, 'GitHub 检查次数已达上限，请稍后重试');
    if (!response.ok) throw new HttpError(502, `GitHub 版本检查失败（${response.status}），请稍后重试`);
    return response.json();
  }
  async status(): Promise<UpdateStatus> {
    const current = await this.version;
    let enabled = false;
    if (this.directory) {
      try { enabled = JSON.parse(await readFile(join(this.directory, 'enabled.json'), 'utf8')).version === 1; } catch { /* Not installed. */ }
    }
    const disabledReason = !enabled ? '服务器尚未启用更新服务，请按部署文档完成安装。' : current.dirty ? '当前构建包含本地修改，请先保存并部署已提交的版本。' : !current.commit ? '当前构建没有 Git 版本信息，请重新构建。' : undefined;
    const pending = await this.pending();
    return { current, latest: this.latest, checkedAt: this.checkedAt, available: Boolean(this.latest && this.latest.commit !== current.commit), enabled: enabled && !disabledReason, disabledReason, job: pending || await readUpdateJob(this.directory) };
  }
  check(): Promise<UpdateStatus> {
    if (this.checking) return this.checking;
    this.checking = this.checkLatest().finally(() => { this.checking = undefined; });
    return this.checking;
  }
  private async checkLatest() {
    // Invalidate the previous result before requesting: failures must not leave an installable stale target.
    this.latest = undefined; this.checkedAt = undefined;
    const data = await this.github('/commits/main');
    if (!validCommit(data.sha) || typeof data.commit?.message !== 'string' || !Number.isFinite(Date.parse(data.commit?.committer?.date))) throw new HttpError(502, 'GitHub 返回了无效的版本信息');
    const current = await this.version;
    if (current.commit && current.commit !== data.sha) {
      const comparison = await this.github(`/compare/${current.commit}...${data.sha}`);
      if (comparison.status !== 'ahead') throw new HttpError(409, '当前版本与 main 分支不一致，请由服务器管理员检查后更新');
    }
    this.latest = { commit: data.sha, title: data.commit.message.split('\n')[0].slice(0, 200), date: data.commit.committer.date, url: `https://github.com/joyiok/picoding/commit/${data.sha}` };
    this.checkedAt = new Date().toISOString();
    return this.status();
  }
  async request(commit: unknown): Promise<UpdateStatus> {
    if (this.requesting) throw new HttpError(409, '更新已经开始，请等待完成');
    this.requesting = true;
    try {
      const status = await this.status();
      if (!status.enabled || !this.directory) throw new HttpError(409, status.disabledReason || '更新服务未启用');
      if (updateActive(status.job)) throw new HttpError(409, '更新已经开始，请等待完成');
      if (!validCommit(commit) || commit !== this.latest?.commit || !status.available || !this.checkedAt || Date.now() - Date.parse(this.checkedAt) > 5 * 60_000) throw new HttpError(409, '版本信息已失效，请重新检查更新');
      const now = new Date().toISOString();
      const job: UpdateJob = { id: randomUUID(), commit, phase: 'queued', message: '已提交更新，等待服务器处理', startedAt: now, updatedAt: now };
      // An exclusive request file also protects multiple server processes and survives restarts.
      const pending = join(this.directory, 'request.json');
      const temporary = join(this.directory, `request-${job.id}.tmp`);
      try { await writeFile(temporary, JSON.stringify(job) + '\n', { mode: 0o600, flag: 'wx' }); await link(temporary, pending); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new HttpError(409, '更新已经排队，请等待服务器处理'); throw error; }
      finally { await rm(temporary, { force: true }); }
      // The worker owns status.json. Read-side status prefers the request until it is claimed.
      return { ...status, job };
    } finally { this.requesting = false; }
  }
  async pending(): Promise<UpdateJob | undefined> {
    if (!this.directory) return;
    try { const job = JSON.parse(await readFile(join(this.directory, 'request.json'), 'utf8')); if (!validCommit(job.commit) || job.phase !== 'queued' || typeof job.id !== 'string') throw new Error('invalid request'); return job; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw new HttpError(503, '更新请求无法读取，请检查服务器更新服务'); }
  }
}
