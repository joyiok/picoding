import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceFiles } from '../sandbox/files.js';
import { executeCommand } from '../sandbox/commands.js';
import { maxUploadBytes } from '../shared/types.js';

test('uploads preserve binary bytes and refuse existing files, reserved paths and oversize content', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-upload-'));
  const outside = await mkdtemp(join(tmpdir(), 'picoding-upload-outside-'));
  t.after(() => Promise.all([rm(directory, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  const files = new WorkspaceFiles(directory); const content = Buffer.from([0, 255, 128, 1, 2, 3]);
  await files.upload('assets/data.bin', content);
  assert.deepEqual(await readFile(join(directory, 'assets/data.bin')), content);
  await assert.rejects(files.upload('assets/data.bin', Buffer.from('replacement')), /同名文件已存在/);
  assert.deepEqual(await readFile(join(directory, 'assets/data.bin')), content);
  await assert.rejects(files.upload('.git/config', content), /不上传/);
  await assert.rejects(files.upload('../escape.bin', content), /相对路径/);
  await symlink(outside, join(directory, 'outside'));
  await assert.rejects(files.upload('outside/secret.bin', content), /超出了项目目录/);
  await assert.rejects(files.upload('too-large.bin', Buffer.alloc(maxUploadBytes + 1)), /10 MB/);
  await files.upload('empty.txt', Buffer.alloc(0));
  assert.equal((await readFile(join(directory, 'empty.txt'))).length, 0);
});

test('workspace paths reject traversal and symlinks escaping the project', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-files-'));
  const outside = await mkdtemp(join(tmpdir(), 'picoding-outside-'));
  t.after(() => Promise.all([rm(directory, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  const files = new WorkspaceFiles(directory);
  await writeFile(join(outside, 'secret.txt'), 'outside');
  await symlink(outside, join(directory, 'escape'));
  await assert.rejects(files.read('../secret.txt'), /超出了项目目录/);
  await assert.rejects(files.read(join(outside, 'secret.txt')), /超出了项目目录/);
  await assert.rejects(files.read('escape/secret.txt'), /超出了项目目录/);
  await assert.rejects(files.write('escape/nested/file.txt', 'bad'), /超出了项目目录/);
  assert.deepEqual(await files.list(), []);
});

test('edits refuse ambiguous or stale text and preserve unrelated content', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-edit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = new WorkspaceFiles(directory);
  await files.write('src/app.ts', 'first\nrepeated\nrepeated\nlast\n');
  await assert.rejects(files.edit('src/app.ts', 'repeated', 'next'), /出现多次/);
  await assert.rejects(files.edit('src/app.ts', 'missing', 'next'), /没有找到/);
  await files.edit('src/app.ts', 'first\n', 'changed\n');
  assert.equal((await files.read('src/app.ts')).content, 'changed\nrepeated\nrepeated\nlast\n');
});

test('file viewer rejects binary and oversized files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-limit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = new WorkspaceFiles(directory);
  await writeFile(join(directory, 'binary.dat'), Buffer.from([0, 1, 2]));
  await writeFile(join(directory, 'large.txt'), 'x'.repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(files.read('binary.dat'), /二进制/);
  await assert.rejects(files.read('large.txt'), /超过 2 MB/);
});

test('exclusive file creation and version checks preserve existing and external edits', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-conflicts-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = new WorkspaceFiles(directory);
  await files.write('app.ts', 'original', { createOnly: true });
  const original = await files.read('app.ts');
  await assert.rejects(files.write('app.ts', '', { createOnly: true }), /已存在/);
  await files.write('app.ts', 'pi changed this');
  await assert.rejects(files.write('app.ts', 'stale draft', { expectedVersion: original.version }), /发生变化/);
  assert.equal((await files.read('app.ts')).content, 'pi changed this');
  const current = await files.read('app.ts');
  const results = await Promise.allSettled([
    files.write('app.ts', 'first saved', { expectedVersion: current.version }),
    files.write('app.ts', 'second stale save', { expectedVersion: current.version }),
  ]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.equal((await files.read('app.ts')).content, 'first saved');
});

test('command cancellation ends the process group without exposing the worker token', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-command-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const previous = process.env.WORKER_TOKEN;
  process.env.WORKER_TOKEN = 'worker-test-token';
  t.after(() => { if (previous === undefined) delete process.env.WORKER_TOKEN; else process.env.WORKER_TOKEN = previous; });
  const result = await executeCommand('printf "%s" "${WORKER_TOKEN-unset}"', directory);
  assert.equal(result.output, 'unset');
  const controller = new AbortController();
  const command = executeCommand('sleep 30 & wait', directory, controller.signal);
  const timer = setTimeout(() => controller.abort(), 120);
  t.after(() => clearTimeout(timer));
  const aborted = await command;
  assert.equal(aborted.exitCode, null);
  assert.match(aborted.output, /操作已取消/);
});
