import { afterEach, describe, expect, it } from 'vitest';
import { click, legacyScript, normalizeHtml, openPage, readExtensionFile, snapshot, type Page, type PageOptions } from './harness.js';

const open: Page[] = [];
afterEach(() => { open.splice(0).forEach((p) => p.dispose()); });

function firstDifference(a: string, b: string): string {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return `at ${i}:\n  legacy: …${a.slice(Math.max(0, i - 120), i + 160)}…\n  modern: …${b.slice(Math.max(0, i - 120), i + 160)}…`;
}

function expectSameDom(legacy: Page, modern: Page, step: string, selector = 'body', exclude: string[] = []): void {
    const want = snapshot(legacy, selector, exclude);
    const got = snapshot(modern, selector, exclude);
    if (got !== want) expect.fail(`${step} differs ${firstDifference(want, got)}`);
}

async function both(pages: Page[], action: (p: Page) => void | Promise<void>, rounds?: number): Promise<void> {
    for (const p of pages) await action(p);
    for (const p of pages) await p.settle(rounds);
}

async function openBoth(opts: PageOptions, legacyFiles: string[], modernEntries: string[]): Promise<[Page, Page]> {
    const legacy = await openPage(opts, legacyFiles.map(legacyScript));
    const modern = await openPage(opts, { modern: modernEntries });
    open.push(legacy, modern);
    return [legacy, modern];
}

/* ── Popup ─────────────────────────────────────────── */
function popupOptions(state: { backend: boolean; appium: boolean; serverReply?: unknown; devicesReply?: unknown; nativeBackend?: boolean }): PageOptions {
    return {
        html: readExtensionFile('popup/popup.html'),
        sync: { backendPort: 8765, theme: 'dark' },
        onMessage: (msg) => {
            switch (msg.type) {
                case 'get-status': return state.nativeBackend === false ? { backend: false, appium: false } : { backend: state.backend, appium: state.appium };
                case 'request-logs': return { success: true, logs: [{ message: 'old log', level: 'info' }, { message: 'old error', level: 'error' }] };
                case 'start-server':
                case 'stop-server': return state.serverReply;
                case 'connect-device': return { started: true };
                default: return undefined;
            }
        },
        fetch: (url) => {
            if (url.endsWith('/health')) return state.backend ? { status: 'ok', adbAvailable: true, iosToolsAvailable: false } : new Error('refused');
            if (url.endsWith('/api/shutdown')) return { success: true };
            if (url.includes('/api/devices/')) return state.devicesReply;
            return { success: true };
        }
    };
}

describe('popup UI parity', () => {
    it('walks the connect flow identically', async () => {
        const devices = [{ id: 'SIM-1', platform: 'ios', name: 'iPhone 18 Pro', version: '27.2' }, { id: 'SIM-2', platform: 'ios', name: 'iPad', version: '27.2' }];
        const pages = await openBoth(popupOptions({ backend: true, appium: true, devicesReply: { success: true, devices } }), ['theme-init.js', 'popup.js'], ['theme-init.ts', 'popup/popup.ts']);
        const [legacy, modern] = pages;
        expectSameDom(legacy, modern, 'initial');
        expect(modern.document.documentElement.getAttribute('data-theme')).toBe(legacy.document.documentElement.getAttribute('data-theme'));

        await both(pages, (p) => click(p, p.document.querySelector('.seg[data-platform="ios"]')));
        expectSameDom(legacy, modern, 'platform chosen');
        await both(pages, (p) => {
            const select = p.document.getElementById('device-select') as HTMLSelectElement;
            select.value = '1';
            select.dispatchEvent(new p.window.Event('change', { bubbles: true }));
        });
        expectSameDom(legacy, modern, 'device chosen');
        await both(pages, (p) => click(p, p.document.getElementById('connect-btn')));
        expectSameDom(legacy, modern, 'connecting');
        expect(modern.runtimeMessages.find((m) => m.type === 'connect-device')).toEqual(legacy.runtimeMessages.find((m) => m.type === 'connect-device'));

        await both(pages, (p) => p.emitRuntime({ type: 'device-connection-result', success: false, error: 'WDA failed' }));
        expectSameDom(legacy, modern, 'connection failed');
        await both(pages, (p) => p.emitRuntime({ type: 'server-log', message: '[Backend] hello', level: 'warning' }));
        await both(pages, (p) => click(p, p.document.getElementById('logs-toggle')));
        expectSameDom(legacy, modern, 'logs open');
        await both(pages, (p) => click(p, p.document.getElementById('open-logs-btn')));
        await both(pages, (p) => click(p, p.document.getElementById('theme-toggle')));
        expectSameDom(legacy, modern, 'theme toggled');
        expect(modern.window.localStorage.getItem('ali-theme')).toBe(legacy.window.localStorage.getItem('ali-theme'));
        await both(pages, (p) => click(p, p.document.getElementById('settings-link')));
        expect(modern.runtimeMessages.map((m) => m.type)).toEqual(legacy.runtimeMessages.map((m) => m.type));
    });

    it('shows identical empty and error states', async () => {
        const pages = await openBoth(popupOptions({ backend: true, appium: false, devicesReply: { success: true, devices: [] } }), ['popup.js'], ['popup/popup.ts']);
        const [legacy, modern] = pages;
        await both(pages, (p) => click(p, p.document.querySelector('.seg[data-platform="android"]')));
        expectSameDom(legacy, modern, 'no devices');
        await both(pages, (p) => p.emitRuntime({ type: 'server-start-error', errors: [{ server: 'Appium', error: 'Appium is not installed', code: 'APPIUM_NOT_FOUND' }] }));
        expectSameDom(legacy, modern, 'start error modal');
        await both(pages, (p) => click(p, p.document.getElementById('error-modal')));
        expectSameDom(legacy, modern, 'modal closed');
    });

    it('reports a non-setup start failure as a notice', async () => {
        const pages = await openBoth(popupOptions({ backend: false, appium: false, serverReply: { success: false, error: 'port busy' } }), ['popup.js'], ['popup/popup.ts']);
        expectSameDom(pages[0], pages[1], 'stopped');
        await both(pages, (p) => click(p, p.document.getElementById('server-btn')));
        expectSameDom(pages[0], pages[1], 'start failed notice');
    });
});

/* ── Popup: npx companion (new in 1.2.0, no legacy equivalent) ── */
describe('popup with the npx companion', () => {
    const setupReply = { success: false, code: 'COMPANION_SETUP_REQUIRED', error: 'Start the local companion with: npx appium-locators-inspector' };

    async function openModern(state: Parameters<typeof popupOptions>[0]): Promise<Page> {
        const page = await openPage(popupOptions(state), { modern: ['popup/popup.ts'] });
        open.push(page);
        return page;
    }

    it('shows the npx command with a Copy button when nothing is running', async () => {
        const page = await openModern({ backend: false, appium: false, serverReply: setupReply });
        click(page, page.document.getElementById('server-btn'));
        await page.settle();
        const modal = page.document.getElementById('error-modal')!;
        expect(modal.classList.contains('hidden')).toBe(false);
        expect(page.document.getElementById('error-modal-title')!.textContent).toBe('Start the companion');
        expect(modal.querySelector('.cmd-code')!.textContent).toBe('npx appium-locators-inspector');
        click(page, modal.querySelector('.cmd-row button'));
        await page.settle();
        expect(page.clipboard).toEqual(['npx appium-locators-inspector']);
        click(page, page.document.getElementById('error-help-btn'));
        expect(page.runtimeMessages.some((m) => m.type === '__openOptionsPage')).toBe(true);
    });

    it('detects a companion started in a terminal and stops it through the backend', async () => {
        const page = await openModern({ backend: true, appium: false, nativeBackend: false, devicesReply: { success: true, devices: [] } });
        expect(page.document.getElementById('backend-state')!.textContent).toBe('Running');
        expect(page.document.getElementById('step-platform')!.dataset.state).toBe('active');
        expect(page.document.getElementById('server-btn')!.textContent).toBe('Stop servers');

        click(page, page.document.getElementById('server-btn'));
        await page.settle();
        expect(page.fetchCalls.some((c) => c.url.endsWith('/api/shutdown') && c.method === 'POST')).toBe(true);
        expect(page.runtimeMessages.some((m) => m.type === 'stop-server')).toBe(false);
    });

    it('shows the extension version in the footer', async () => {
        const page = await openModern({ backend: false, appium: false });
        expect(page.document.querySelector('.appfoot .version')!.textContent).toBe('v1.0.0');
    });
});

/* ── Logs page ─────────────────────────────────────── */
describe('logs page UI parity', () => {
    it('renders, filters and clears logs identically', async () => {
        const opts: PageOptions = {
            html: readExtensionFile('logs.html'),
            onMessage: (msg) => (msg.type === 'request-logs'
                ? { success: true, logs: [{ message: '<b>not html</b>', level: 'info', timestamp: 1_700_000_000_000 }] }
                : undefined)
        };
        const pages = await openBoth(opts, ['logs.js'], ['logs/logs.ts']);
        const [legacy, modern] = pages;
        expectSameDom(legacy, modern, 'history');
        for (const [message, level] of [['started', 'info'], ['slow', 'warning'], ['boom', 'error']]) {
            await both(pages, (p) => p.emitRuntime({ type: 'server-log', message, level, timestamp: 1_700_000_100_000 }));
        }
        expectSameDom(legacy, modern, 'live logs');
        for (const filter of ['error', 'warning', 'info', 'all']) {
            await both(pages, (p) => click(p, p.document.querySelector(`.filter-btn[data-filter="${filter}"]`)));
            expectSameDom(legacy, modern, `filter ${filter}`);
        }
        await both(pages, (p) => click(p, p.document.getElementById('clear-logs-btn')));
        expectSameDom(legacy, modern, 'cleared');
    });
});

/* ── Options page ──────────────────────────────────── */
/** The Setup and Help panes changed on purpose in 1.2.0 (npx companion); the rest must match. */
const CHANGED_PANES = ['#pane-setup', '#pane-help'];

function optionsPageOptions(diagnosticsReply: unknown): PageOptions {
    return {
        html: readExtensionFile('options.html'),
        sync: { backendPort: '9999', appiumUrl: 'http://localhost:4800', fpsLimit: 40 },
        onMessage: (msg) => (msg.type === 'check-setup'
            ? {
                success: true,
                nativeHost: true,
                diagnostics: {
                    backendInstalled: true, dependenciesInstalled: false, launcherInstalled: true, manifestInstalled: true,
                    extensionAllowed: false, manifestPath: '/m.json', hostName: 'com.appium_locators_inspector.host',
                    backendPath: '/home/u/.appium_locators_inspector/backend', installBase: '/home/u/.appium_locators_inspector', companionVersion: '1.1.0'
                }
            }
            : undefined),
        fetch: () => diagnosticsReply
    };
}

describe('options page UI parity', () => {
    it('loads, navigates, themes and saves settings identically', async () => {
        const pages = await openBoth(optionsPageOptions({ success: true, checks: [] }), ['theme-init.js', 'options.js'], ['theme-init.ts', 'options/options.ts']);
        const [legacy, modern] = pages;
        const values = (p: Page) => ['backend-port', 'appium-url', 'fps-limit'].map((id) => (p.document.getElementById(id) as HTMLInputElement).value);
        expect(values(modern)).toEqual(values(legacy));
        expectSameDom(legacy, modern, 'initial', 'body', CHANGED_PANES);

        for (const item of Array.from(legacy.document.querySelectorAll<HTMLElement>('.rail-item'))) {
            await both(pages, (p) => click(p, p.document.querySelector(`.rail-item[data-pane="${item.dataset.pane}"]`)));
            expectSameDom(legacy, modern, `rail ${item.dataset.pane}`, 'body', CHANGED_PANES);
        }
        for (const theme of ['dark', 'light', 'dark']) {
            await both(pages, (p) => click(p, p.document.querySelector(`.theme-option[data-theme="${theme}"]`)));
            expectSameDom(legacy, modern, `theme ${theme}`, 'body', CHANGED_PANES);
        }

        await both(pages, (p) => {
            (p.document.getElementById('backend-port') as HTMLInputElement).value = '8800';
            (p.document.getElementById('fps-limit') as HTMLInputElement).value = '0';
            click(p, p.document.getElementById('save-btn'));
        });
        expectSameDom(legacy, modern, 'saved', 'body', CHANGED_PANES);
        expect(values(modern)).toEqual(values(legacy));
        const stored = (p: Page) => p.window.chrome.storage.sync.get({ backendPort: null, appiumUrl: null, fpsLimit: null, theme: null });
        expect(await stored(modern)).toEqual(await stored(legacy));
    });
});

describe('options page with the npx companion', () => {
    async function openModern(diagnosticsReply: unknown, setupReply?: unknown): Promise<Page> {
        const opts = optionsPageOptions(diagnosticsReply);
        const page = await openPage(setupReply === undefined ? opts : { ...opts, onMessage: () => setupReply }, { modern: ['options/options.ts'] });
        open.push(page);
        return page;
    }

    it('shows copyable start and setup commands for this extension ID', async () => {
        const page = await openModern({ success: true, checks: [] });
        expect(page.document.getElementById('cmd-start')!.textContent).toBe('npx appium-locators-inspector');
        expect(page.document.getElementById('cmd-setup')!.textContent).toBe('npx appium-locators-inspector setup --extension-id testextensionidaaaaaaaaaaaaaaaa');
        for (const btn of Array.from(page.document.querySelectorAll('.cmd-copy'))) click(page, btn);
        await page.settle();
        expect(page.clipboard).toEqual(['npx appium-locators-inspector', 'npx appium-locators-inspector setup --extension-id testextensionidaaaaaaaaaaaaaaaa']);
        expect(page.document.querySelector('.cmd-copy')!.textContent).toBe('Copied!');
        expect(page.document.getElementById('download-mac')).toBeNull();
        expect(page.document.querySelector('.rail-brand .ver')!.textContent).toBe('v1.0.0');
    });

    it('renders the environment check with npx guidance', async () => {
        const checks = [
            { name: 'Node.js', ok: true, detail: 'v26' },
            { name: 'adb <sdk>', ok: false, warn: true, detail: 'not found & "missing"' },
            { name: 'Backend server', ok: true, detail: 'running on 8765' }
        ];
        const page = await openModern({ success: true, checks }, { success: false, nativeHost: false, error: 'not registered' });
        click(page, page.document.getElementById('check-backend-btn'));
        await page.settle(20);
        const text = page.document.getElementById('check-result')!.textContent!;
        expect(text).toContain('All good');
        expect(text).toContain('optional — run npx appium-locators-inspector setup to enable it');
        expect(page.document.getElementById('check-result')!.innerHTML).toContain('adb &lt;sdk&gt;');
    });

    it('asks to start the companion when the backend is down', async () => {
        const page = await openModern(new Error('refused'), { success: false, nativeHost: false, error: 'not registered' });
        click(page, page.document.getElementById('check-backend-btn'));
        await page.settle(20);
        const text = page.document.getElementById('check-result')!.textContent!;
        expect(text).toContain('2 items need attention.');
        expect(text).toContain('not running — run npx appium-locators-inspector');
    });
});
