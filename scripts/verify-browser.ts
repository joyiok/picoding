import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type Page } from 'playwright-core';
import type { PublicSettings } from '../shared/types.js';
import type { UpdateStatus } from '../shared/updates.js';
import { textReply } from '../test/provider.js';

// Real compiled server and browser with private stopped-task fixtures.
// No Docker task or external model is exercised by this browser check.
const directory = await mkdtemp(join(tmpdir(), 'picoding-browser-'));
const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = (reservation.address() as { port: number }).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
const base = `http://127.0.0.1:${port}`, password = 'browser-fixture-password-only';
let child: ChildProcess | undefined, browser: Browser | undefined, output = '';
const pageErrors: string[] = [];
const modelRequests: { path?: string; model: string; key?: string }[] = [];
const modelFixture = createServer(async (request, response) => {
  const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const protocol = request.url?.startsWith('/second') ? 'anthropic' : 'openai';
  modelRequests.push({ path: request.url, model: body.model, key: String(protocol === 'openai' ? request.headers.authorization : request.headers['x-api-key']) });
  textReply(response, protocol, body.model);
});
const report = (check: string) => console.log(JSON.stringify({ check, result: 'pass' }));
async function login(page: Page) {
  await page.locator('#access-password').waitFor({ state: 'visible' });
  await page.locator('#access-password').fill(password); await page.locator('.access-submit').click();
  await page.locator('.access-page').waitFor({ state: 'hidden' });
}
async function layout(page: Page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Horizontal page overflow');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.settings-dialog[open], .model-menu')].every(element => element.scrollWidth <= element.clientWidth)), true, 'Model controls overflow');
}
async function capture(page: Page, name: string) {
  if (!process.env.PICODING_BROWSER_ARTIFACT_DIR) return;
  await mkdir(process.env.PICODING_BROWSER_ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.PICODING_BROWSER_ARTIFACT_DIR, name + '.png') });
}
async function updateInterface(page: Page, prefix: string) {
  await page.locator('.model-button').click(); await page.getByRole('button', { name: '模型设置', exact: true }).last().click();
  await page.getByRole('button', { name: '系统更新', exact: true }).click();
  await page.locator('.update-help').waitFor();
  assert.match(await page.locator('.update-help').innerText(), /尚未启用/);
  assert.equal(await page.locator('.update-actions .primary').isDisabled(), true);
  // Browser-only update fixtures: never invoke a privileged updater or alter this installation.
  const sha = 'b'.repeat(40);
  let status: UpdateStatus = { current: { version: '0.1.0', commit: 'a'.repeat(40), dirty: false }, latest: { commit: sha, title: '模拟更新：新增工作台功能', date: '2026-10-04T00:00:00Z', url: 'https://github.com/joyiok/picoding/commit/' + sha }, available: true, enabled: true, checkedAt: new Date().toISOString() };
  await page.route('**/api/updates**', async route => {
    if (new URL(route.request().url()).pathname === '/api/updates/install') {
      assert.deepEqual(route.request().postDataJSON(), { commit: sha });
      status = { ...status, job: { id: 'browser-fixture', commit: sha, phase: 'preparing', message: '模拟进度：正在构建新版本', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } };
    }
    await route.fulfill({ status: route.request().url().endsWith('/install') ? 202 : 200, json: status });
  });
  await page.getByRole('button', { name: '检查更新', exact: true }).click(); await page.locator('.update-release').waitFor();
  await layout(page); await capture(page, prefix + '-updates');
  await page.getByRole('button', { name: '立即更新', exact: true }).click(); await page.locator('.update-confirm').waitFor();
  assert.equal(await page.locator('.update-confirm').evaluate(element => element === document.activeElement), true);
  assert.equal(await page.locator('.update-confirm').getAttribute('aria-labelledby'), 'updates-confirm-warning');
  await page.getByRole('button', { name: '暂不更新', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '立即更新', exact: true }).evaluate(element => element === document.activeElement), true);
  await page.getByRole('button', { name: '立即更新', exact: true }).press('Enter'); await page.locator('.update-confirm').waitFor();
  assert.equal(await page.locator('.update-confirm').evaluate(element => element === document.activeElement), true);
  await layout(page); await capture(page, prefix + '-updates-confirm');
  await page.getByRole('button', { name: '确认更新', exact: true }).click(); await page.locator('.update-progress').waitFor();
  assert.equal(await page.locator('.update-actions .primary').isDisabled(), true);
  await layout(page); await capture(page, prefix + '-updates-progress');
  status = { ...status, job: { ...status.job!, phase: 'failed', message: '模拟更新失败，原程序已恢复。可检查网络后重试。' } };
  await page.getByRole('button', { name: '关闭模型设置', exact: true }).click();
  await page.locator('.model-button').click(); await page.getByRole('button', { name: '模型设置', exact: true }).last().click();
  await page.getByRole('button', { name: '系统更新', exact: true }).click(); await page.locator('.update-failed').waitFor();
  await layout(page); await capture(page, prefix + '-updates-failed');
  assert.equal(await page.getByRole('button', { name: '重试更新', exact: true }).isDisabled(), false);
  await page.getByRole('button', { name: '关闭模型设置', exact: true }).click(); await page.unroute('**/api/updates**');
}
try {
  await new Promise<void>(resolve => modelFixture.listen(0, '127.0.0.1', resolve));
  const modelBase = `http://127.0.0.1:${(modelFixture.address() as { port: number }).port}`;
  await mkdir(join(directory, 'tasks'));
  const now = new Date().toISOString();
  for (const title of ['模拟任务 Alpha', '模拟任务 Beta']) {
    const id = randomUUID();
    await writeFile(join(directory, 'tasks', id + '.json'), JSON.stringify({ id, title, status: 'stopped', createdAt: now, updatedAt: now, messages: [], tools: [], terminal: [] }), { mode: 0o600 });
  }
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ protocol: 'openai', baseUrl: modelBase + '/first/v1', model: 'browser-fixture', apiKey: 'fictional-browser-key', contextWindow: 128000, maxTokens: 16384, supportsImages: false }), { mode: 0o600 });
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
  await page.getByRole('button', { name: '模型设置', exact: true }).click(); await page.locator('#model').fill('unsaved-browser-fixture');
  const logout = await page.request.post(base + '/api/auth/logout', { data: {}, headers: { Origin: base } }); assert.equal(logout.status(), 200);
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.locator('#access-password').waitFor({ state: 'visible' }); assert.equal(await page.locator('dialog[open]').count(), 0);
  await login(page); await page.locator('dialog[open] #model').waitFor(); assert.equal(await page.locator('#model').inputValue(), 'unsaved-browser-fixture');
  await page.getByRole('button', { name: '关闭模型设置', exact: true }).click();
  assert.equal(await composer.inputValue(), '模拟草稿：刷新和登录后继续填写');
  report('real modal releases login and restores unsaved settings and message draft');
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.locator('#provider-name').fill('协议测试甲'); await page.locator('#saved-model').selectOption('');
  await page.locator('#model').fill('browser-alternate-fixture'); await page.locator('#context-window').fill('32768'); await page.locator('#max-tokens').fill('4096'); await page.locator('#supports-images').check();
  await page.getByRole('button', { name: '测试连接', exact: true }).click(); await page.locator('.connection-succeeded').waitFor();
  assert.equal((await (await page.request.get(base + '/api/settings')).json()).model, 'browser-fixture');
  await page.getByRole('button', { name: '保存设置', exact: true }).click(); await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '模型设置', exact: true }).click(); await page.locator('#saved-provider').selectOption('');
  await page.locator('#provider-name').fill('协议测试乙'); await page.locator('#protocol').selectOption('anthropic');
  await page.locator('#base-url').fill(modelBase + '/second'); await page.locator('#model').fill('browser-anthropic-fixture'); await page.locator('#api-key').fill('fictional-anthropic-key');
  await page.getByRole('button', { name: '测试连接', exact: true }).click(); await page.locator('.connection-succeeded').waitFor();
  await page.getByRole('button', { name: '保存设置', exact: true }).click(); await page.locator('.settings-dialog').waitFor({ state: 'detached' });
  const catalog = await (await page.request.get(base + '/api/settings')).json() as PublicSettings;
  assert.equal(catalog.providers.length, 2); assert.equal(catalog.providers[0].models.length, 2);
  assert.equal(JSON.stringify(catalog).includes('fictional-browser-key'), false); assert.equal(JSON.stringify(catalog).includes('fictional-anthropic-key'), false);
  await page.locator('.model-button').click(); await page.locator('.model-menu select').nth(0).selectOption(catalog.providers[0].id); await page.locator('.model-menu select').nth(1).selectOption(catalog.providers[0].models[0].id);
  await page.getByRole('button', { name: '使用此模型', exact: true }).click(); await page.locator('.model-menu').waitFor({ state: 'detached' });
  assert.match(await page.locator('.model-button').innerText(), /协议测试甲.*browser-fixture/); assert.equal(await composer.inputValue(), '模拟草稿：刷新和登录后继续填写');
  await page.reload(); await page.locator('.model-button').filter({ hasText: 'browser-fixture' }).waitFor();
  await page.locator('.model-button').click(); await layout(page); await capture(page, 'desktop-model-switch');
  await page.getByRole('button', { name: '模型设置', exact: true }).last().click(); await layout(page); await capture(page, 'desktop-model-settings');
  await page.getByRole('button', { name: '关闭模型设置', exact: true }).click();
  assert.deepEqual(modelRequests.map(request => request.key), ['Bearer fictional-browser-key', 'fictional-anthropic-key']);
  assert.deepEqual(modelRequests.map(request => request.model), ['browser-alternate-fixture', 'browser-anthropic-fixture']);
  report('saved supplier/model management, both local SDK probes, quick switching and reload persistence');
  await updateInterface(page, 'desktop');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), phone = await mobile.newPage();
  phone.on('pageerror', error => pageErrors.push(error.message));
  await phone.goto(base); await login(phone);
  await phone.getByRole('button', { name: '打开任务列表' }).click();
  await phone.getByRole('searchbox', { name: '搜索任务' }).fill('beta');
  await phone.getByRole('button', { name: /模拟任务 Beta/ }).click(); await phone.getByRole('button', { name: '打开任务列表' }).waitFor();
  await phone.getByRole('button', { name: '重命名任务' }).click(); await phone.locator('#task-new-name').fill('模拟手机任务');
  await phone.getByRole('button', { name: '保存名称', exact: true }).click(); await phone.locator('.task-name-dialog').waitFor({ state: 'detached' });
  assert.match(await phone.locator('.header-title').innerText(), /模拟手机任务/); await layout(phone);
  await phone.locator('.model-button').click(); await layout(phone); await capture(phone, 'mobile-model-switch');
  await phone.locator('.model-menu select').nth(1).selectOption(catalog.providers[0].models[1].id);
  await phone.getByRole('button', { name: '使用此模型', exact: true }).click(); await phone.locator('.model-menu').waitFor({ state: 'detached' });
  await phone.locator('.model-button').click(); await phone.getByRole('button', { name: '模型设置', exact: true }).last().click();
  assert.equal(await phone.locator('#max-tokens').inputValue(), '4096'); assert.equal(await phone.locator('#supports-images').isChecked(), true);
  await layout(phone); await capture(phone, 'mobile-model-settings'); await phone.getByRole('button', { name: '关闭模型设置', exact: true }).click();
  await phone.getByRole('button', { name: '打开任务列表' }).click(); await phone.getByRole('button', { name: '清空任务搜索' }).click();
  await phone.getByRole('button', { name: '退出登录' }).click(); await phone.locator('#access-password').waitFor({ state: 'visible' });
  await login(phone); await phone.locator('.drawer-close').click(); await layout(phone);
  await updateInterface(phone, 'mobile');
  assert.deepEqual(pageErrors, []); assert.equal(output.includes(password), false);
  report('mobile navigation, rename, login recovery and page layout without uncaught errors');
  report('desktop/mobile system update checks, confirmation, pinned target, progress and retry with labeled browser-only fixtures');
} finally {
  await browser?.close();
  modelFixture.closeAllConnections(); modelFixture.close();
  if (child?.exitCode === null && child.signalCode === null) {
    const current = child, exited = new Promise<void>(resolve => current.once('exit', () => resolve())); current.kill('SIGTERM');
    const timer = setTimeout(() => current.kill('SIGKILL'), 10000);
    try { await exited; assert.equal(current.exitCode, 0, output); } finally { clearTimeout(timer); }
  }
  await rm(directory, { recursive: true, force: true });
}
