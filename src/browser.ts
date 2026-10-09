import { chromium, type BrowserContext, type Page, type Frame, type Locator } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { allowedUrl, portalOrigin, portalUrl } from './config.js';
import type { Credentials } from './vault.js';

export interface Control { ref: string; tag: string; type: string; label: string; value?: string; href?: string; options?: { label: string; value: string }[] }
export interface FrameView { index: number; text: string; controls: Control[]; tables: string[][][]; loginRequired: boolean }
export interface View { snapshotId: string; url: string; title: string; frames: FrameView[]; loginRequired: boolean; loading: boolean }
export interface Field { ref: string; value: string }
interface Target { frame: Frame; locator: Locator; control: Control }

export class BrowserSession {
  private context?: BrowserContext;
  private active?: Page;
  private generation?: string;
  private refs = new Map<string, Target>();
  private lastView?: View;
  private readonly dismissDialog = (dialog: import('playwright').Dialog) => { void dialog.dismiss().catch(() => {}); };
  constructor(private profile: string, private baseUrl = portalUrl, private origin = portalOrigin, private headless = false) {}

  private validateUrl(value: string): string {
    if (this.origin === portalOrigin) return allowedUrl(value);
    const result = new URL(value, this.baseUrl);
    if (result.origin !== this.origin) throw new Error('Unsupported origin.');
    return result.href;
  }
  invalidate(): void { this.generation = undefined; this.refs.clear(); }
  async ensure(): Promise<Page> {
    if (!this.context) {
      await mkdir(this.profile, { recursive: true });
      const options = { headless: this.headless, viewport: null, acceptDownloads: false };
      // Use an installed browser first, then the Playwright-managed Chromium fallback.
      for (const channel of ['msedge', 'chrome', undefined]) {
        try { this.context = await chromium.launchPersistentContext(this.profile, { ...options, ...(channel ? { channel } : {}) }); break; }
        catch (error) { if (!channel) throw new Error('Cannot launch the browser. Close other eTRiS MCP instances, or run: npx playwright install chromium', { cause: error }); }
      }
      this.context!.on('close', () => { this.context = undefined; this.active = undefined; this.invalidate(); });
      const observe = (page: Page) => {
        page.on('framenavigated', () => this.invalidate());
        page.on('dialog', this.dismissDialog);
        page.on('popup', popup => { this.active = popup; this.invalidate(); });
      };
      this.context!.pages().forEach(observe);
      this.context!.on('page', observe);
      await this.context!.route('**/*', async route => {
        const request = route.request();
        if (request.isNavigationRequest()) {
          const url = new URL(request.url());
          const local = url.hostname === '127.0.0.1' && url.protocol === 'http:';
          if (url.origin !== this.origin && !local) return route.abort();
        }
        await route.continue();
      });
    }
    if (!this.active || this.active.isClosed() || new URL(this.active.url() === 'about:blank' ? this.baseUrl : this.active.url()).origin !== this.origin) {
      this.active = this.context!.pages().find(page => !page.isClosed() && page.url().startsWith(this.origin)) ?? await this.context!.newPage();
    }
    return this.active;
  }
  async openLogin(): Promise<{ status: string }> {
    const page = await this.ensure();
    if (!page.url().startsWith(this.origin)) await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.bringToFront();
    return { status: 'browser_open', };
  }
  async openLocal(url: string): Promise<Page> {
    await this.ensure();
    const page = await this.context!.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    return page;
  }
  async fillLogin(credentials: Credentials): Promise<void> {
    const page = await this.ensure();
    if (!page.url().startsWith(this.baseUrl)) await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="j_username"]').fill(credentials.username);
    await page.locator('input[name="j_password"]').fill(credentials.password);
    this.invalidate();
    await page.bringToFront();
  }
  async signIn(credentials: Credentials): Promise<{ status: string; message: string }> {
    await this.fillLogin(credentials);
    if (credentials.autoSignIn === false) return { status: 'saved_login_filled', message: 'Your saved credentials are filled. Click Login in the eTRiS window.' };
    const page = await this.ensure();
    // This selector was observed on the official unauthenticated eTRiS login page.
    await page.locator('input[name="btnSubmit"]').click({ timeout: 15000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    this.invalidate();
    await page.bringToFront();
    return { status: 'login_submitted', message: 'Saved credentials were filled and Login was clicked. Check the eTRiS window for success or verification. If login fails, update credentials locally; automatic retries are disabled.' };
  }
  async navigate(url: string): Promise<View> {
    const target = this.validateUrl(url);
    const page = await this.ensure();
    this.invalidate();
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
    return this.snapshot();
  }
  async snapshot(): Promise<View> {
    const page = await this.ensure();
    if (page.url() === 'about:blank') await this.openLogin();
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    this.validateUrl(page.url());
    const id = randomUUID();
    this.refs.clear();
    const frames: FrameView[] = [];
    let index = 0;
    for (const frame of page.frames()) {
      if (frame.url() !== 'about:blank' && !frame.url().startsWith(this.origin)) continue;
      const frameIndex = index++;
      const view = await frame.evaluate(({ prefix }) => {
        const visible = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
        const passwordPage = [...document.querySelectorAll('input[type="password"]')].some(visible);
        if (passwordPage) return { text: 'Login page. Enter credentials in the local browser; login fields are hidden from the model.', controls: [], tables: [], loginRequired: true };
        const nodes = [...document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="tab"],[role="menuitem"]')].filter(visible);
        const controls = nodes.slice(0, 400).flatMap((element, n) => {
          const input = element as HTMLInputElement;
          const type = input.type ?? '';
          if (['hidden', 'password'].includes(type) || /password|passwd|j_username|secret|token/i.test([input.name, input.id, input.autocomplete].join(' '))) return [];
          const ref = `${prefix}-${n}`;
          element.setAttribute('data-etric-ref', ref);
          const label = (element.getAttribute('aria-label') || input.labels?.[0]?.innerText || element.getAttribute('title') || element.getAttribute('placeholder') || ((type === 'button' || type === 'submit') ? input.value : '') || (element as HTMLElement).innerText || input.name || element.id || element.tagName).trim().slice(0, 300);
          const options = element instanceof HTMLSelectElement ? [...element.options].map(option => ({ label: option.text, value: option.value })).slice(0, 100) : undefined;
          return [{ ref, tag: element.tagName.toLowerCase(), type, label, ...(['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) ? { value: input.value } : {}), ...(element instanceof HTMLAnchorElement ? { href: element.getAttribute('href') ?? '' } : {}), ...(options ? { options } : {}) }];
        });
        const text = (document.body?.innerText ?? '').slice(0, 20000);
        const tables = [...document.querySelectorAll('table')].filter(visible).slice(0, 10).map(table => [...table.rows].slice(0, 100).map(row => [...row.cells].map(cell => cell.innerText.trim().slice(0, 1000))));
        return { text, controls, tables, loginRequired: false };
      }, { prefix: `f${frameIndex}-${id}` });
      frames.push({ index: frameIndex, ...view });
      for (const control of view.controls) this.refs.set(control.ref, { frame, locator: frame.locator(`[data-etric-ref="${control.ref}"]`), control });
    }
    this.generation = id;
    const loginRequired = frames.some(frame => frame.loginRequired) || /\/login\.jsp(?:[;?]|$)/i.test(page.url());
    const title = await page.title();
    this.lastView = { snapshotId: id, url: page.url().split('?')[0].replace(/;jsessionid=[^/;?]+/ig, ''), title, frames, loginRequired, loading: !title.trim() && frames.every(frame => !frame.text.trim()) };
    return this.lastView;
  }
  cachedView(snapshotId: string): View {
    if (this.generation !== snapshotId || this.lastView?.snapshotId !== snapshotId) throw new Error('Page references are stale. Inspect the page again.');
    return this.lastView;
  }
  private async target(snapshotId: string, ref: string): Promise<Target> {
    if (snapshotId !== this.generation) throw new Error('Page references are stale. Call etric_page again.');
    const target = this.refs.get(ref);
    if (!target) throw new Error('Unknown reference. Use a reference from the latest etric_page result.');
    if (!await target.locator.isVisible() || await target.locator.count() !== 1) throw new Error('The selected control has changed. Inspect the page again.');
    return target;
  }
  async control(snapshotId: string, ref: string): Promise<Control> { return (await this.target(snapshotId, ref)).control; }
  async fill(snapshotId: string, fields: Field[]): Promise<View> {
    const targets = await Promise.all(fields.map(async field => ({ ...field, target: await this.target(snapshotId, field.ref) })));
    for (const { target } of targets) {
      if (!['input', 'textarea', 'select'].includes(target.control.tag) || ['button', 'submit', 'file', 'hidden', 'password'].includes(target.control.type)) throw new Error('Only editable, non-credential form fields can be filled.');
    }
    this.invalidate();
    for (const { value, target } of targets) {
      if (target.control.tag === 'select') await target.locator.selectOption(value);
      else if (['checkbox', 'radio'].includes(target.control.type)) await target.locator.setChecked(value === 'true');
      else await target.locator.fill(value);
    }
    return this.snapshot();
  }
  async click(snapshotId: string, ref: string, acceptDialog = false): Promise<View> {
    const { locator } = await this.target(snapshotId, ref);
    this.invalidate();
    const page = await this.ensure();
    // Most dialogs are dismissed. A locally approved write may accept its single confirm dialog.
    const accept = (dialog: import('playwright').Dialog) => { if (dialog.type() === 'confirm') void dialog.accept().catch(() => {}); else void dialog.dismiss().catch(() => {}); };
    if (acceptDialog) {
      page.off('dialog', this.dismissDialog); page.on('dialog', accept);
    }
    try {
      await locator.click({ timeout: 15000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      return await this.snapshot();
    } finally {
      if (acceptDialog) { page.off('dialog', accept); page.on('dialog', this.dismissDialog); }
    }
  }
  async clearSession(): Promise<void> {
    await this.close();
    const { rm } = await import('node:fs/promises');
    const { resolve, parse } = await import('node:path');
    const target = resolve(this.profile);
    if (target === parse(target).root || !target.endsWith('browser')) throw new Error('Refusing to clear an unexpected browser profile path.');
    // This explicitly named app profile is the sole deletion target, following local review.
    await rm(target, { recursive: true, force: true });
  }
  async close(): Promise<void> { await this.context?.close(); }
}
