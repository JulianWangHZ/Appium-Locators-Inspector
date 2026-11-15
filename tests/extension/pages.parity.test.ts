import { afterEach, describe, expect, it } from 'vitest';
import { click, legacyScript, normalizeHtml, openPage, readExtensionFile, snapshot, type Page, type PageOptions } from './harness.js';

const open: Page[] = [];
afterEach(() => { open.splice(0).forEach((p) => p.dispose()); });

function firstDifference(a: string, b: string): string {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return `at ${i}:\n  legacy: …${a.slice(Math.max(0, i - 120), i + 160)}…\n  modern: …${b.slice(Math.max(0, i - 120), i + 160)}…`;
}

function expectSameDom(legacy: Page, modern: Page, step: string, selector = 'body'): void {
    const want = snapshot(legacy, selector);
    const got = snapshot(modern, selector);
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
function popupOptions(state: { backend: boolean; appium: boolean; serverReply?: unknown; devicesReply?: unknown }): PageOptions {
    return {
        html: readExtensionFile('popup/popup.html'),
        sync: { backendPort: 8765, theme: 'dark' },
        onMessage: (msg) => {
            switch (msg.type) {
                case 'get-status': return { backend: state.backend, appium: state.appium };
                case 'request-logs': return { success: true, logs: [{ message: 'old log', level: 'info' }, { message: 'old error', level: 'error' }] };
                case 'start-server':
                case 'stop-server': return state.serverReply;
                case 'connect-device': return { started: true };
                default: return undefined;
            }
        },
        fetch: (url) => {
            if (url.endsWith('/health')) return { status: 'ok', adbAvailable: true, iosToolsAvailable: false };
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
        await both(pages, (p) => p.emitRuntime({ type: 'server-start-error', errors: [{ server: 'Local Companion', error: 'x', code: 'COMPANION_SETUP_REQUIRED' }] }));
        expectSameDom(legacy, modern, 'setup modal');
        await both(pages, (p) => click(p, p.document.getElementById('error-help-btn')));
        expect(modern.runtimeMessages.filter((m) => m.type === '__openOptionsPage').length).toBe(1);
    });

    it('handles start failures with the setup modal', async () => {
        const reply = { success: false, code: 'COMPANION_SETUP_REQUIRED', error: 'Install the local companion once to start servers and connect your devices.' };
        const pages = await openBoth(popupOptions({ backend: false, appium: false, serverReply: reply }), ['popup.js'], ['popup/popup.ts']);
        expectSameDom(pages[0], pages[1], 'stopped');
        await both(pages, (p) => click(p, p.document.getElementById('server-btn')));
        expectSameDom(pages[0], pages[1], 'start failed');
    });

    it('reports a non-setup start failure as a notice', async () => {
        const pages = await openBoth(popupOptions({ backend: false, appium: false, serverReply: { success: false, error: 'port busy' } }), ['popup.js'], ['popup/popup.ts']);
        await both(pages, (p) => click(p, p.document.getElementById('server-btn')));
        expectSameDom(pages[0], pages[1], 'start failed notice');
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
const FAKE_ZIP = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 37 + 11) % 256);
const LAUNCHER = '#!/usr/bin/env node\n"use strict";\nconsole.log("launcher");\n';
const RELEASE = { version: '1.1.0', filename: 'companion.zip', url: '', extensionPath: 'installers/companion.zip', sha256: 'abc123' };

function optionsPageOptions(diagnosticsReply: unknown): PageOptions {
    return {
        html: readExtensionFile('options.html'),
        sync: { backendPort: '9999', appiumUrl: 'http://localhost:4800', fpsLimit: 40 },
        files: {
            'installers/install_host.sh': readExtensionFile('installers/install_host.sh'),
            'installers/install_host.bat': readExtensionFile('installers/install_host.bat'),
            'installers/launcher.js': LAUNCHER,
            'installers/companion-release.json': JSON.stringify(RELEASE),
            'installers/companion.zip': FAKE_ZIP
        },
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
        expectSameDom(legacy, modern, 'initial');

        for (const item of Array.from(legacy.document.querySelectorAll<HTMLElement>('.rail-item'))) {
            await both(pages, (p) => click(p, p.document.querySelector(`.rail-item[data-pane="${item.dataset.pane}"]`)));
            expectSameDom(legacy, modern, `rail ${item.dataset.pane}`);
        }
        for (const tab of ['windows', 'mac']) {
            await both(pages, (p) => click(p, p.document.querySelector(`.tab-btn[data-tab="${tab}"]`)));
            expectSameDom(legacy, modern, `tab ${tab}`);
        }
        for (const theme of ['dark', 'light', 'dark']) {
            await both(pages, (p) => click(p, p.document.querySelector(`.theme-option[data-theme="${theme}"]`)));
            expectSameDom(legacy, modern, `theme ${theme}`);
        }

        await both(pages, (p) => {
            (p.document.getElementById('backend-port') as HTMLInputElement).value = '8800';
            (p.document.getElementById('fps-limit') as HTMLInputElement).value = '0';
            click(p, p.document.getElementById('save-btn'));
        });
        expectSameDom(legacy, modern, 'saved');
        expect(values(modern)).toEqual(values(legacy));
        const stored = (p: Page) => p.window.chrome.storage.sync.get({ backendPort: null, appiumUrl: null, fpsLimit: null, theme: null });
        expect(await stored(modern)).toEqual(await stored(legacy));
    });

    it('renders the environment check identically', async () => {
        const checks = [
            { name: 'Node.js', ok: true, detail: 'v26' },
            { name: 'Appium drivers', ok: true, warn: true, detail: 'xcuitest' },
            { name: 'adb <sdk>', ok: false, warn: true, detail: 'not found & "missing"' },
            { name: 'Java', ok: false, detail: 'not found' }
        ];
        const pages = await openBoth(optionsPageOptions({ success: true, checks }), ['options.js'], ['options/options.ts']);
        await both(pages, (p) => click(p, p.document.getElementById('check-backend-btn')), 20);
        expectSameDom(pages[0], pages[1], 'environment check');
    });

    it('reports a stopped backend identically', async () => {
        const pages = await openBoth(optionsPageOptions(new Error('refused')), ['options.js'], ['options/options.ts']);
        await both(pages, (p) => click(p, p.document.getElementById('check-backend-btn')), 20);
        expectSameDom(pages[0], pages[1], 'backend down');
    });

    it.each([['install_host.sh', 'download-mac'], ['install_host.bat', 'download-windows']])('builds a byte-identical %s installer', async (_file, buttonId) => {
        const pages = await openBoth(optionsPageOptions({ success: true, checks: [] }), ['options.js'], ['options/options.ts']);
        await both(pages, (p) => click(p, p.document.getElementById(buttonId)), 20);
        const [legacy, modern] = pages;
        expect(modern.downloads).toHaveLength(1);
        expect(modern.downloads[0]!.name).toBe(legacy.downloads[0]!.name);
        expect(modern.downloads[0]!.content).toBe(legacy.downloads[0]!.content);
        expect(modern.downloads[0]!.content).toContain('testextensionidaaaaaaaaaaaaaaaa');
        expect(normalizeHtml(modern.document.getElementById('download-status')!.textContent!)).toBe(normalizeHtml(legacy.document.getElementById('download-status')!.textContent!));
    });
});
