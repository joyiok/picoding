import { randomBytes, scrypt } from 'node:crypto';
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireDataLease } from './data-lease.js';

export interface AccessCredential { version: 1; algorithm: 'scrypt'; salt: string; hash: string; }
export const accessCredentialFile = 'access.json';

export function validateAccessPassword(password: string) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('访问密码必须为 12 到 256 个字符');
}

export function hashAccessPassword(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32, { N: 32768, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}

export function parseAccessCredential(value: unknown): AccessCredential {
  if (!value || typeof value !== 'object') throw new Error('访问密码文件无效，请停止服务后使用 access reset 重新设置');
  const credential = value as Partial<AccessCredential>;
  if (credential.version !== 1 || credential.algorithm !== 'scrypt' || typeof credential.salt !== 'string' || !/^[a-f\d]{32}$/.test(credential.salt) || typeof credential.hash !== 'string' || !/^[a-f\d]{64}$/.test(credential.hash)) throw new Error('访问密码文件无效，请停止服务后使用 access reset 重新设置');
  return { version: 1, algorithm: 'scrypt', salt: credential.salt, hash: credential.hash };
}

export async function createAccessCredential(password: string): Promise<AccessCredential> {
  validateAccessPassword(password);
  const salt = randomBytes(16), hash = await hashAccessPassword(password, salt);
  return { version: 1, algorithm: 'scrypt', salt: salt.toString('hex'), hash: hash.toString('hex') };
}

export async function loadAccessCredential(directory: string): Promise<AccessCredential | undefined> {
  let text: string;
  try { text = await readFile(join(directory, accessCredentialFile), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error('访问密码文件无效，请停止服务后使用 access reset 重新设置'); }
  return parseAccessCredential(value);
}

// The running service already owns the data lease. Offline commands still acquire it below.
export async function replaceAccessCredential(directory: string, credential: AccessCredential, expected: AccessCredential) {
  const current = await loadAccessCredential(directory);
  if (!current || current.salt !== expected.salt || current.hash !== expected.hash) throw new Error('访问密码文件已变化，请联系管理员检查或重启工作台');
  const file = join(directory, accessCredentialFile), temporary = file + '.' + randomBytes(8).toString('hex') + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(parseAccessCredential(credential)) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

// CLI password rotation is offline and shares the service's data lock.
export async function saveAccessPassword(directory: string, password: string, replace = false) {
  validateAccessPassword(password);
  const lease = await acquireDataLease(directory);
  const file = join(directory, accessCredentialFile), temporary = file + '.' + randomBytes(8).toString('hex') + '.tmp';
  try {
    const credential = await createAccessCredential(password);
    lease.check();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporary, JSON.stringify(credential) + '\n', { mode: 0o600, flag: 'wx' });
    lease.check();
    if (replace) await rename(temporary, file);
    else {
      try { await link(temporary, file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('访问密码已初始化；重置请使用 npm run access -- reset，并先停止服务'); throw error; }
    }
  } finally { try { await rm(temporary, { force: true }); } finally { await lease.release(); } }
}
