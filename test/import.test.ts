import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { importRepository } from '../sandbox/import.js';
import { gitProjectSource, uploadPath } from '../shared/project.js';

const execute = promisify(execFile);

test('project sources reject credentials, local protocols and invalid refs', () => {
  for (const url of ['file:///tmp/repo', 'ssh://git@example.invalid/repo', 'https://user:secret@example.invalid/repo', 'https://example.invalid/repo?token=secret']) {
    assert.throws(() => gitProjectSource({ type: 'git', url }));
  }
  for (const branch of ['-main', '../outside', 'main.lock', 'feature//test', 'bad branch', 'bad[ref', 'a\\b', 'a@{b']) assert.throws(() => gitProjectSource({ type: 'git', url: 'https://example.invalid/repo.git', branch }));
  assert.equal(gitProjectSource({ type: 'git', url: 'https://example.invalid/repo.git/', branch: 'feature/example' }).branch, 'feature/example');
  for (const path of ['/etc/passwd', '../outside', 'src/../app.ts', '.git/config', 'src/node_modules/a.js', '.picoding/browser-profile/Preferences']) assert.throws(() => uploadPath(path));
  assert.equal(uploadPath('src/中文文件.ts'), 'src/中文文件.ts');
});

test('real Git HTTP imports preserve the requested branch, reject collisions and resume without overwriting work', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-import-'));
  const source = join(directory, 'source');
  await mkdir(source);
  const git = (args: string[]) => execute('git', args, { cwd: source });
  await git(['init', '-b', 'main']);
  await writeFile(join(source, 'app.txt'), 'main branch\n');
  await git(['add', '.']);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'main']);
  await git(['checkout', '-b', 'feature/demo']);
  await writeFile(join(source, 'app.txt'), 'feature branch\n');
  await git(['add', '.']);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'feature']);
  await git(['checkout', 'main']);
  await git(['clone', '--bare', source, join(directory, 'project.git')]);
  // A real smart HTTP Git service uses the installed Git CGI backend.
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://local');
    const child = spawn('git', ['http-backend'], { env: {
      ...process.env, GIT_PROJECT_ROOT: directory, GIT_HTTP_EXPORT_ALL: '1',
      REQUEST_METHOD: request.method, PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: request.headers['content-type'], CONTENT_LENGTH: request.headers['content-length'], REMOTE_ADDR: '127.0.0.1',
    }, stdio: ['pipe', 'pipe', 'ignore'] });
    let pending = Buffer.alloc(0); let started = false;
    child.stdout.on('data', (chunk: Buffer) => {
      if (started) { response.write(chunk); return; }
      pending = Buffer.concat([pending, chunk]);
      const end = pending.indexOf('\r\n\r\n'); if (end < 0) return;
      const headers: Record<string, string> = {}; let status = 200;
      for (const line of pending.subarray(0, end).toString().split('\r\n')) {
        const colon = line.indexOf(':'); if (colon < 0) continue;
        const name = line.slice(0, colon).toLowerCase(); const value = line.slice(colon + 1).trim();
        if (name === 'status') status = Number(value.split(' ')[0]); else headers[name] = value;
      }
      response.writeHead(status, headers); response.write(pending.subarray(end + 4)); started = true;
    });
    child.on('close', () => { if (!started) response.writeHead(500); response.end(); });
    child.on('error', () => response.destroy());
    request.pipe(child.stdin);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  const address = server.address() as { port: number };
  const url = 'http://127.0.0.1:' + address.port + '/project.git';
  const workspace = join(directory, 'workspace'); await mkdir(workspace);
  await mkdir(join(workspace, 'downloads'));
  const imported = await importRepository(workspace, { type: 'git', url, branch: 'feature/demo' });
  assert.equal(imported.branch, 'feature/demo'); assert.match(imported.head, /^[a-f0-9]{40}$/);
  assert.equal(await readFile(join(workspace, 'app.txt'), 'utf8'), 'feature branch\n');
  await writeFile(join(workspace, 'app.txt'), 'user work after import');
  assert.deepEqual(await importRepository(workspace, { type: 'git', url, branch: 'feature/demo' }), imported);
  assert.equal(await readFile(join(workspace, 'app.txt'), 'utf8'), 'user work after import');
  await assert.rejects(importRepository(workspace, { type: 'git', url }), /空白工作区/);
  const failed = join(directory, 'failed'); await mkdir(failed);
  await assert.rejects(importRepository(failed, { type: 'git', url, branch: 'missing-branch' }), /仓库导入失败/);
  assert.deepEqual(await readdir(failed), ['.picoding']);
  assert.deepEqual(await readdir(join(failed, '.picoding')), []);
  await importRepository(failed, { type: 'git', url });
  assert.equal(await readFile(join(failed, 'app.txt'), 'utf8'), 'main branch\n');
});
