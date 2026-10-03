import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createAccessCredential } from '../server/access-password.js';

// Actual compiled service and Chromium; only private, fictional credentials and stopped tasks.
const directory = await mkdtemp(join(tmpdir(), 'picoding-password-browser-'));
const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = (reservation.address() as { port: number }).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
const base = `http://127.0.0.1:${port}`;
const original = 'original-browser-fixture-only', replacement = 'replacement-browser-fixture-only';
let child: ChildProcess | undefined, browser: Browser | undefined, output = '';
const pageErrors: string[] = [];
const report = (check: string) => console.log(JSON.stringify({ check, result: 'pass' }));
async function login(page: Page, password: string) {
  await page.locator('#access-password').fill(password); await page.locator('.access-submit').click();
  await page.locator('.access-page').waitFor({ state: 'hidden' });
}
async function capture(page: Page, state: string) {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(viewport);
    await page.locator('.password-settings').waitFor();
    assert.equal(await page.locator('.password-body').evaluate(element => getComputedStyle(element).paddingTop), name === 'mobile' ? '20px' : '24px');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Horizontal overflow');
    assert.equal(await page.locator('.settings-dialog').evaluate(element => element.scrollWidth <= element.clientWidth), true, 'Settings overflow');
    const bounds = await page.locator('.password-settings .primary').boundingBox();
    assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, 'Password action is outside the viewport');
    if (process.env.PICODING_BROWSER_ARTIFACT_DIR) {
      await mkdir(process.env.PICODING_BROWSER_ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.PICODING_BROWSER_ARTIFACT_DIR, `password-${state}-${name}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
try {
  await writeFile(join(directory, 'access.json'), JSON.stringify(await createAccessCredential(original)), { mode: 0o600 });
  await mkdir(join(directory, 'tasks')); const id = randomUUID(), now = new Date().toISOString();
  await writeFile(join(directory, 'tasks', id + '.json'), JSON.stringify({ id, title: '模拟任务：密码修改验证', status: 'stopped', createdAt: now, updatedAt: now, messages: [], tools: [], terminal: [] }), { mode: 0o600 });
  child = spawn(process.execPath, ['dist/server/index.js'], { env: { ...process.env, PICODING_HOST: '127.0.0.1', PICODING_PORT: String(port), PICODING_DATA_DIR: directory, PICODING_PUBLIC_ORIGIN: '', PICODING_ACCESS_PASSWORD: '', PICODING_API_BASE_URL: '', PICODING_MODEL: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream!.on('data', data => { output += data.toString(); });
  const deadline = Date.now() + 10_000;
  while (!output.includes('PiCoding is ready at')) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('Password browser fixture startup failed: ' + output);
    await delay(50);
  }
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
  const current = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const other = await browser.newContext();
  const page = await current.newPage(), otherPage = await other.newPage();
  for (const item of [page, otherPage]) item.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(base); await login(page, original); await otherPage.goto(base); await login(otherPage, original);
  await page.getByRole('button', { name: /模拟任务：密码修改验证/ }).click();
  await page.getByRole('textbox', { name: '向 pi 描述任务' }).fill('模拟草稿：改密码后继续编辑');
  const beforeCookie = (await current.cookies()).find(cookie => cookie.name === 'picoding_session')!.value;
  await page.getByRole('button', { name: '模型设置', exact: true }).last().click();
  await page.locator('#model').fill('unsaved-fixture-model');
  await page.getByRole('button', { name: '访问安全', exact: true }).click();
  await page.locator('#current-password').waitFor();
  for (const id of ['current-password', 'new-password', 'confirm-password']) assert.equal(await page.locator('#' + id).getAttribute('type'), 'password');
  await capture(page, 'empty');
  await page.locator('#current-password').fill('incorrect-fixture-password');
  await page.locator('#new-password').fill(replacement); await page.locator('#confirm-password').fill('mismatched-fixture-password');
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await page.locator('.password-settings [role="alert"]').filter({ hasText: '不一致' }).waitFor();
  assert.equal(await page.locator('#confirm-password').evaluate(element => element === document.activeElement), true);
  await page.locator('#confirm-password').fill(replacement);
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await page.locator('.password-settings [role="alert"]').filter({ hasText: '当前密码不正确' }).waitFor();
  assert.equal(await page.locator('#new-password').inputValue(), replacement);
  assert.equal((await current.cookies()).find(cookie => cookie.name === 'picoding_session')!.value, beforeCookie);
  await capture(page, 'error');
  report('desktop and mobile validation retains failed input and leaves the existing session usable');
  await page.locator('#current-password').fill(original);
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await page.locator('.password-success').waitFor();
  for (const id of ['current-password', 'new-password', 'confirm-password']) assert.equal(await page.locator('#' + id).inputValue(), '');
  const newCookie = (await current.cookies()).find(cookie => cookie.name === 'picoding_session')!.value;
  assert.notEqual(newCookie, beforeCookie);
  assert.equal((await page.request.get(base + '/api/tasks')).status(), 200);
  await capture(page, 'success');
  await page.getByRole('button', { name: '模型和供应商', exact: true }).click();
  assert.equal(await page.locator('#model').inputValue(), 'unsaved-fixture-model');
  await page.getByRole('button', { name: '关闭模型设置', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '向 pi 描述任务' }).inputValue(), '模拟草稿：改密码后继续编辑');
  await page.reload(); await page.locator('.model-button').waitFor();
  assert.equal(await page.locator('.access-page').count(), 0);
  report('password change refreshes the current browser cookie and preserves model and composer drafts');
  assert.equal((await otherPage.request.get(base + '/api/tasks')).status(), 401);
  await otherPage.reload(); await otherPage.locator('#access-password').waitFor();
  await otherPage.locator('#access-password').fill(original); await otherPage.locator('.access-submit').click();
  await otherPage.locator('.access-page [role="alert"]').waitFor();
  await login(otherPage, replacement);
  assert.equal((await otherPage.request.get(base + '/api/tasks')).status(), 200);
  report('the second browser is logged out and only the new password can log in');
  assert.equal((await stat(join(directory, 'access.json'))).mode & 0o777, 0o600);
  const saved = await readFile(join(directory, 'access.json'), 'utf8');
  assert.equal(saved.includes(original) || saved.includes(replacement) || output.includes(original) || output.includes(replacement), false);
  assert.deepEqual(pageErrors, []); report('actual Chromium reports no page errors and persisted credentials contain no plaintext');
} finally {
  await browser?.close();
  if (child && child.exitCode === null) {
    const current = child, exited = new Promise<void>(resolve => current.once('exit', () => resolve()));
    current.kill('SIGTERM'); const timer = setTimeout(() => current.kill('SIGKILL'), 10_000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  await rm(directory, { recursive: true, force: true });
}
