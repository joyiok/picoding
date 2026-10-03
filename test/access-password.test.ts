import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { AccessControl } from '../server/access.js';
import { accessCredentialFile, createAccessCredential, loadAccessCredential, saveAccessPassword } from '../server/access-password.js';
import { acquireDataLease } from '../server/data-lease.js';

const password = 'credential-fixture-password-only';
const options = { host: '127.0.0.1', port: 4310 };
const request = (cookie?: string) => ({ headers: { host: '127.0.0.1:4310', ...(cookie ? { cookie } : {}) } }) as IncomingMessage;

test('persistent credentials enable login without storing a plaintext password and preserve login across restarts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-password-')); t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal(await loadAccessCredential(directory), undefined);
  await saveAccessPassword(directory, password);
  const serialized = await readFile(join(directory, accessCredentialFile), 'utf8');
  assert.equal(serialized.includes(password), false); assert.equal((await stat(join(directory, accessCredentialFile))).mode & 0o777, 0o600);
  const credential = await loadAccessCredential(directory);
  const access = new AccessControl({ ...options, credential }); t.after(() => access.close());
  assert.deepEqual(access.status(request()), { required: true, authenticated: false });
  await assert.rejects(access.login(request(), 'incorrect-password'), { status: 401 });
  const login = await access.login(request(), password), cookie = login.cookie.split(';')[0];
  assert.equal(access.status(request(cookie)).authenticated, true);
  const restarted = new AccessControl({ ...options, credential: await loadAccessCredential(directory) }); t.after(() => restarted.close());
  assert.equal(restarted.status(request(cookie)).authenticated, false);
  assert.equal((await restarted.login(request(), password)).status.authenticated, true);
});

test('password initialization never overwrites an existing password and rotation rejects old passwords and sessions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-password-')); t.after(() => rm(directory, { recursive: true, force: true }));
  await saveAccessPassword(directory, password);
  const before = await readFile(join(directory, accessCredentialFile), 'utf8');
  await assert.rejects(saveAccessPassword(directory, 'different-fixture-password'), /已初始化/);
  assert.equal(await readFile(join(directory, accessCredentialFile), 'utf8'), before);
  const original = new AccessControl({ ...options, credential: await loadAccessCredential(directory) }); t.after(() => original.close());
  const oldCookie = (await original.login(request(), password)).cookie.split(';')[0];
  await saveAccessPassword(directory, 'different-fixture-password', true);
  const replacement = new AccessControl({ ...options, credential: await loadAccessCredential(directory) }); t.after(() => replacement.close());
  await assert.rejects(replacement.login(request(), password), { status: 401 });
  assert.equal(replacement.status(request(oldCookie)).authenticated, false);
  assert.equal((await replacement.login(request(), 'different-fixture-password')).status.authenticated, true);
  assert.equal((await stat(join(directory, accessCredentialFile))).mode & 0o777, 0o600);
  assert.equal((await readdir(directory)).some(file => file.endsWith('.tmp')), false);
});

test('password management cannot mutate credentials while the service holds its data lock', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-password-')); t.after(() => rm(directory, { recursive: true, force: true }));
  await saveAccessPassword(directory, password);
  const before = await readFile(join(directory, accessCredentialFile), 'utf8');
  const lease = await acquireDataLease(directory);
  try { await assert.rejects(saveAccessPassword(directory, 'different-fixture-password', true), /正在使用/); }
  finally { await lease.release(); }
  assert.equal(await readFile(join(directory, accessCredentialFile), 'utf8'), before);
});

test('corrupt credentials fail closed without exposing stored data and can be replaced offline', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'picoding-password-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, accessCredentialFile);
  for (const invalid of ['private-corrupt-fixture', 'null', '{"version":2}', '{"version":1,"algorithm":"scrypt","salt":"bad","hash":"private-corrupt-fixture"}']) {
    await writeFile(file, invalid);
    await assert.rejects(loadAccessCredential(directory), error => { assert.ok(error instanceof Error); assert.match(error.message, /密码文件无效/); assert.equal(error.message.includes('private-corrupt-fixture'), false); return true; });
  }
  await saveAccessPassword(directory, password, true); assert.ok(await loadAccessCredential(directory));
  for (const invalid of ['', 'short', 'x'.repeat(257)]) await assert.rejects(saveAccessPassword(directory, invalid, true), /12 到 256/);
});

test('remote protection accepts a stored credential and an explicit environment password takes precedence', async () => {
  const credential = await createAccessCredential(password);
  const access = new AccessControl({ ...options, host: '0.0.0.0', publicOrigin: 'https://workbench.invalid', credential });
  assert.equal(access.required, true); assert.match((await access.login(request(), password)).cookie, /Secure$/); access.close();
  assert.throws(() => new AccessControl({ ...options, host: '0.0.0.0', credential }), /PICODING_PUBLIC_ORIGIN/);
  const override = new AccessControl({ ...options, credential, password: 'environment-fixture-password' });
  await assert.rejects(override.login(request(), password), { status: 401 });
  assert.equal((await override.login(request(), 'environment-fixture-password')).status.authenticated, true); override.close();
});
