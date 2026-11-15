import { afterEach, describe, expect, it } from 'vitest';
import { fixture } from '../legacy.js';
import { click, legacyScript, openPage, readExtensionFile, snapshot, type Page } from './harness.js';

const DEVICES = {
    ios: { device: { id: 'SIM-1', platform: 'ios', name: 'iPhone 18 Pro', version: '27.2' }, xml: fixture('ios.xml'), image: { naturalWidth: 1206, naturalHeight: 2622, rect: { left: 0, top: 0, width: 402, height: 874 } } },
    android: { device: { id: 'emulator-5554', platform: 'android', name: 'Pixel 9', version: '15' }, xml: fixture('android.xml'), image: { naturalWidth: 1080, naturalHeight: 2400, rect: { left: 0, top: 0, width: 540, height: 1200 } } }
} as const;

type Kind = keyof typeof DEVICES;

const open: Page[] = [];
afterEach(() => { open.splice(0).forEach((p) => p.dispose()); });

async function openBoth(kind: Kind): Promise<[Page, Page]> {
    const { device, image } = DEVICES[kind];
    const opts = {
        html: readExtensionFile('inspector/inspector.html'),
        sync: { backendPort: 8765, fpsLimit: 5 },
        local: { activeSession: { device, sessionId: 's1', timestamp: 1 } },
        image
    };
    const legacy = await openPage(opts, [legacyScript('theme-init.js'), legacyScript('locator-generator.js'), legacyScript('code-snippet-generator.js'), legacyScript('inspector.js')]);
    const modern = await openPage(opts, { modern: ['theme-init.ts', 'inspector/index.ts'] });
    open.push(legacy, modern);
    return [legacy, modern];
}

async function both(pages: Page[], action: (p: Page) => void | Promise<void>): Promise<void> {
    for (const p of pages) await action(p);
    for (const p of pages) await p.settle();
}

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

async function connected(kind: Kind): Promise<[Page, Page]> {
    const pages = await openBoth(kind);
    await both(pages, (p) => p.ws()._open());
    await both(pages, (p) => p.wsReceive({ type: 'streaming-started', fps: 5, deviceId: DEVICES[kind].device.id }));
    await both(pages, (p) => p.wsReceive({ type: 'page-source', data: DEVICES[kind].xml, deviceId: DEVICES[kind].device.id }));
    return pages;
}

describe.each(['ios', 'android'] as const)('inspector UI parity (%s)', (kind) => {
    it('connects, streams and renders the page source identically', async () => {
        const [legacy, modern] = await connected(kind);
        expect(modern.sentWs).toEqual(legacy.sentWs);
        expect(modern.sentWs[0]).toMatchObject({ type: 'start-streaming', fps: 5 });
        expectSameDom(legacy, modern, 'after page source');
    });

    it('selects every tree node with identical details, overlays and match highlights', async () => {
        const pages = await connected(kind);
        const [legacy, modern] = pages;
        const count = legacy.document.querySelectorAll('.tree-node-header').length;
        for (let i = 0; i < count; i++) {
            await both(pages, (p) => click(p, p.document.querySelectorAll('.tree-node-header')[i]!));
            expectSameDom(legacy, modern, `select node ${i}`);

            // The Copy button now carries the full value (legacy cut values at the first quote).
            modern.document.querySelectorAll<HTMLElement>('#dpane-locators .copy-btn').forEach((btn) => {
                const value = btn.closest('.locator-item')?.querySelector('.locator-value')?.textContent;
                expect(btn.getAttribute('data-copy-text')).toBe(value);
            });

            const matchButtons = legacy.document.querySelectorAll('#dpane-locators .match-count').length;
            for (let m = 0; m < matchButtons; m++) {
                await both(pages, (p) => click(p, p.document.querySelectorAll('#dpane-locators .match-count')[m]!));
                expectSameDom(legacy, modern, `node ${i} match ${m}`);
                await both(pages, (p) => click(p, p.document.querySelectorAll('#dpane-locators .copy-code-btn')[m]!));
            }
        }
        expect(modern.clipboard).toEqual(legacy.clipboard);
    });

    it('hit-tests hover and clicks on the screen mirror identically', async () => {
        const pages = await connected(kind);
        const [legacy, modern] = pages;
        const { rect } = DEVICES[kind].image;
        const points = [[0.5, 0.5], [0.2, 0.14], [0.5, 0.3], [0.3, 0.45], [0.95, 0.99]];
        for (const [fx, fy] of points) {
            const init = { clientX: rect.width * fx!, clientY: rect.height * fy! };
            await both(pages, (p) => {
                p.document.getElementById('screen-image')!.dispatchEvent(new p.window.MouseEvent('mouseenter'));
                p.document.getElementById('screen-image')!.dispatchEvent(new p.window.MouseEvent('mousemove', { bubbles: true, ...init }));
            });
            expectSameDom(legacy, modern, `hover ${fx},${fy}`);
            await both(pages, (p) => click(p, p.document.getElementById('screen-image'), init));
            expectSameDom(legacy, modern, `click ${fx},${fy}`);
        }
        await both(pages, (p) => click(p, p.document.querySelector('.device-stage')));
        expectSameDom(legacy, modern, 'deselect');
    });

    it('filters the tree with search identically', async () => {
        const pages = await connected(kind);
        for (const term of ['button', 'log', 'zzz', '']) {
            await both(pages, (p) => {
                const input = p.document.getElementById('search-input') as HTMLInputElement;
                input.value = term;
                input.dispatchEvent(new p.window.Event('input', { bubbles: true }));
            });
            expectSameDom(pages[0], pages[1], `search "${term}"`);
        }
    });

    it('records actions and assertions, drives the device, and exports identical scripts', async () => {
        const pages = await connected(kind);
        const [legacy, modern] = pages;
        const { rect } = DEVICES[kind].image;
        await both(pages, (p) => click(p, p.document.querySelector('.detail-tab[data-tab="record"]')));
        await both(pages, (p) => click(p, p.document.getElementById('record-toggle')));
        expectSameDom(legacy, modern, 'recording started');

        const targets = [[0.5, 0.31], [0.5, 0.18], [0.3, 0.45]];
        const actions = ['tap', 'doubleTap', 'longPress', 'swipe:up', 'swipe:left', 'pinchOpen', 'pinchClose', 'input', 'clear'];
        for (const [fx, fy] of targets) {
            await both(pages, (p) => click(p, p.document.getElementById('screen-image'), { clientX: rect.width * fx!, clientY: rect.height * fy! }));
            expectSameDom(legacy, modern, `record select ${fx},${fy}`);
            for (const action of actions) {
                const [act, dir] = action.split(':');
                await both(pages, (p) => {
                    const input = p.document.getElementById('rec-type-input') as HTMLInputElement | null;
                    if (input) input.value = 'hello "world"';
                    const selector = dir ? `.rec-act[data-act="${act}"][data-dir="${dir}"]` : `.rec-act[data-act="${act}"]`;
                    click(p, p.document.querySelector(selector));
                });
                expectSameDom(legacy, modern, `action ${action}`);
            }
            await both(pages, (p) => click(p, p.document.querySelector('.rec-subtab[data-recsub="assert"]')));
            for (const matcher of ['visible', 'hidden', 'enabled', 'disabled', 'checked', 'unchecked', 'empty']) {
                await both(pages, (p) => click(p, p.document.querySelector(`.rec-act[data-assert="${matcher}"]`)));
                expectSameDom(legacy, modern, `assert ${matcher}`);
            }
            await both(pages, (p) => click(p, p.document.querySelector('.rec-subtab[data-recsub="actions"]')));
        }
        expect(modern.fetchCalls).toEqual(legacy.fetchCalls);

        await both(pages, (p) => click(p, p.document.querySelectorAll('.step-delete')[1]!));
        expectSameDom(legacy, modern, 'delete step');

        await both(pages, (p) => click(p, p.document.getElementById('goto-recorded')));
        for (const lang of ['python', 'webdriverio', 'java']) {
            for (const full of [true, false]) {
                await both(pages, (p) => {
                    const select = p.document.getElementById('script-lang-select') as HTMLSelectElement;
                    select.value = lang;
                    select.dispatchEvent(new p.window.Event('change', { bubbles: true }));
                    const check = p.document.getElementById('full-file-check') as HTMLInputElement;
                    if (check.checked !== full) {
                        check.checked = full;
                        check.dispatchEvent(new p.window.Event('change', { bubbles: true }));
                    }
                });
                expectSameDom(legacy, modern, `recorded ${lang} full=${full}`);
                await both(pages, (p) => click(p, p.document.getElementById('export-script')));
            }
        }
        expect(modern.clipboard).toEqual(legacy.clipboard);
        expect(modern.window.localStorage.getItem('ali-snippet-lang')).toBe(legacy.window.localStorage.getItem('ali-snippet-lang'));

        await both(pages, (p) => click(p, p.document.getElementById('clear-steps')));
        expectSameDom(legacy, modern, 'cleared');
    });

    it('handles interact mode, typing, theme toggle, errors and disconnect identically', async () => {
        const pages = await connected(kind);
        const [legacy, modern] = pages;
        const { rect } = DEVICES[kind].image;
        await both(pages, (p) => click(p, p.document.getElementById('mode-toggle-btn')));
        expectSameDom(legacy, modern, 'interact mode');
        await both(pages, (p) => click(p, p.document.getElementById('screen-image'), { clientX: rect.width / 2, clientY: rect.height / 3 }));
        for (const key of ['a', 'B', 'Backspace', 'Enter', 'Shift']) {
            await both(pages, (p) => { p.document.dispatchEvent(new p.window.KeyboardEvent('keydown', { key, bubbles: true })); });
        }
        expect(modern.fetchCalls).toEqual(legacy.fetchCalls);
        await both(pages, (p) => click(p, p.document.getElementById('mode-toggle-btn')));
        await both(pages, (p) => click(p, p.document.getElementById('theme-toggle-btn')));
        expectSameDom(legacy, modern, 'theme toggled');
        expect(modern.document.documentElement.outerHTML.match(/<html[^>]*>/)?.[0]).toBe(legacy.document.documentElement.outerHTML.match(/<html[^>]*>/)?.[0]);

        await both(pages, (p) => p.wsReceive({ type: 'error', message: 'boom' }));
        expectSameDom(legacy, modern, 'backend error');
        await both(pages, (p) => p.wsReceive({ type: 'screenshot', data: 'x', deviceId: 'other-device' }));
        expectSameDom(legacy, modern, 'foreign device ignored');

        await both(pages, (p) => click(p, p.document.getElementById('refresh-btn')));
        expect(modern.sentWs).toEqual(legacy.sentWs);
        await both(pages, (p) => click(p, p.document.getElementById('disconnect-btn')));
        expect(modern.sentWs).toEqual(legacy.sentWs);
        expect(modern.fetchCalls).toEqual(legacy.fetchCalls);
    });
});
