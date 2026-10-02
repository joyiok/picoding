import { createServer, type IncomingMessage } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, relative, isAbsolute } from 'node:path';
import type { FileWriteOptions, ModelSettingsInput } from '../shared/types.js';
import { allowedOrigins, config } from './config.js';
import { dockerHealth, sandboxApi } from './docker.js';
import { checkOrigin, errorMessage, HttpError, json, readJson, requireString } from './http.js';
import { proxyHttp, proxyUpgrade } from './proxy.js';
import { Workbench } from './workbench.js';

export function checkRequest(request: IncomingMessage) {
  const host = request.headers.host;
  if (![ `127.0.0.1:${config.port}`, `localhost:${config.port}` ].includes(host || '')) throw new HttpError(403, '请通过工作台的本地地址访问');
  checkOrigin(request, allowedOrigins);
}

const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

export function createApp(workbench: Workbench) {
  const webRoot = resolve('dist/web');
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    try {
      checkRequest(request);
      const url = new URL(request.url || '/', `http://127.0.0.1:${config.port}`);
      const method = request.method || 'GET';
      if (url.pathname === '/api/health' && method === 'GET') {
        const settings = workbench.settings.public();
        return json(response, { docker: await dockerHealth(), model: { configured: settings.configured, protocol: settings.protocol, model: settings.model }, version: '0.1.0' });
      }
      if (url.pathname === '/api/settings') {
        if (method === 'GET') return json(response, workbench.settings.public());
        if (method === 'POST') {
          const body = await readJson<ModelSettingsInput>(request);
          workbench.invalidateSessions();
          return json(response, await workbench.settings.update(body));
        }
      }
      if (url.pathname === '/api/tasks') {
        if (method === 'GET') return json(response, workbench.store.list());
        if (method === 'POST') {
          const body = await readJson<{ title?: string; prompt?: string }>(request);
          const prompt = body.prompt === undefined ? undefined : requireString(body.prompt, '任务内容');
          const health = await dockerHealth();
          if (!health.available || !health.imageReady) throw new HttpError(503, health.message);
          if (prompt && !workbench.settings.public().configured) throw new HttpError(409, '请先填写 API 格式、地址、模型 ID 和密钥');
          return json(response, await workbench.create(requireString(body.title || prompt?.slice(0, 40) || '新任务', '任务名称', 120), prompt), 201);
        }
      }
      const match = /^\/api\/tasks\/([a-f\d-]{36})(?:\/(.*))?$/.exec(url.pathname);
      if (match) {
        const [, id, action = ''] = match;
        const task = workbench.store.get(id);
        if (!action && method === 'GET') return json(response, task);
        if (!action && method === 'DELETE') { await workbench.remove(id); return json(response, { ok: true }); }
        if (action === 'events' && method === 'GET') { workbench.events.subscribe(id, response, { type: 'task', task }); return; }
        if (action === 'start' && method === 'POST') { workbench.validateStart(id); void workbench.start(id).catch(error => console.error(errorMessage(error))); return json(response, { ok: true }, 202); }
        if (action === 'stop' && method === 'POST') { await workbench.stop(id); return json(response, { ok: true }); }
        if (action === 'messages' && method === 'POST') {
          const body = await readJson<{ text: string }>(request);
          const text = requireString(body.text, '消息');
          workbench.validateSend(id);
          void workbench.send(id, text).catch(error => console.error(errorMessage(error)));
          return json(response, { ok: true }, 202);
        }
        if (action === 'abort' && method === 'POST') { await workbench.abort(id); return json(response, { ok: true }); }
        if (action === 'takeover' && method === 'POST') { await workbench.abort(id, true); return json(response, { ok: true }); }
        if (action === 'release' && method === 'POST') { await workbench.release(id); return json(response, { ok: true }); }
        if (action === 'files' && method === 'GET') return json(response, await sandboxApi.files(workbench.sandbox(id), url.searchParams.get('path') || ''));
        if (action === 'file' && method === 'GET') return json(response, await sandboxApi.read(workbench.sandbox(id), requireString(url.searchParams.get('path'), '文件路径', 2048)));
        if (action === 'file' && method === 'POST') {
          if (!['ready', 'paused'].includes(task.status)) throw new HttpError(409, '请先停止 agent，再编辑文件');
          const body = await readJson<{ path: string; content: string } & FileWriteOptions>(request, 3_000_000);
          const createOnly = body.createOnly === true;
          if (!createOnly && typeof body.expectedVersion !== 'string') throw new HttpError(400, '保存文件需要原始版本，请重新读取文件');
          const result = await sandboxApi.write(workbench.sandbox(id), requireString(body.path, '文件路径', 2048), body.content, { createOnly, expectedVersion: body.expectedVersion });
          workbench.events.publish(id, { type: 'files_changed' }); return json(response, result);
        }
        if (action === 'command' && method === 'POST') {
          const body = await readJson<{ command: string }>(request);
          return json(response, await workbench.command(id, requireString(body.command, '命令')));
        }
        if (action === 'browser' && method === 'GET') return json(response, await sandboxApi.browser(workbench.sandbox(id)));
        if (action === 'browser' && method === 'POST') {
          if (task.status !== 'paused') throw new HttpError(409, '请先接管浏览器');
          return json(response, await workbench.sandbox(id).request('/browser', await readJson(request)));
        }
        if (action === 'diff' && method === 'GET') return json(response, await workbench.sandbox(id).request('/diff'));
        if ((action === 'archive' || action.startsWith('desktop/')) && method === 'GET') {
          const sandbox = workbench.sandbox(id);
          proxyHttp(request, response, sandbox.url, `/${action}${url.search}`, sandbox.token); return;
        }
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, '接口不存在');
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, '请求方法不支持');
      let file = resolve(webRoot, `.${decodeURIComponent(url.pathname)}`);
      const delta = relative(webRoot, file);
      if (delta.startsWith('..') || isAbsolute(delta)) throw new HttpError(403, '无效路径');
      try { if (!(await stat(file)).isFile()) file = resolve(webRoot, 'index.html'); }
      catch { if (extname(file)) throw new HttpError(404, '文件不存在'); file = resolve(webRoot, 'index.html'); }
      const content = await readFile(file);
      response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      response.end(method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!response.headersSent) json(response, { error: errorMessage(error) }, error instanceof HttpError ? error.status : 500);
      else response.end();
    }
  });
  server.on('upgrade', (request, socket, head) => {
    try {
      checkRequest(request);
      const url = new URL(request.url || '/', 'http://local');
      const match = /^\/api\/tasks\/([a-f\d-]{36})\/desktop\/websockify$/.exec(url.pathname);
      if (!match) throw new HttpError(404, '接口不存在');
      const sandbox = workbench.sandbox(match[1]);
      proxyUpgrade(request, socket, head, sandbox.url, '/desktop/websockify', sandbox.token);
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); }
  });
  return server;
}
