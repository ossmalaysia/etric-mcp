import { chromium, type BrowserContext, type Page, type Frame, type Locator } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { allowedUrl, portalOrigin, portalUrl } from './config.js';
import type { Credentials } from './vault.js';
import { safeNavigationUrl, redactNavigationText, selectSection, programmeReadUrl, type MenuEntry } from './navigation.js';

export interface Control { ref: string; tag: string; type: string; label: string; id?: string; name?: string; href?: string; navigationUrl?: string; onclick?: string; activation?: 'click' | 'double_click'; value?: string; options?: { label: string; value: string }[] }
export interface FrameView { index: number; url?: string; name?: string; visible?: boolean; text: string; controls: Control[]; tables: string[][][]; loginRequired: boolean }
export interface View { snapshotId: string; url: string; title: string; frames: FrameView[]; loginRequired: boolean; sessionExpired?: boolean; loading: boolean; dismissedDialogs?: string[]; popupWindows?: { index: number; title: string; url?: string }[] }
export interface Field { ref: string; value: string }
interface Target { frame: Frame; locator: Locator; control: Control }

export class BrowserSession {
  private context?: BrowserContext;
  private active?: Page;
  private generation?: string;
  private refs = new Map<string, Target>();
  private lastView?: View;
  private capturedMenus: MenuEntry[] = [];
  private popupPages: Page[] = [];
  private authenticating = false;
  private dismissedDialogs: string[] = [];
  private readonly dismissDialog = (dialog: import('playwright').Dialog) => {
    this.dismissedDialogs.push(`${dialog.type()} dismissed`);
    this.dismissedDialogs = this.dismissedDialogs.slice(-10);
    void dialog.dismiss().catch(() => {});
  };
  constructor(private profile: string, private baseUrl = portalUrl, private origin = portalOrigin, private headless = false, private localOrigin?: string) {}
  get mode(): 'background' | 'visible' { return this.headless ? 'background' : 'visible'; }
  async setVisibility(visible: boolean): Promise<object> {
    const headless = !visible;
    if (this.headless === headless) return { mode: this.mode };
    const current = this.active;
    const hadContext = !!this.context;
    const activeUrl = current?.url().startsWith(this.origin) ? current.url() : this.baseUrl;
    const appFrame = current ? await this.applicationFrame(current) : undefined;
    const appUrl = appFrame?.url().startsWith(this.origin) ? appFrame.url() : undefined;
    // Keep session cookies only in memory during the browser restart.
    const cookies = await this.context?.cookies();
    const drafts = current ? await Promise.all(current.frames().filter(frame => frame.url().startsWith(this.origin)).map(async frame => ({ name: frame.name(), application: frame === appFrame, fields: await frame.evaluate(() => {
      if (document.querySelector('input[type="password"]')) return [];
      return [...document.querySelectorAll('input,select,textarea')].filter(element => {
        const input = element as HTMLInputElement;
        return element.getClientRects().length > 0 && !['hidden', 'password', 'file', 'button', 'submit'].includes(input.type) && !/password|passwd|token|csrf|secret|username/i.test(input.name + input.id) && !!(element.id || input.name);
      }).map(element => {
        const input = element as HTMLInputElement;
        return { selector: element.id ? '#' + CSS.escape(element.id) : element.tagName.toLowerCase() + '[name="' + CSS.escape(input.name) + '"]', type: input.type, tag: element.tagName.toLowerCase(), value: input.value, checked: input.checked };
      });
    }).catch(() => []) }))) : [];
    await this.close();
    this.headless = headless;
    if (hadContext) {
      const page = await this.ensure();
      if (cookies?.length) await this.context!.addCookies(cookies);
      await page.goto(activeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (appUrl && !/\/login\.jsp(?:[;?]|$)/i.test(page.url())) {
        const applications = page.locator('#application');
        if (await applications.count()) {
          await applications.click();
          const frame = await this.waitForApplicationFrame();
          await frame.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        }
      }
      for (const draft of drafts) {
        const frame = draft.application ? await this.applicationFrame(page) : page.frames().find(frame => frame.name() === draft.name);
        if (!frame) continue;
        for (const field of draft.fields) {
          const locator = frame.locator(field.selector);
          if (await locator.count() !== 1 || !await locator.isVisible()) continue;
          if (field.tag === 'select') await locator.selectOption(field.value);
          else if (['checkbox', 'radio'].includes(field.type)) await locator.setChecked(field.checked);
          else await locator.fill(field.value);
        }
      }
    }
    return { mode: this.mode, message: 'Browser mode changed. Page references must be refreshed.' };
  }

  private validateUrl(value: string): string {
    if (this.origin === portalOrigin) return allowedUrl(value);
    const result = new URL(value, this.baseUrl);
    if (result.origin !== this.origin) throw new Error('Unsupported origin.');
    return result.href;
  }
  invalidate(): void { this.generation = undefined; this.refs.clear(); }
  async ensure(): Promise<Page> {
    if (!this.context) {
      await mkdir(this.profile, { recursive: true, mode: 0o700 });
      const options = { headless: this.headless, viewport: null, acceptDownloads: false };
      // Use an installed browser first, then the Playwright-managed Chromium fallback.
      for (const channel of ['msedge', 'chrome', undefined]) {
        try { this.context = await chromium.launchPersistentContext(this.profile, { ...options, ...(channel ? { channel } : {}) }); break; }
        catch (error) { if (!channel) throw new Error('Cannot launch the browser. Close other eTRiS MCP instances, or run: npx playwright install chromium', { cause: error }); }
      }
      this.context!.on('close', () => { this.context = undefined; this.active = undefined; this.popupPages = []; this.invalidate(); });
      const observe = (page: Page) => {
        page.on('framenavigated', () => this.invalidate());
        page.on('dialog', this.dismissDialog);
        page.on('popup', popup => { if (!this.authenticating) this.popupPages.push(popup); this.active = popup; this.invalidate(); });
      };
      this.context!.pages().forEach(observe);
      this.context!.on('page', observe);
      await this.context!.route('**/*', async route => {
        const request = route.request();
        if (request.isNavigationRequest()) {
          const url = new URL(request.url());
          if (url.origin !== this.origin && url.origin !== this.localOrigin) return route.abort();
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
    const target = new URL(url);
    if (target.username || target.password || (target.origin !== this.origin && target.origin !== this.localOrigin)) throw new Error('Unsupported local form origin.');
    if (this.headless) await this.setVisibility(true);
    await this.ensure();
    const page = await this.context!.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    return page;
  }
  async fillLogin(credentials: Credentials): Promise<void> {
    this.capturedMenus = [];
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
    this.authenticating = true;
    try {
      await page.locator('input[name="btnSubmit"]').click({ timeout: 15000 });
      for (let attempt = 0; attempt < 40; attempt++) {
        const destination = this.active && !this.active.isClosed() ? this.active : page;
        if (destination.url() !== 'about:blank') {
          await destination.waitForLoadState('domcontentloaded', { timeout: 1000 }).catch(() => {});
          const passwordVisible = await destination.locator('input[name="j_password"]').isVisible().catch(() => true);
          const contentReady = await destination.locator('body').innerText({ timeout: 1000 }).then(text => !!text.trim()).catch(() => false);
          if (destination.url().startsWith(this.origin) && !/\/login\.jsp(?:[;?]|$)/i.test(destination.url()) && !passwordVisible && contentReady) {
            this.invalidate();
            await destination.bringToFront();
            return { status: 'login_submitted', message: 'Saved credentials were filled and Login was clicked. Inspect the session status for success or verification. Automatic retries are disabled on failure.' };
          }
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      return { status: 'login_needs_attention', message: 'Login has not reached a ready workspace. Show the browser to check credentials or complete verification. Automatic retries are disabled.' };
    } finally { this.authenticating = false; }
  }
  async navigate(url: string): Promise<View> {
    const target = this.validateUrl(url);
    const page = await this.ensure();
    this.invalidate();
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
    return this.snapshot();
  }
  async snapshot(): Promise<View> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.snapshotOnce(); }
      catch (error) {
        if (attempt >= 10 || !(error instanceof Error) || !/Execution context was destroyed|Frame was detached|navigation/i.test(error.message)) throw error;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
  }
  private async snapshotOnce(): Promise<View> {
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
      const owner = frame.parentFrame() ? await frame.frameElement().catch(() => undefined) : undefined;
      const visibleFrame = owner ? await owner.isVisible().catch(() => false) : true;
      const frameInfo = { index: frameIndex, url: safeNavigationUrl(frame.url(), this.baseUrl), name: frame.name(), visible: visibleFrame };
      if (!visibleFrame) { frames.push({ ...frameInfo, text: '', controls: [], tables: [], loginRequired: false }); continue; }
      const view = await frame.evaluate(({ prefix }) => {
        const visible = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
        const passwordPage = [...document.querySelectorAll('input[type="password"]')].some(visible);
        if (passwordPage) return { text: 'Login page. Enter credentials in the local browser; login fields are hidden from the model.', controls: [], tables: [], loginRequired: true };
        const interactive = (element: Element) => element.matches('a,button,input,select,textarea,[role="button"],[role="tab"],[role="menuitem"],[role="link"],[role="treeitem"],[onclick],[ondblclick],[onmousedown],[onmouseup],area,summary,img[alt]') || (element instanceof HTMLElement && (element.onclick !== null || element.ondblclick !== null || element.onmousedown !== null || element.onmouseup !== null)) || ['pointer', 'hand'].includes(getComputedStyle(element).cursor);
        const candidates = [...document.querySelectorAll('body *')].filter(element => visible(element) && interactive(element) && !element.closest('script,style,noscript,template'));
        // Pointer cursors inherit into every child. Keep the actionable parent
        // rather than repeating its image, span, and label as separate controls.
        const nodes = candidates.filter(element => !element.parentElement || !candidates.includes(element.parentElement) || element.matches('a,button,input,select,textarea,[onclick],[ondblclick],[onmousedown],[onmouseup]'));
        const controls = nodes.slice(0, 400).flatMap((element, n) => {
          const input = element as HTMLInputElement;
          const type = input.type ?? '';
          if (['hidden', 'password'].includes(type) || /password|passwd|j_username|secret|token/i.test([input.name, input.id, input.autocomplete].join(' '))) return [];
          const ref = `${prefix}-${n}`;
          element.setAttribute('data-etric-ref', ref);
          const label = (element.getAttribute('aria-label') || input.labels?.[0]?.innerText || ((type === 'button' || type === 'submit') ? input.value : '') || (element as HTMLElement).innerText?.trim() || element.getAttribute('alt') || element.getAttribute('title') || element.getAttribute('placeholder') || input.name || element.id || element.tagName).trim().slice(0, 300);
          const options = element instanceof HTMLSelectElement ? [...element.options].map(option => ({ label: option.text, value: option.value })).slice(0, 100) : undefined;
          const jquery = (window as unknown as { jQuery?: { _data?: (element: Element, key: string) => Record<string, unknown> | undefined } }).jQuery;
          const events = jquery?._data?.(element, 'events');
          const activation = (element.hasAttribute('ondblclick') || (element instanceof HTMLElement && element.ondblclick !== null) || (!!events?.dblclick && !events?.click)) ? 'double_click' as const : 'click' as const;
          return [{ ref, tag: element.tagName.toLowerCase(), type, label, activation, ...(element.id ? { id: element.id } : {}), ...(input.name ? { name: input.name } : {}), ...(['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) ? { value: input.value } : {}), ...(element.hasAttribute('href') ? { href: element.getAttribute('href') ?? '' } : {}), ...(element.hasAttribute('onclick') ? { onclick: element.getAttribute('onclick')!.slice(0, 1500) } : {}), ...(options ? { options } : {}) }];
        });
        const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
        const parts: string[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement;
          if (parent && !parent.closest('script,style,noscript,template') && visible(parent) && node.textContent?.trim()) parts.push(node.textContent.trim());
        }
        const text = parts.join('\n').slice(0, 20000);
        const tables = [...document.querySelectorAll('table')].filter(visible).slice(0, 10).map(table => [...table.rows].slice(0, 100).map(row => [...row.cells].map(cell => cell.innerText.trim().slice(0, 1000))));
        return { text, controls, tables, loginRequired: false };
      }, { prefix: `f${frameIndex}-${id}` });
      for (const control of view.controls) {
        if (control.href) { control.href = redactNavigationText(control.href); Object.assign(control, { navigationUrl: safeNavigationUrl(control.href, frame.url() === 'about:blank' ? this.baseUrl : frame.url()) }); }
        if (control.onclick) control.onclick = redactNavigationText(control.onclick);
      }
      frames.push({ ...frameInfo, ...view });
      for (const control of view.controls) this.refs.set(control.ref, { frame, locator: frame.locator(`[data-etric-ref="${control.ref}"]`), control });
    }
    this.generation = id;
    const sessionExpired = frames.some(frame => /\bsession\s+(?:has\s+)?expired\b/i.test(frame.text));
    const loginRequired = sessionExpired || frames.some(frame => frame.loginRequired) || /\/login\.jsp(?:[;?]|$)/i.test(page.url());
    if (loginRequired) this.capturedMenus = [];
    const title = await page.title();
    // Login opens the real workspace in a new window. It is not a notice.
    const protectedPages = await Promise.all(this.popupPages.map(async popup => !popup.isClosed() && (new URL(popup.url(), this.baseUrl).searchParams.get('actionFlag') === 'doLogin' || await popup.locator('#application').count() > 0)));
    this.popupPages = this.popupPages.filter((popup, index) => !popup.isClosed() && !protectedPages[index]);
    this.lastView = { snapshotId: id, url: page.url().split('?')[0].replace(/;jsessionid=[^/;?]+/ig, ''), title, frames, loginRequired, sessionExpired, loading: !title.trim() && frames.every(frame => !frame.text.trim()), dismissedDialogs: [...this.dismissedDialogs], popupWindows: await Promise.all(this.popupPages.filter(page => !page.isClosed()).map(async (popup, index) => ({ index, title: await popup.title(), url: safeNavigationUrl(popup.url(), this.baseUrl) }))) };
    return this.lastView;
  }
  async links(): Promise<object> {
    const view = await this.snapshot();
    const menus: { label: string; path: string[]; url?: string }[] = [];
    const page = await this.ensure();
    const applicationFrame = await this.applicationFrame(page);
    for (const frame of page.frames()) {
      if (frame !== applicationFrame) continue;
      const items = await frame.evaluate(async () => {
        type Item = unknown;
        interface Store { fetch: (request: { query: object; onComplete: (items: Item[]) => void; onError: () => void }) => void; getLabel: (item: Item) => string; getValue: (item: Item, key: string) => unknown; getValues: (item: Item, key: string) => Item[] }
        const candidate = (window as unknown as { continentStore0?: Store }).continentStore0;
        if (!candidate?.fetch) return [];
        const store: Store = candidate;
        return new Promise<{ label: string; path: string[]; url?: string }[]>(resolve => {
          const timeout = setTimeout(() => resolve([]), 5000);
          store.fetch({ query: { type: 'continent' }, onComplete: roots => {
            const result: { label: string; path: string[]; url?: string }[] = [];
            const visited = new Set<Item>();
            function visit(item: Item, ancestors: string[]): void {
              if (visited.has(item) || result.length >= 300) return;
              visited.add(item);
              const label = String(store.getLabel(item) ?? store.getValue(item, 'showLinkName') ?? '').trim();
              const path = [...ancestors, label];
              const rawUrl = store.getValue(item, 'url');
              result.push({ label, path, ...(typeof rawUrl === 'string' ? { url: rawUrl } : {}) });
              for (const child of store.getValues(item, 'children') ?? []) visit(child, path);
            }
            roots.forEach(item => visit(item, []));
            clearTimeout(timeout); resolve(result);
          }, onError: () => { clearTimeout(timeout); resolve([]); } });
        });
      });
      menus.push(...items.map(({ label, path, url: rawUrl }) => {
        const url = rawUrl && /(?:\?|&)(?:actionFlag|viewName)=/i.test(rawUrl) ? safeNavigationUrl(rawUrl, frame.url()) : undefined;
        return { label, path, ...(url ? { url } : {}) };
      }));
    }
    if (menus.length) this.capturedMenus = menus;
    return { snapshotId: view.snapshotId, url: view.url, loginRequired: view.loginRequired, frames: view.frames.map(frame => ({ index: frame.index, name: frame.name, url: frame.url, visible: frame.visible, links: frame.controls.filter(control => !['input', 'textarea', 'select'].includes(control.tag)).map(({ ref, label, id, name, href, navigationUrl, onclick, activation }) => ({ ref, label, id, name, href, navigationUrl, onclick, activation })) })), menus };
  }
  private async applicationFrame(page: Page): Promise<Frame | undefined> {
    for (const frame of page.frames()) {
      if (!frame.parentFrame()) continue;
      const owner = await frame.frameElement().catch(() => undefined);
      if (owner && (await owner.getAttribute('id') === 'iframe_Applications' || await owner.getAttribute('name') === 'iframe_Applications')) return frame;
    }
    return page.frames().find(frame => frame.name() === 'iframe_Applications');
  }
  private async waitForApplicationFrame(): Promise<Frame> {
    const page = await this.ensure();
    for (let i = 0; i < 40; i++) {
      const frame = await this.applicationFrame(page);
      if (frame && frame.url() !== 'about:blank') return frame;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Applications frame did not load. Check the eTRiS session.');
  }
  async sections(): Promise<{ sections: MenuEntry[] }> {
    const view = await this.snapshot();
    if (view.loginRequired) throw new Error('Log in with etric_login before capturing sections.');
    if (this.capturedMenus.length) return { sections: this.capturedMenus };
    const applications = view.frames.flatMap(frame => frame.controls).find(control => control.id === 'application');
    if (!applications) throw new Error('Applications menu is not available. Open the eTRiS desktop first.');
    await this.click(view.snapshotId, applications.ref);
    await this.waitForApplicationFrame();
    for (let i = 0; i < 40; i++) {
      try { await this.links(); } catch { /* The Dojo menu may still be loading. */ }
      if (this.capturedMenus.length) return { sections: this.capturedMenus };
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('The authorized application menu did not load. Inspect the page and retry.');
  }
  async openSection(name: string): Promise<View> {
    const { sections } = await this.sections();
    const section = selectSection(sections, name);
    const page = await this.ensure();
    let frame = await this.applicationFrame(page);
    if (!frame) {
      const view = await this.snapshot();
      const applications = view.frames.flatMap(item => item.controls).find(control => control.id === 'application');
      if (!applications) throw new Error('Applications menu is unavailable.');
      await this.click(view.snapshotId, applications.ref);
      frame = await this.waitForApplicationFrame();
    }
    this.invalidate();
    await frame.goto(this.validateUrl(section.url!), { waitUntil: 'domcontentloaded', timeout: 45000 });
    return this.snapshot();
  }
  async dismissPopup(kind: 'notice' | 'window', snapshotId?: string, ref?: string): Promise<object> {
    if (kind === 'window') {
      const popup = this.popupPages.filter(page => !page.isClosed()).at(-1);
      if (!popup) return { status: 'no_popup_window' };
      await popup.close();
      this.invalidate();
      return { status: 'popup_window_closed', page: await this.snapshot() };
    }
    const view = snapshotId ? this.cachedView(snapshotId) : await this.snapshot();
    const candidates: Control[] = [];
    for (const control of view.frames.flatMap(frame => frame.controls)) {
      if (ref && control.ref !== ref) continue;
      if (!/^(?:close|dismiss|not now|later|x|×)$/i.test(control.label.trim())) continue;
      const target = await this.target(view.snapshotId, control.ref);
      const inNotice = await target.locator.evaluate(element => !!element.closest('[role="dialog"],[aria-modal="true"],.ui-dialog,.modal,.dialog,.popup,#zoomedImage'));
      if (inNotice) candidates.push(control);
    }
    if (candidates.length !== 1) {
      if (ref) throw new Error('This is not a recognized popup dismissal control. The program page was not closed.');
      return { status: candidates.length ? 'multiple_popups' : 'no_notice_popup', candidates, dismissedDialogs: this.dismissedDialogs };
    }
    return { status: 'notice_dismissed', page: await this.click(view.snapshotId, candidates[0].ref) };
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
    const { locator, control, frame } = await this.target(snapshotId, ref);
    this.invalidate();
    const page = await this.ensure();
    // Most dialogs are dismissed. A locally approved write may accept its single confirm dialog.
    const accept = (dialog: import('playwright').Dialog) => { if (dialog.type() === 'confirm') void dialog.accept().catch(() => {}); else void dialog.dismiss().catch(() => {}); };
    if (acceptDialog) {
      page.off('dialog', this.dismissDialog); page.on('dialog', accept);
    }
    try {
      const readUrl = programmeReadUrl(control, this.baseUrl);
      const detailReady = readUrl ? frame.waitForURL(url => url.origin === readUrl.origin && url.pathname === readUrl.pathname && ['actionFlag', 'notEditable', 'trngPrgTxnId', 'tpPrgMstId'].every(key => !readUrl.searchParams.has(key) || url.searchParams.get(key) === readUrl.searchParams.get(key)), { waitUntil: 'domcontentloaded', timeout: 15000 }).then(() => true, () => false) : undefined;
      if (control.activation === 'double_click') await locator.dblclick({ timeout: 15000 });
      else await locator.click({ timeout: 15000 });
      if (detailReady && !await detailReady) throw new Error('Programme detail did not load. Inspect the page before retrying.');
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
