import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { maxUploadBytes, type BrowserAction, type FileWriteOptions, type GitProjectSource } from '../shared/types.js';
import { HttpError, errorMessage, json, readJson, requireString } from '../server/http.js';
import { proxyHttp, proxyUpgrade } from '../server/proxy.js';
import { WorkspaceFiles } from './files.js';
import { executeCommand } from './commands.js';
import { TaskBrowser } from './browser.js';
import { importRepository } from './import.js';
import { TerminalSockets } from './terminal-sockets.js';

const token = process.env.WORKER_TOKEN;
if (!token) throw new Error('WORKER_TOKEN is required. Run this worker inside a PiCoding task container.');
const root = resolve('/workspace');
const files = new WorkspaceFiles(root);
const browser = new TaskBrowser();
const terminal = new TerminalSockets(root);
await mkdir(root, { recursive: true });
await browser.start();
const activeCommands = new Set<AbortController>();

const server = createServer(async (request, response) => {
  try {
    if (request.headers.authorization !== `Bearer ${token}`) throw new HttpError(401, '沙盒访问凭证无效');
    const url = new URL(request.url || '/', 'http://worker');
    if (url.pathname.startsWith('/desktop/')) {
      proxyHttp(request, response, 'http://127.0.0.1:6080', `${url.pathname.slice('/desktop'.length)}${url.search}`);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/health') return json(response, { ok: true });
    if (request.method === 'POST' && url.pathname === '/terminal/release') { await terminal.suspend(); return json(response, { ok: true }); }
    if (request.method === 'GET' && url.pathname === '/files') return json(response, await files.list(url.searchParams.get('path') || ''));
    if (request.method === 'GET' && url.pathname === '/file') return json(response, await files.read(requireString(url.searchParams.get('path'), '文件路径', 2048)));
    if (request.method === 'POST' && url.pathname === '/file') {
      const body = await readJson<{ path: string; content: string } & FileWriteOptions>(request, 3_000_000);
      return json(response, await files.write(requireString(body.path, '文件路径', 2048), body.content, { createOnly: body.createOnly === true, expectedVersion: body.expectedVersion }));
    }
    if (request.method === 'POST' && url.pathname === '/edit') {
      const body = await readJson<{ path: string; oldText: string; newText: string }>(request);
      if (typeof body.oldText !== 'string' || typeof body.newText !== 'string') throw new HttpError(400, '文本必须是字符串');
      return json(response, await files.edit(requireString(body.path, '文件路径', 2048), body.oldText, body.newText));
    }
    if (request.method === 'POST' && url.pathname === '/upload') {
      const body = await readJson<{ path: string; content: string }>(request, Math.ceil(maxUploadBytes * 4 / 3) + 4096);
      if (typeof body.content !== 'string' || body.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.content)) throw new HttpError(400, '上传文件编码无效');
      return json(response, await files.upload(body.path, Buffer.from(body.content, 'base64')));
    }
    if (request.method === 'POST' && url.pathname === '/import') {
      const body = await readJson<GitProjectSource>(request);
      const controller = new AbortController(); activeCommands.add(controller);
      response.on('close', () => { if (!response.writableEnded) controller.abort(); });
      try { return json(response, await importRepository(root, body, controller.signal)); }
      finally { activeCommands.delete(controller); }
    }
    if (request.method === 'GET' && url.pathname === '/browser') return json(response, await browser.state());
    if (request.method === 'POST' && url.pathname === '/browser') return json(response, await browser.action(await readJson<BrowserAction>(request)));
    if (request.method === 'POST' && url.pathname === '/command') {
      const body = await readJson<{ command: string }>(request);
      const controller = new AbortController(); activeCommands.add(controller);
      response.on('close', () => { if (!response.writableEnded) controller.abort(); });
      try { return json(response, await executeCommand(requireString(body.command, '命令'), root, controller.signal)); }
      finally { activeCommands.delete(controller); }
    }
    if (request.method === 'POST' && url.pathname === '/cancel') {
      for (const command of activeCommands) command.abort();
      await browser.idle();
      return json(response, { ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/diff') {
      const result = await executeCommand('git diff --no-ext-diff -- . ":(exclude).picoding/**" ":(exclude)node_modules/**"; while IFS= read -r -d "" file; do git diff --no-ext-diff --no-index -- /dev/null "$file" || true; done < <(git ls-files -z --others --exclude-standard -- . ":(exclude).picoding/**" ":(exclude)node_modules/**")', root);
      return json(response, result);
    }
    if (request.method === 'GET' && url.pathname === '/archive') {
      response.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="project.tar.gz"' });
      const child = spawn('tar', ['--exclude=./.picoding', '--exclude=./node_modules', '--exclude=./.git', '-czf', '-', '-C', root, '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.pipe(response);
      child.on('error', () => response.destroy());
      child.on('exit', code => { if (code) response.destroy(); });
      response.on('close', () => child.kill('SIGTERM'));
      return;
    }
    throw new HttpError(404, '接口不存在');
  } catch (error) {
    if (!response.headersSent) json(response, { error: errorMessage(error) }, error instanceof HttpError ? error.status : 500);
    else response.end();
  }
});

server.on('upgrade', (request, socket, head) => {
  if (request.headers.authorization !== `Bearer ${token}`) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
  const url = new URL(request.url || '/', 'http://worker');
  if (url.pathname === '/terminal') { terminal.upgrade(request, socket, head); return; }
  if (url.pathname !== '/desktop/websockify') { socket.destroy(); return; }
  proxyUpgrade(request, socket, head, 'http://127.0.0.1:6080', '/websockify');
});
server.listen(4311, '0.0.0.0', () => console.log('Sandbox worker ready on 4311'));
let stopping = false;
async function shutdown() {
  if (stopping) return; stopping = true;
  for (const command of activeCommands) command.abort();
  await terminal.close();
  await browser.close(); server.close();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
