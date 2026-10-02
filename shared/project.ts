import type { GitProjectSource } from './types.js';
import { HttpError, requireString } from '../server/http.js';

export function gitProjectSource(input: unknown): GitProjectSource {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, '请填写 Git 仓库地址');
  const value = input as Record<string, unknown>;
  if (value.type !== 'git') throw new HttpError(400, '项目来源必须是 Git 仓库');
  let url: URL;
  try { url = new URL(requireString(value.url, '仓库地址', 2048).trim()); }
  catch { throw new HttpError(400, '请输入有效的 HTTP 或 HTTPS 仓库地址'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new HttpError(400, '请使用公开仓库的 HTTP 或 HTTPS 地址，不要在地址中填写密钥');
  }
  const branch = value.branch === undefined || value.branch === '' ? undefined : requireString(value.branch, '分支', 200).trim();
  if (branch && (branch.startsWith('-') || /[\s~^:?*[\]\\]/.test(branch) || branch.includes('..') || branch.includes('@{') || branch.includes('//') || branch.startsWith('/') || branch.endsWith('/') || branch.endsWith('.') || branch.split('/').some(part => part.startsWith('.') || part.endsWith('.lock')) || branch === '@')) {
    throw new HttpError(400, '请输入有效的 Git 分支名称');
  }
  return { type: 'git', url: url.href.replace(/\/+$/, ''), ...(branch ? { branch } : {}) };
}

export function uploadPath(input: unknown): string {
  const path = requireString(input, '上传文件路径', 2048);
  if (path.includes('\\') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new HttpError(400, '上传路径必须是项目内的相对路径');
  if (path.split('/').some(part => ['.git', '.picoding', 'node_modules'].includes(part))) throw new HttpError(403, '不上传 .git、.picoding 或 node_modules 中的文件');
  return path;
}
