import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { chmod, chown, copyFile, lstat, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { readUpdateJob, updateRepository, validCommit, writeUpdateJob } from '../server/updates.js';
import { updateActive } from '../shared/updates.js';
import { runUpdate } from '../server/update-runner.js';
import { acquireDataLease } from '../server/data-lease.js';
import type { UpdateJob } from '../shared/updates.js';

const exec = promisify(execFile);
const installation = '/opt/picoding', releases = '/opt/picoding-releases';
const state = '/var/lib/picoding-updates', backups = '/srv/picoding-backups';
const recoveryFile = '/opt/picoding-releases/.update-recovery.json';
const [action, ...extra] = process.argv.slice(2);
async function command(file: string, args: string[], cwd?: string, env = process.env, timeout = 20 * 60_000) {
  try { return (await exec(file, args, { cwd, env, timeout, maxBuffer: 16 * 1024 * 1024 })).stdout.trim(); }
  catch (error) {
    // Logs stay with the privileged systemd job; API status never exposes credentials or build output.
    console.error(`${file} failed`, (error as { stderr?: string }).stderr || '');
    throw new Error(`${file} 执行失败，请查看服务器更新日志`);
  }
}
async function switchRelease(directory: string) {
  const temporary = `/opt/.picoding-${randomUUID()}`;
  try { await symlink(directory, temporary); await rename(temporary, installation); }
  finally { await rm(temporary, { force: true }); }
}
async function identity() {
  const uid = Number(await command('id', ['-u', 'picoding'])), gid = Number(await command('id', ['-g', 'picoding']));
  return { uid, gid };
}
async function setup() {
  if (await realpath(process.cwd()) !== await realpath(installation)) throw new Error('请从 /opt/picoding 运行安装命令');
  const { config } = await import('../server/config.js');
  if (existsSync(join(installation, '.env')) || existsSync(join(installation, '.picoding'))) throw new Error('请先将 .env 配置和 .picoding 数据迁移到代码目录外，再安装更新服务');
  const codeRoot = await realpath(installation);
  const dataRoot = await realpath(config.dataDir);
  const data = relative(codeRoot, dataRoot);
  if (!data.startsWith('../') || dataRoot === releases || dataRoot.startsWith(releases + '/') || !process.env.PICODING_DATA_DIR?.startsWith('/')) throw new Error('请在 /etc/picoding.env 配置代码目录之外的绝对 PICODING_DATA_DIR');
  const { uid, gid } = await identity();
  const node = await realpath(process.execPath);
  if (!/^\/[a-zA-Z0-9_./-]+$/.test(node) || node.startsWith('/home/') || node.startsWith('/root/')) throw new Error('请使用系统级 Node 安装更新服务');
  await mkdir(state, { recursive: true, mode: 0o700 }); await chown(state, uid, gid); await chmod(state, 0o700);
  await mkdir(backups, { recursive: true, mode: 0o700 }); await chown(backups, uid, gid); await chmod(backups, 0o700);
  await mkdir(releases, { recursive: true, mode: 0o755 });
  await chown(releases, 0, 0); await chmod(releases, 0o755);
  const realInstallation = await realpath(installation);
  if (!(await lstat(installation)).isSymbolicLink()) {
    const original = join(releases, 'initial-' + Date.now());
    await rename(installation, original);
    try { await symlink(original, installation); } catch (error) { await rename(original, installation); throw error; }
  } else if (!realInstallation.startsWith(releases + '/')) throw new Error('现有 /opt/picoding 链接必须指向 /opt/picoding-releases');
  await command('chown', ['-R', 'root:root', await realpath(installation)]);
  await command('chmod', ['-R', 'u=rwX,go=rX', await realpath(installation)]);
  const environment = '/etc/picoding.env';
  const text = await readFile(environment, 'utf8');
  if (/^\s*PICODING_UPDATE_DIR\s*=/m.test(text)) {
    if (config.updateDir !== state) throw new Error('PICODING_UPDATE_DIR 必须为 /var/lib/picoding-updates');
  } else await writeFile(environment, text.trimEnd() + '\nPICODING_UPDATE_DIR=/var/lib/picoding-updates\n', { mode: 0o600 });
  await chmod(environment, 0o600);
  for (const name of ['picoding-update.service', 'picoding-update.path']) await copyFile(join(installation, 'deploy', name), '/etc/systemd/system/' + name);
  const servicePath = '/etc/systemd/system/picoding-update.service';
  await writeFile(servicePath, (await readFile(servicePath, 'utf8')).replace('/usr/bin/node', node), { mode: 0o644 });
  await mkdir('/usr/local/lib/picoding', { recursive: true, mode: 0o755 });
  // Install only the compiled, built-in-only maintenance modules. Release cleanup must not remove the updater.
  const runner = '/usr/local/lib/picoding/runner';
  for (const group of ['scripts', 'server', 'shared']) await mkdir(join(runner, group), { recursive: true, mode: 0o755 });
  await writeFile(join(runner, 'package.json'), '{"type":"module"}\n', { mode: 0o644 });
  for (const file of ['scripts/update.js', 'server/updates.js', 'server/version.js', 'server/http.js', 'server/config.js', 'server/update-runner.js', 'server/data-lease.js', 'shared/updates.js']) {
    await copyFile(join(installation, 'dist', file), join(runner, file));
    await chown(join(runner, file), 0, 0); await chmod(join(runner, file), 0o644);
  }
  const updater = join(runner, 'scripts/update.js');
  await writeFile('/usr/local/lib/picoding/update', '#!/bin/sh\ncd /opt/picoding || exit 1\nexec ' + node + ' ' + updater + ' "$@"\n', { mode: 0o755 });
  // A drop-in keeps custom application service settings intact.
  await mkdir('/etc/systemd/system/picoding.service.d', { recursive: true });
  await writeFile('/etc/systemd/system/picoding.service.d/update.conf', '[Service]\nReadWritePaths=/var/lib/picoding-updates\n', { mode: 0o644 });
  await command('systemctl', ['daemon-reload']);
  await command('systemctl', ['enable', '--now', 'picoding-update.path']);
  await writeFile(join(state, 'enabled.json'), '{"version":1}\n', { mode: 0o600 }); await chown(join(state, 'enabled.json'), uid, gid);
  await command('systemctl', ['restart', 'picoding.service']);
  console.log('设置页一键更新已启用。代码使用独立发布目录；更新前完整备份，旧程序与镜像保留。');
}
async function apply() {
  const lease = await acquireDataLease(state);
  let job: UpdateJob | undefined;
  let owner: { uid: number; gid: number };
  const save = (value: UpdateJob) => writeUpdateJob(state, value, owner);
  try {
    owner = await identity();
    const { uid, gid } = owner;
    try { job = JSON.parse(await readFile(join(state, 'request.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (!job || !validCommit(job.commit) || typeof job.id !== 'string' || !/^[a-f\d-]{36}$/.test(job.id) || job.phase !== 'queued' || !Number.isFinite(Date.parse(job.startedAt))) throw new Error('更新请求无效');
    await save(job); await rename(join(state, 'request.json'), join(state, 'active.json'));
    const { config } = await import('../server/config.js');
    const previous = await realpath(installation), candidate = join(releases, `${job.commit}-${job.id}`);
    let previousImage = '', switched = false;
    const image = `picoding-sandbox:update-${job.commit}`;
    const runAsService = (file: string, args: string[], cwd: string, env = process.env) => command('runuser', ['-u', 'picoding', '--', file, ...args], cwd, env);
    const backup = join(backups, `${new Date().toISOString().replace(/[:.]/g, '-')}-${job.id}`);
    job = await runUpdate(job, {
      async prepare() {
        if (!(await lstat(installation)).isSymbolicLink() || !previous.startsWith(releases + '/')) throw new Error('代码目录未安装为独立发布目录，请重新安装更新服务');
        if (await command('git', ['-c', `safe.directory=${previous}`, 'status', '--porcelain'], previous)) throw new Error('服务器代码含本地修改，请先由管理员保存修改');
        await mkdir(candidate, { mode: 0o755 }); await chown(candidate, uid, gid);
        await runAsService('git', ['clone', '--no-checkout', '--single-branch', '--branch', 'main', '--', updateRepository, '.'], candidate);
        // Pin the checked commit, accept only forward changes contained in the official main branch.
        await runAsService('git', ['merge-base', '--is-ancestor', job!.commit, 'origin/main'], candidate);
        const previousCommit = await command('git', ['-c', `safe.directory=${previous}`, 'rev-parse', 'HEAD'], previous);
        const previousBuild = JSON.parse(await readFile(join(previous, 'dist/version.json'), 'utf8'));
        if (previousBuild.commit !== previousCommit || previousBuild.dirty) throw new Error('当前构建与服务器代码不一致，请由管理员重新构建后再更新');
        await runAsService('git', ['merge-base', '--is-ancestor', previousCommit, job!.commit], candidate);
        if (previousCommit === job!.commit) throw new Error('服务器已运行此版本');
        await runAsService('git', ['checkout', '--detach', job!.commit], candidate);
        await runAsService('npm', ['ci', '--include=dev'], candidate);
        await runAsService('npm', ['run', 'build'], candidate);
        previousImage = await command('docker', ['image', 'inspect', '--format', '{{.Id}}', config.image]);
        await command('docker', ['tag', previousImage, `picoding-sandbox:before-update-${job!.id}`]);
        await runAsService('npm', ['run', 'sandbox:build'], candidate, { ...process.env, PICODING_SANDBOX_IMAGE: image });
        const built = JSON.parse(await readFile(join(candidate, 'dist/version.json'), 'utf8'));
        if (built.commit !== job!.commit || built.dirty) throw new Error('新程序的版本信息不一致');
        await command('chown', ['-R', 'root:root', candidate]); await command('chmod', ['-R', 'u=rwX,go=rX', candidate]);
        // This recovery record is outside the service-writable state directory.
        await writeFile(recoveryFile, JSON.stringify({ previous, previousImage, image: config.image, job }), { mode: 0o600 });
      },
      async stop() { await command('systemctl', ['stop', 'picoding.service'], undefined, process.env, 120_000); },
      async backup() { await runAsService(process.execPath, [join(previous, 'dist/scripts/backup.js'), 'create', backup], previous); },
      async activate() { switched = true; await command('docker', ['tag', image, config.image]); await switchRelease(candidate); },
      async start() { await command('systemctl', ['start', 'picoding.service']); },
      async healthy() {
        const expected = switched ? job!.commit : JSON.parse(await readFile(join(previous, 'dist/version.json'), 'utf8')).commit;
        const host = config.host === '0.0.0.0' ? '127.0.0.1' : config.host === '::' ? '[::1]' : config.host.includes(':') ? `[${config.host}]` : config.host;
        const base = `http://${host}:${config.port}`;
        for (let attempt = 0; attempt < 45; attempt++) {
          try {
            if (await command('systemctl', ['is-active', 'picoding.service'], undefined, process.env, 5000) === 'active') {
              const response = await fetch(base + '/api/auth', { signal: AbortSignal.timeout(2000), headers: config.publicOrigin ? { Host: new URL(config.publicOrigin).host } : undefined, redirect: 'error' });
              if (response.ok && response.headers.get('X-PiCoding-Commit') === expected) return;
            }
          } catch { /* Wait for startup and the listening port. */ }
          await delay(1000);
        }
        throw new Error('重启后服务未通过版本和访问检查');
      },
      async rollback() { await switchRelease(previous); await command('docker', ['tag', previousImage, config.image]); switched = false; },
    }, save);
    if (job.phase === 'failed') process.exitCode = 1;
  } catch (error) {
    if (job && validCommit(job.commit)) await save({ ...job, phase: 'failed', message: '更新服务执行失败，请联系管理员检查更新日志；现有数据保留。', updatedAt: new Date().toISOString() });
    await rm(join(state, 'request.json'), { force: true });
    throw error;
  } finally {
    await rm(join(state, 'active.json'), { force: true }); await lease.release();
  }
}
async function recover() {
  const job = await readUpdateJob(state);
  if (!updateActive(job)) return;
  const owner = await identity();
  let restored = false;
  try {
    const record = JSON.parse(await readFile(recoveryFile, 'utf8'));
    if (record.job?.id === job!.id && typeof record.previous === 'string' && record.previous.startsWith(releases + '/') && /^sha256:[a-f\d]{64}$/.test(record.previousImage)) {
      await command('systemctl', ['stop', 'picoding.service'], undefined, process.env, 120_000);
      await switchRelease(record.previous); await command('docker', ['tag', record.previousImage, record.image]);
      await command('systemctl', ['start', 'picoding.service']); restored = true;
    }
  } catch { /* Keep all data and backups for administrator recovery. */ }
  await writeUpdateJob(state, { ...job!, phase: 'failed', message: restored ? '更新服务意外中断，已启动原程序；请检查日志后重试。' : '更新服务意外中断，请联系管理员检查服务、日志和备份；现有数据保留。', updatedAt: new Date().toISOString() }, owner);
  await rm(join(state, 'active.json'), { force: true });
}
try {
  if (extra.length || !['setup', 'apply', 'recover'].includes(action)) throw new Error('用法：sudo npm run update -- setup；apply/recover 由服务器更新服务调用');
  if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('更新服务安装和执行需要 Linux root；网页服务仍以 picoding 用户运行');
  if (existsSync('/etc/picoding.env')) process.loadEnvFile('/etc/picoding.env');
  else throw new Error('请先按部署文档创建 /etc/picoding.env 和 picoding.service');
  if (action === 'setup') await setup(); else if (action === 'apply') await apply(); else await recover();
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
