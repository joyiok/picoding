import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { EventEmitter } from 'node:events';
import { checkOrigin, HttpError } from './http.js';
import { hashAccessPassword, parseAccessCredential, type AccessCredential } from './access-password.js';

const sessionLifetime = 8 * 60 * 60 * 1000;
export interface AccessOptions { host: string; port: number; publicOrigin?: string; password?: string; credential?: AccessCredential; }
export interface AccessStatus { required: boolean; authenticated: boolean; expiresAt?: number; }
interface Session { expiresAt: number; disconnect: Set<() => void>; }

export class AccessControl {
  readonly required: boolean;
  readonly publicOrigin?: string;
  readonly cookieName: string;
  private readonly hosts: Set<string>;
  private readonly origins: Set<string>;
  private readonly salt: Buffer;
  private readonly passwordHash?: Promise<Buffer>;
  private readonly sessions = new Map<string, Session>();
  private attempts = 0;
  private windowStart = 0;
  private checking = 0;

  constructor(options: AccessOptions, private readonly now = Date.now) {
    if (!['127.0.0.1', 'localhost', '0.0.0.0'].includes(options.host)) throw new Error('PICODING_HOST 必须为 127.0.0.1、localhost 或 0.0.0.0');
    if (options.password && (options.password.length < 12 || options.password.length > 256)) throw new Error('PICODING_ACCESS_PASSWORD 必须为 12 到 256 个字符');
    if (options.publicOrigin) {
      let url: URL;
      try { url = new URL(options.publicOrigin); } catch { throw new Error('PICODING_PUBLIC_ORIGIN 必须是有效的 HTTPS 地址'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('PICODING_PUBLIC_ORIGIN 必须是 HTTPS 来源地址，不含路径、凭证或查询参数');
      this.publicOrigin = url.origin;
    }
    const credential = options.password ? undefined : options.credential ? parseAccessCredential(options.credential) : undefined;
    if ((options.host === '0.0.0.0' || this.publicOrigin) && (!this.publicOrigin || (!options.password && !credential))) throw new Error('远程部署必须设置 PICODING_PUBLIC_ORIGIN，并配置访问密码（access init 或 PICODING_ACCESS_PASSWORD）');
    this.required = Boolean(options.password || credential);
    this.salt = credential ? Buffer.from(credential.salt, 'hex') : randomBytes(16);
    this.cookieName = this.publicOrigin ? '__Host-picoding_session' : 'picoding_session';
    this.hosts = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`, ...(this.publicOrigin ? [new URL(this.publicOrigin).host] : [])]);
    this.origins = new Set(this.publicOrigin ? [this.publicOrigin] : [`http://127.0.0.1:${options.port}`, `http://localhost:${options.port}`, 'http://127.0.0.1:5173', 'http://localhost:5173']);
    if (options.password) this.passwordHash = this.hash(options.password);
    else if (credential) this.passwordHash = Promise.resolve(Buffer.from(credential.hash, 'hex'));
  }

  private hash(password: string) { return hashAccessPassword(password, this.salt); }

  checkRequest(request: IncomingMessage) {
    if (!this.hosts.has(request.headers.host || '')) throw new HttpError(403, '请通过工作台配置的地址访问');
    checkOrigin(request, this.origins);
  }

  private token(request: IncomingMessage) {
    const matches = (request.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith(this.cookieName + '='));
    if (matches.length !== 1) return undefined;
    const token = matches[0].slice(this.cookieName.length + 1);
    return /^[a-f\d]{64}$/.test(token) ? token : undefined;
  }

  private session(request: IncomingMessage) {
    const token = this.token(request), session = token ? this.sessions.get(token) : undefined;
    if (token && session && session.expiresAt <= this.now()) { this.revoke(token); return undefined; }
    return session;
  }

  status(request: IncomingMessage): AccessStatus {
    const session = this.session(request);
    return { required: this.required, authenticated: !this.required || Boolean(session), ...(session ? { expiresAt: session.expiresAt } : {}) };
  }

  require(request: IncomingMessage) { if (!this.status(request).authenticated) throw new HttpError(401, '请先登录工作台'); }

  async login(request: IncomingMessage, password: unknown) {
    if (!this.required) throw new HttpError(409, '本地工作台未启用登录');
    if (typeof password !== 'string' || password.length > 256 || !password) throw new HttpError(400, '请输入访问密码');
    const now = this.now();
    if (now - this.windowStart >= 60_000) { this.windowStart = now; this.attempts = 0; }
    if (++this.attempts > 20 || this.checking >= 2) throw new HttpError(429, '登录尝试过于频繁，请一分钟后重试');
    this.checking++;
    try {
      const [expected, actual] = await Promise.all([this.passwordHash!, this.hash(password)]);
      if (!timingSafeEqual(expected, actual)) throw new HttpError(401, '访问密码不正确');
    } finally { this.checking--; }
    for (const [token, session] of this.sessions) if (session.expiresAt <= now) this.revoke(token);
    const previous = this.token(request); if (previous) this.revoke(previous);
    if (this.sessions.size >= 32) this.revoke(this.sessions.keys().next().value!);
    const token = randomBytes(32).toString('hex');
    const expiresAt = this.now() + sessionLifetime;
    this.sessions.set(token, { expiresAt, disconnect: new Set() });
    return { cookie: this.cookie(token, sessionLifetime / 1000), status: { required: true, authenticated: true, expiresAt } satisfies AccessStatus };
  }

  logout(request: IncomingMessage) {
    const token = this.token(request); if (token) this.revoke(token);
    return this.cookie('', 0);
  }

  private cookie(token: string, maxAge: number) { return `${this.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.publicOrigin ? '; Secure' : ''}`; }

  protectConnection(request: IncomingMessage, connection: EventEmitter, disconnect: () => void) {
    if (!this.required) return;
    const session = this.session(request); if (!session) throw new HttpError(401, '请先登录工作台');
    session.disconnect.add(disconnect);
    const timer = setTimeout(disconnect, Math.max(1, session.expiresAt - this.now())); timer.unref();
    connection.once('close', () => { clearTimeout(timer); session.disconnect.delete(disconnect); });
  }

  private revoke(token: string) {
    const session = this.sessions.get(token); this.sessions.delete(token);
    for (const disconnect of session?.disconnect || []) disconnect();
  }

  close() { for (const token of this.sessions.keys()) this.revoke(token); }
}
