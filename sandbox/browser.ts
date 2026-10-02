import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserAction, BrowserState } from '../shared/types.js';
import { HttpError } from '../server/http.js';

export async function selectForegroundPage<T>(pages: T[], inspect: (page: T) => Promise<{ focused: boolean; visible: boolean }>, previous?: T): Promise<T | undefined> {
  const states = await Promise.all(pages.map(async page => {
    try { return { page, ...await inspect(page) }; } catch { return { page, focused: false, visible: false }; }
  }));
  return states.find(state => state.focused)?.page || states.find(state => state.visible)?.page || (previous && pages.includes(previous) ? previous : pages[0]);
}

export class TaskBrowser {
  private context?: BrowserContext;
  private active?: Page;
  private operations: Promise<unknown> = Promise.resolve();

  async start() {
    const profile = '/workspace/.picoding/browser';
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    const proxy = proxyUrl ? new URL(proxyUrl) : undefined;
    // A task volume outlives its container. Chromium's process locks point to
    // the previous container and must be discarded before its sole browser starts.
    await Promise.all(['SingletonLock', 'SingletonSocket', 'SingletonCookie'].map(name => rm(join(profile, name), { force: true })));
    this.context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      headless: false, viewport: null, acceptDownloads: true,
      // The worker owns shutdown. Playwright's default signal handler plus
      // context.close() would close twice and force-kill the profile writer.
      handleSIGTERM: false, handleSIGINT: false, handleSIGHUP: false,
      downloadsPath: '/workspace/downloads',
      ...(proxy ? { proxy: { server: proxy.protocol + '//' + proxy.host, username: decodeURIComponent(proxy.username), password: decodeURIComponent(proxy.password), bypass: 'localhost,127.0.0.1,[::1]' } } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--start-maximized', '--window-size=1280,800'],
    });
    this.context.setDefaultTimeout(12_000);
    this.active = this.context.pages()[0] || await this.context.newPage();
    this.context.on('page', page => { this.active = page; });
  }

  private page() {
    if (!this.context) throw new HttpError(503, '浏览器尚未启动');
    if (!this.active || this.active.isClosed()) this.active = this.context.pages().find(page => !page.isClosed());
    if (!this.active) throw new HttpError(409, '浏览器没有打开的标签页，请先打开网页');
    return this.active;
  }

  private async syncForeground() {
    if (!this.context) throw new HttpError(503, '浏览器尚未启动');
    this.active = await selectForegroundPage(this.context.pages().filter(page => !page.isClosed()), page => page.evaluate(() => ({ focused: document.hasFocus(), visible: document.visibilityState === 'visible' })), this.active);
  }

  async state(): Promise<BrowserState> {
    await this.syncForeground();
    const page = this.page();
    return {
      url: page.url(), title: await page.title(),
      tabs: await Promise.all(this.context!.pages().map(async (tab, id) => ({ id, url: tab.url(), title: await tab.title() }))),
    };
  }

  action(input: BrowserAction) {
    const operation = this.operations.catch(() => {}).then(() => this.perform(input));
    this.operations = operation;
    return operation;
  }

  async idle() { await this.operations.catch(() => {}); }

  private async perform(input: BrowserAction) {
    await this.syncForeground();
    if (input.action === 'navigate') {
      let url: URL;
      try { url = new URL(input.url); } catch { throw new HttpError(400, '请输入完整的网址，例如 http://localhost:3000'); }
      if (!['http:', 'https:'].includes(url.protocol)) throw new HttpError(400, '浏览器只能打开 HTTP 或 HTTPS 网页');
      if (!this.active || this.active.isClosed()) this.active = await this.context!.newPage();
      await this.active.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } else if (input.action === 'click') await this.page().locator(input.selector).first().click();
    else if (input.action === 'fill') await this.page().locator(input.selector).first().fill(input.text);
    else if (input.action === 'press') await this.page().keyboard.press(input.key);
    else if (input.action === 'scroll') await this.page().mouse.wheel(0, input.direction === 'down' ? 650 : -650);
    else if (input.action === 'reload') await this.page().reload({ waitUntil: 'domcontentloaded' });
    else if (input.action === 'back') await this.page().goBack({ waitUntil: 'domcontentloaded' });
    else if (input.action === 'tab') {
      const page = this.context?.pages()[input.index];
      if (!page) throw new HttpError(404, '标签页不存在');
      this.active = page; await page.bringToFront();
    } else if (input.action !== 'snapshot') throw new HttpError(400, '未知的浏览器操作');
    const snapshot = (await this.page().locator('body').ariaSnapshot()).slice(0, 24_000);
    const screenshot = (await this.page().screenshot({ type: 'jpeg', quality: 65 })).toString('base64');
    return { ...await this.state(), snapshot, screenshot };
  }

  async close() { await this.context?.close(); }
}
