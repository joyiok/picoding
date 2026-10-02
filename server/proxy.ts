import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { errorMessage } from './http.js';

export function proxyHttp(request: IncomingMessage, response: ServerResponse, target: string, path: string, token?: string) {
  const url = new URL(path, target);
  // noVNC's Python HTTP server closes each asset response. Avoid reusing a
  // socket during that close, which can interrupt the next module request.
  const headers = { ...request.headers, host: url.host, connection: 'close' };
  if (token) headers.authorization = `Bearer ${token}`;
  const upstream = httpRequest(url, { method: request.method, headers, agent: false }, incoming => {
    response.writeHead(incoming.statusCode || 502, { ...incoming.headers, 'Cache-Control': 'no-store' });
    incoming.pipe(response);
  });
  upstream.setTimeout(120_000, () => upstream.destroy(new Error('沙盒响应超时')));
  upstream.on('error', error => {
    if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'application/json' });
    if (!response.writableEnded) response.end(JSON.stringify({ error: errorMessage(error) }));
  });
  response.on('close', () => { if (!response.writableEnded) upstream.destroy(); });
  request.pipe(upstream);
}

export function proxyUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, target: string, path: string, token?: string) {
  const url = new URL(path, target);
  const headers = { ...request.headers, host: url.host };
  if (token) headers.authorization = `Bearer ${token}`;
  const upstream = httpRequest(url, { headers });
  upstream.on('upgrade', (response, remote, remoteHead) => {
    const lines = [`HTTP/1.1 ${response.statusCode} ${response.statusMessage}`];
    for (const [key, value] of Object.entries(response.headers)) if (value) lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (remoteHead.length) socket.write(remoteHead);
    if (head.length) remote.write(head);
    socket.pipe(remote).pipe(socket);
    remote.on('error', () => socket.destroy());
    socket.on('error', () => remote.destroy());
    socket.on('close', () => remote.destroy());
    remote.on('close', () => socket.destroy());
  });
  upstream.on('response', response => { socket.end(`HTTP/1.1 ${response.statusCode || 502} Bad Gateway\r\n\r\n`); response.destroy(); });
  upstream.on('error', () => socket.destroy());
  socket.on('close', () => upstream.destroy());
  upstream.end();
}
