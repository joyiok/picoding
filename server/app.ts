import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, relative, isAbsolute } from 'node:path';
import { maxUploadBytes, type FileWriteOptions, type ModelSettingsInput } from '../shared/types.js';
import { gitProjectSource, uploadPath } from '../shared/project.js';
import { config } from './config.js';
import { dockerHealth, sandboxApi } from './docker.js';
import { errorMessage, HttpError, json, readBytes, readJson, requireString } from './http.js';
import { proxyHttp, proxyUpgrade } from './proxy.js';
import { Workbench } from './workbench.js';
import { TerminalBridge } from './terminal.js';
import { probeModel } from './model-probe.js';
import type { PiPackageAction } from '../shared/resources.js';
import { AccessControl } from './access.js';

const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

export function createApp(workbench: Workbench, access = new AccessControl(config)) {
  const terminals = new TerminalBridge(workbench);
  const webRoot = resolve('dist/web');
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    response.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    try {
      access.checkRequest(request);
      const url = new URL(request.url || '/', `http://127.0.0.1:${config.port}`);
      const method = request.method || 'GET';
      if (url.pathname === '/api/auth' && method === 'GET') return json(response, access.status(request));
      if (url.pathname === '/api/auth/login' && method === 'POST') {
        const body = await readJson<{ password: unknown }>(request, 4096);
        const result = await access.login(request, body.password);
        response.setHeader('Set-Cookie', result.cookie); return json(response, result.status);
      }
      if (url.pathname === '/api/auth/logout' && method === 'POST') {
        response.setHeader('Set-Cookie', access.logout(request)); return json(response, access.status(request));
      }
      if (url.pathname.startsWith('/api/')) { access.require(request); access.protectConnection(request, response, () => response.end()); }
      if (url.pathname === '/api/health' && method === 'GET') {
        const settings = workbench.settings.public();
        return json(response, { docker: await dockerHealth(), model: { configured: settings.configured, protocol: settings.protocol, model: settings.model }, version: '0.1.0' });
      }
      if (url.pathname === '/api/settings') {
        if (method === 'GET') return json(response, workbench.settings.public());
        if (method === 'POST') {
          const body = await readJson<ModelSettingsInput>(request);
          workbench.settings.preview(body);
          workbench.invalidateSessions();
          return json(response, await workbench.settings.update(body));
        }
      }
      if (url.pathname === '/api/settings/test' && method === 'POST') {
        const candidate = workbench.settings.preview(await readJson<ModelSettingsInput>(request));
        const controller = new AbortController();
        const cancel = () => { if (!response.writableEnded) controller.abort(); };
        response.on('close', cancel);
        try { return json(response, await probeModel(candidate, controller.signal)); }
        finally { response.off('close', cancel); }
      }
      if (url.pathname === '/api/resources' && method === 'GET') return json(response, await workbench.resources.catalog());
      if (url.pathname === '/api/resources/reload' && method === 'POST') return json(response, await workbench.reloadResources());
      if (url.pathname === '/api/resources/packages' && method === 'POST') {
        const body = await readJson<{ action: PiPackageAction; source: unknown }>(request);
        return json(response, await workbench.changeResources(body.action, body.source));
      }
      if (url.pathname === '/api/tasks') {
        if (method === 'GET') return json(response, workbench.store.list());
        if (method === 'POST') {
          const body = await readJson<{ title?: string; prompt?: string; source?: unknown }>(request);
          const prompt = body.prompt === undefined ? undefined : requireString(body.prompt, '任务内容');
          const source = body.source === undefined ? undefined : gitProjectSource(body.source);
          const health = await dockerHealth();
          if (!health.available || !health.imageReady) throw new HttpError(503, health.message);
          if (prompt && !workbench.settings.public().configured) throw new HttpError(409, '请先填写 API 格式、地址、模型 ID 和密钥');
          return json(response, await workbench.create(requireString(body.title || prompt?.slice(0, 40) || '新任务', '任务名称', 120), prompt, source), 201);
        }
      }
      const match = /^\/api\/tasks\/([a-f\d-]{36})(?:\/(.*))?$/.exec(url.pathname);
      if (match) {
        const [, id, action = ''] = match;
        const task = workbench.store.get(id);
        if (!action && method === 'GET') return json(response, task);
        if (!action && method === 'PATCH') { const body = await readJson<{ title: string }>(request); return json(response, await workbench.rename(id, body.title)); }
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
          workbench.validateEdit(id);
          const body = await readJson<{ path: string; content: string } & FileWriteOptions>(request, 3_000_000);
          const createOnly = body.createOnly === true;
          if (!createOnly && typeof body.expectedVersion !== 'string') throw new HttpError(400, '保存文件需要原始版本，请重新读取文件');
          const result = await sandboxApi.write(workbench.sandbox(id), requireString(body.path, '文件路径', 2048), body.content, { createOnly, expectedVersion: body.expectedVersion });
          workbench.events.publish(id, { type: 'files_changed' }); return json(response, result);
        }
        if (action === 'upload' && method === 'POST') {
          workbench.validateEdit(id);
          const path = uploadPath(url.searchParams.get('path'));
          const content = await readBytes(request, maxUploadBytes);
          const result = await workbench.sandbox(id).request('/upload', { path, content: content.toString('base64') });
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
      if (error instanceof HttpError && error.status === 429) response.setHeader('Retry-After', '60');
      if (!response.headersSent) json(response, { error: errorMessage(error) }, error instanceof HttpError ? error.status : 500);
      else response.end();
    }
  });
  server.on('upgrade', (request, socket, head) => {
    try {
      access.checkRequest(request); access.require(request);
      access.protectConnection(request, socket, () => socket.destroy());
      const url = new URL(request.url || '/', 'http://local');
      const match = /^\/api\/tasks\/([a-f\d-]{36})\/(desktop\/websockify|terminal)$/.exec(url.pathname);
      if (!match) throw new HttpError(404, '接口不存在');
      if (match[2] === 'terminal') { terminals.upgrade(request, socket, head, match[1]); return; }
      const sandbox = workbench.sandbox(match[1]);
      proxyUpgrade(request, socket, head, sandbox.url, '/desktop/websockify', sandbox.token);
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); }
  });
  server.on('close', () => { access.close(); terminals.close(); });
  return server;
}
