import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type Page } from 'playwright-core';

// Real compiled server and browser with private stopped-task fixtures.
// No Docker task or external model is exercised by this browser check.
const directory = await mkdtemp(join(tmpdir(), 'picoding-browser-'));
const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = (reservation.address() as { port: number }).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
const base = `http://127.0.0.1:${port}`, password = 'browser-fixture-password-only';
let child: ChildProcess | undefined, browser: Browser | undefined, output = '';
const pageErrors: string[] = [];
const report = (check: string) => console.log(JSON.stringify({ check, result: 'pass' }));
async function login(page: Page) {
  await page.locator('#access-password').waitFor({ state: 'visible' });
  await page.locator('#access-password').fill(password); await page.locator('.access-submit').click();
  await page.locator('.access-page').waitFor({ state: 'hidden' });
}
async function layout(page: Page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Horizontal page overflow');
}
try {
  await mkdir(join(directory, 'tasks'));
  const now = new Date().toISOString();
  for (const title of ['模拟任务 Alpha', '模拟任务 Beta']) {
    const id = randomUUID();
    await writeFile(join(directory, 'tasks', id + '.json'), JSON.stringify({ id, title, status: 'stopped', createdAt: now, updatedAt: now, messages: [], tools: [], terminal: [] }), { mode: 0o600 });
  }
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ protocol: 'openai', baseUrl: 'https://model.example.invalid/v1', model: 'browser-fixture', apiKey: 'fictional-browser-key', contextWindow: 128000, maxTokens: 16384, supportsImages: false }), { mode: 0o600 });
  child = spawn(process.execPath, ['dist/server/index.js'], { env: { ...process.env, PICODING_HOST: '127.0.0.1', PICODING_PORT: String(port), PICODING_DATA_DIR: directory, PICODING_PUBLIC_ORIGIN: '', PICODING_ACCESS_PASSWORD: password, OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream!.on('data', data => { output = (output + data.toString()).slice(-10000); });
  const deadline = Date.now() + 10000;
  while (!output.includes('PiCoding is ready at')) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('Browser fixture startup failed: ' + output);
    await delay(50);
  }
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await desktop.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(base); await login(page);
  await page.getByRole('button', { name: /模拟任务 Alpha/ }).click();
  const composer = page.getByRole('textbox', { name: '向 pi 描述任务' });
  await composer.fill('模拟草稿：刷新和登录后继续填写');
  const search = page.getByRole('searchbox', { name: '搜索任务' });
  await search.fill('beta'); await page.getByRole('button', { name: /模拟任务 Beta/ }).waitFor();
  assert.equal(await page.locator('.task-nav-item').count(), 1); assert.equal(await composer.inputValue(), '模拟草稿：刷新和登录后继续填写');
  await page.getByRole('button', { name: '清空任务搜索' }).click();
  await page.getByRole('button', { name: '重命名任务' }).click(); await page.locator('#task-new-name').fill('模拟任务：已整理');
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await page.getByRole('button', { name: /模拟任务：已整理/ }).waitFor();
  await page.reload(); await page.getByRole('button', { name: /模拟任务：已整理/ }).waitFor();
  assert.equal(await composer.inputValue(), '模拟草稿：刷新和登录后继续填写');
  await layout(page); report('desktop search, rename and draft persistence against compiled APIs');
  await page.locator('.model-button').click(); await page.locator('#model').fill('unsaved-browser-fixture');
  const logout = await page.request.post(base + '/api/auth/logout', { data: {}, headers: { Origin: base } }); assert.equal(logout.status(), 200);
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.locator('#access-password').waitFor({ state: 'visible' }); assert.equal(await page.locator('dialog[open]').count(), 0);
  await login(page); await page.locator('dialog[open] #model').waitFor(); assert.equal(await page.locator('#model').inputValue(), 'unsaved-browser-fixture');
  await page.getByRole('button', { name: '关闭模型设置', exact: true }).click();
  assert.equal(await composer.inputValue(), '模拟草稿：刷新和登录后继续填写');
  report('real modal releases login and restores unsaved settings and message draft');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), phone = await mobile.newPage();
  phone.on('pageerror', error => pageErrors.push(error.message));
  await phone.goto(base); await login(phone);
  await phone.getByRole('button', { name: '打开任务列表' }).click();
  await phone.getByRole('searchbox', { name: '搜索任务' }).fill('beta');
  await phone.getByRole('button', { name: /模拟任务 Beta/ }).click(); await phone.getByRole('button', { name: '打开任务列表' }).waitFor();
  await phone.getByRole('button', { name: '重命名任务' }).click(); await phone.locator('#task-new-name').fill('模拟手机任务');
  await phone.getByRole('button', { name: '保存名称', exact: true }).click(); await phone.locator('.task-name-dialog').waitFor({ state: 'detached' });
  assert.match(await phone.locator('.header-title').innerText(), /模拟手机任务/); await layout(phone);
  await phone.getByRole('button', { name: '打开任务列表' }).click(); await phone.getByRole('button', { name: '清空任务搜索' }).click();
  await phone.getByRole('button', { name: '退出登录' }).click(); await phone.locator('#access-password').waitFor({ state: 'visible' });
  await login(phone); await phone.getByRole('button', { name: '关闭任务列表' }).click(); await layout(phone);
  assert.deepEqual(pageErrors, []); assert.equal(output.includes(password), false);
  report('mobile navigation, rename, login recovery and page layout without uncaught errors');
} finally {
  await browser?.close();
  if (child?.exitCode === null && child.signalCode === null) {
    const current = child, exited = new Promise<void>(resolve => current.once('exit', () => resolve())); current.kill('SIGTERM');
    const timer = setTimeout(() => current.kill('SIGKILL'), 10000);
    try { await exited; assert.equal(current.exitCode, 0, output); } finally { clearTimeout(timer); }
  }
  await rm(directory, { recursive: true, force: true });
}
