import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function readJson<T = Record<string, unknown>>(request: IncomingMessage, limit = 1_048_576): Promise<T> {
  const data = await readBytes(request, limit);
  try {
    const value = JSON.parse(data.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as T;
  } catch { throw new HttpError(400, '请求必须包含有效的 JSON 对象'); }
}

export async function readBytes(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, '请求内容过大');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }

export function requireString(value: unknown, name: string, max = 50_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `${name}不能为空，且长度不能超过 ${max} 字符`);
  return value;
}

export function checkOrigin(request: IncomingMessage, allowedOrigins: Set<string>) {
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) throw new HttpError(403, '该来源无权访问工作台');
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, '不允许跨站访问工作台');
}
