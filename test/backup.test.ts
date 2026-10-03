import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile, stat, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { create, extract } from 'tar';
import { backupWorkspace, restoreWorkspace, validateArchive, type BackupVolumes } from '../server/backup.js';
import { acquireDataLease, leaseFile } from '../server/data-lease.js';

// Filesystem volume adapter: real tar and backup logic, explicitly no Docker.
async function setup(t: TestContext, count = 1) {
  const root = await mkdtemp(join(tmpdir(), 'picoding-backup-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const data = join(root, 'data'), destination = join(root, 'backup'), target = join(root, 'restored');
  await mkdir(join(data, 'tasks'), { recursive: true }); await mkdir(join(data, 'pi-sessions'));
  await writeFile(join(data, 'settings.json'), JSON.stringify({ apiKey: 'backup-fixture-key-only' }), { mode: 0o600 });
  await writeFile(join(data, 'pi-sessions', 'fixture.jsonl'), '{"fixture":"conversation history"}\n');
  const workspaces = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const id = randomUUID(), workspace = join(root, 'volume-' + id), now = new Date().toISOString();
    await mkdir(join(workspace, '.picoding', 'browser'), { recursive: true }); await mkdir(join(workspace, '.git'));
    await writeFile(join(workspace, '.picoding', 'browser', 'fixture-profile'), 'Fixture Chromium profile bytes');
    await writeFile(join(workspace, '.git', 'config'), 'fixture git history');
    await writeFile(join(workspace, 'binary.dat'), Buffer.from([0, 255, 1, 128, 13, 10]));
    await symlink('binary.dat', join(workspace, 'relative-link'));
    await writeFile(join(data, 'tasks', id + '.json'), JSON.stringify({ id, title: 'Backup fixture', status: 'stopped', createdAt: now, updatedAt: now, messages: [], tools: [], terminal: [] }));
    workspaces.set(id, workspace);
  }
  let running = false, failId = '';
  const volumes: BackupVolumes = {
    async exists(id) { return workspaces.has(id); },
    async assertStopped() { if (running) throw new Error('Fixture volume is still running'); },
    async export(id, file) { await create({ file, gzip: true, cwd: workspaces.get(id)!, portable: true }, ['.']); },
    async restore(id, file) {
      if (id === failId) throw new Error('Fixture restore failed');
      const directory = join(root, 'restored-volume-' + id); await mkdir(directory); await extract({ file, cwd: directory }); workspaces.set(id, directory);
    },
    async remove(id) { const path = workspaces.get(id)!; workspaces.delete(id); await rm(path, { recursive: true, force: true }); },
  };
  return { root, data, destination, target, volumes, workspaces, setRunning(value: boolean) { running = value; }, failRestore(id: string) { failId = id; } };
}

test('backup and restore preserve settings, pi history, complete project bytes and browser profile', async t => {
  const state = await setup(t), ids = [...state.workspaces.keys()];
  assert.deepEqual(await backupWorkspace(state.data, state.destination, state.volumes), { destination: state.destination, tasks: 1, workspaces: 1 });
  assert.equal((await stat(state.destination)).mode & 0o777, 0o700);
  state.workspaces.clear();
  assert.deepEqual(await restoreWorkspace(state.target, state.destination, state.volumes), { tasks: 1, workspaces: 1 });
  assert.equal(JSON.parse(await readFile(join(state.target, 'settings.json'), 'utf8')).apiKey, 'backup-fixture-key-only');
  assert.equal((await stat(join(state.target, 'settings.json'))).mode & 0o777, 0o600);
  assert.match(await readFile(join(state.target, 'pi-sessions', 'fixture.jsonl'), 'utf8'), /conversation history/);
  const restored = state.workspaces.get(ids[0])!;
  assert.deepEqual(await readFile(join(restored, 'binary.dat')), Buffer.from([0, 255, 1, 128, 13, 10]));
  assert.equal(await readlink(join(restored, 'relative-link')), 'binary.dat');
  assert.match(await readFile(join(restored, '.picoding', 'browser', 'fixture-profile'), 'utf8'), /Chromium profile/);
  assert.equal(await readFile(join(restored, '.git', 'config'), 'utf8'), 'fixture git history');
});

test('backup rejects live service, running volumes, nested destinations and existing backups without deleting data', async t => {
  const state = await setup(t), lease = await acquireDataLease(state.data);
  await assert.rejects(backupWorkspace(state.data, state.destination, state.volumes), /正在使用/); await lease.release();
  state.setRunning(true); await assert.rejects(backupWorkspace(state.data, state.destination, state.volumes), /still running/); state.setRunning(false);
  await assert.rejects(backupWorkspace(state.data, join(state.data, '..nested'), state.volumes), /数据目录外/);
  await assert.rejects(backupWorkspace(state.data, join(state.root, 'missing-parent', 'backup'), state.volumes), /ENOENT/);
  const next = await acquireDataLease(state.data); await next.release();
  await backupWorkspace(state.data, state.destination, state.volumes);
  const before = await readFile(join(state.destination, 'manifest.json'));
  await assert.rejects(backupWorkspace(state.data, state.destination, state.volumes), /EEXIST/);
  assert.deepEqual(await readFile(join(state.destination, 'manifest.json')), before);
});

test('restore refuses occupied data or existing project volumes without replacing either', async t => {
  const state = await setup(t); await backupWorkspace(state.data, state.destination, state.volumes);
  await assert.rejects(restoreWorkspace(state.data, state.destination, state.volumes), /必须为空/);
  await assert.rejects(restoreWorkspace(state.target, state.destination, state.volumes), /同名项目卷/);
  assert.match(await readFile(join(state.data, 'settings.json'), 'utf8'), /backup-fixture-key-only/);
  assert.deepEqual(await readdir(state.target), [leaseFile]);
});

test('checksum or archive path failures happen before any project volume is restored', async t => {
  const state = await setup(t); await backupWorkspace(state.data, state.destination, state.volumes); state.workspaces.clear();
  const control = join(state.destination, 'control.tar.gz'); await writeFile(control, 'corrupted fixture bytes');
  await assert.rejects(restoreWorkspace(state.target, state.destination, state.volumes), /完整性/);
  assert.equal(state.workspaces.size, 0); assert.deepEqual(await readdir(state.target), [leaseFile]);
  const bad = join(state.root, 'traversal.tar.gz');
  await create({ file: bad, gzip: true, cwd: state.data, prefix: '../outside', preservePaths: true }, ['settings.json']);
  await assert.rejects(validateArchive(bad), /越界/);
});

test('failed restore removes only volumes created by that restore and leaves the target empty', async t => {
  const state = await setup(t, 2); await backupWorkspace(state.data, state.destination, state.volumes);
  const manifest = JSON.parse(await readFile(join(state.destination, 'manifest.json'), 'utf8')); state.workspaces.clear(); state.failRestore(manifest.tasks[1].id);
  await assert.rejects(restoreWorkspace(state.target, state.destination, state.volumes), /Fixture restore failed/);
  assert.equal(state.workspaces.size, 0); assert.deepEqual(await readdir(state.target), [leaseFile]);
});

test('a valid checksum does not bypass archive traversal or escaping-link checks', async t => {
  const state = await setup(t); await backupWorkspace(state.data, state.destination, state.volumes); state.workspaces.clear();
  await symlink('/etc/passwd', join(state.data, 'outside-link'));
  const control = join(state.destination, 'control.tar.gz'); await create({ file: control, gzip: true, cwd: state.data, portable: true }, ['outside-link']);
  const manifestPath = join(state.destination, 'manifest.json'), metadata = JSON.parse(await readFile(manifestPath, 'utf8'));
  metadata.controlSha256 = createHash('sha256').update(await readFile(control)).digest('hex'); await writeFile(manifestPath, JSON.stringify(metadata));
  await assert.rejects(restoreWorkspace(state.target, state.destination, state.volumes), /目录外的链接/);
  assert.equal(state.workspaces.size, 0); assert.deepEqual(await readdir(state.target), [leaseFile]);
});
