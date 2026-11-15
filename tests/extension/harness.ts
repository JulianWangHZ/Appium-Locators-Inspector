/**
 * UI parity harness: loads one extension page twice in jsdom — once with the legacy
 * JavaScript, once with the new TypeScript modules — behind identical fakes for the
 * chrome.*, fetch and WebSocket APIs, so tests can drive both and compare the DOM.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { vi } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const EXT = join(ROOT, 'src', 'extension');
const LEGACY = join(ROOT, 'tests', 'legacy');

export function legacyScript(file: string): string {
    return readFileSync(join(LEGACY, file), 'utf8');
}

export interface FetchCall {
    url: string;
    method: string;
    body: unknown;
}

export interface PageOptions {
    html: string;
    sync?: Record<string, unknown>;
    local?: Record<string, unknown>;
    localStorage?: Record<string, string>;
    /** Background replies for chrome.runtime.sendMessage. */
    onMessage?: (msg: any) => unknown;
    /** Fake HTTP responses keyed by "METHOD path". */
    fetch?: (url: string, init: { method: string; body: unknown }) => unknown;
    /** Raw file responses for chrome-extension:// URLs. */
    files?: Record<string, string | Uint8Array>;
    image?: { naturalWidth: number; naturalHeight: number; rect: { left: number; top: number; width: number; height: number } };
}

export interface Page {
    window: any;
    document: Document;
    fetchCalls: FetchCall[];
    sentWs: any[];
    clipboard: string[];
    downloads: Array<{ name: string; content: string }>;
    runtimeMessages: any[];
    emitRuntime: (msg: unknown) => void;
    ws: () => any;
    wsReceive: (msg: unknown) => void;
    settle: (rounds?: number) => Promise<void>;
    dispose: () => void;
}

function createChrome(opts: PageOptions, page: { runtimeMessages: any[] }, window: any) {
    const sync: Record<string, unknown> = { ...(opts.sync ?? {}) };
    const local: Record<string, unknown> = { ...(opts.local ?? {}) };
    const messageListeners: Array<(...args: any[]) => unknown> = [];
    const storageListeners: Array<(...args: any[]) => unknown> = [];

    const area = (store: Record<string, unknown>, name: string) => ({
        get(keys: unknown, cb?: (r: unknown) => void) {
            let result: Record<string, unknown>;
            if (typeof keys === 'string') result = keys in store ? { [keys]: store[keys] } : {};
            else if (keys && typeof keys === 'object') {
                result = Object.fromEntries(Object.entries(keys as object).map(([k, d]) => [k, k in store ? store[k] : d]));
            } else result = { ...store };
            const copy = JSON.parse(JSON.stringify(result));
            if (cb) { setTimeout(() => cb(copy), 0); return undefined; }
            return Promise.resolve(copy);
        },
        set(items: Record<string, unknown>, cb?: () => void) {
            const changes: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(items)) {
                changes[k] = { oldValue: store[k], newValue: v };
                store[k] = v;
            }
            setTimeout(() => storageListeners.forEach((fn) => fn(changes, name)), 0);
            if (cb) { setTimeout(cb, 0); return undefined; }
            return Promise.resolve();
        },
        remove(key: string) { delete store[key]; return Promise.resolve(); }
    });

    return {
        storage: {
            sync: area(sync, 'sync'),
            local: area(local, 'local'),
            onChanged: { addListener: (fn: any) => storageListeners.push(fn) }
        },
        runtime: {
            id: 'testextensionidaaaaaaaaaaaaaaaa',
            lastError: undefined,
            getURL: (p: string) => `chrome-extension://testext/${p}`,
            getManifest: () => ({ version: '1.0.0' }),
            onMessage: { addListener: (fn: any) => messageListeners.push(fn) },
            openOptionsPage: () => page.runtimeMessages.push({ type: '__openOptionsPage' }),
            sendMessage(msg: unknown, cb?: (r: unknown) => void) {
                page.runtimeMessages.push(msg);
                const response = opts.onMessage?.(msg);
                if (cb) { setTimeout(() => cb(response), 0); return undefined; }
                return Promise.resolve(response);
            }
        },
        _emit: (msg: unknown) => messageListeners.forEach((fn) => fn(msg, { id: 'testextensionidaaaaaaaaaaaaaaaa' }, () => {})),
        _window: window
    };
}

/** Globals the new TypeScript pages read; pointed at the page's jsdom window while it runs. */
const PAGE_GLOBALS = [
    'window', 'document', 'navigator', 'localStorage', 'DOMParser', 'XPathResult', 'WebSocket', 'fetch', 'chrome',
    'alert', 'getComputedStyle', 'Blob', 'URL', 'Event', 'MouseEvent', 'KeyboardEvent', 'HTMLElement', 'Node'
] as const;

function bindGlobals(window: any): () => void {
    const saved = PAGE_GLOBALS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    for (const key of PAGE_GLOBALS) {
        Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
    }
    return () => {
        for (const [key, descriptor] of saved) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete (globalThis as any)[key];
        }
    };
}

/**
 * Load a page. `scripts` are evaluated inside jsdom (legacy JS);
 * `{ modern: 'popup/popup.ts' }` imports the TypeScript entry natively so coverage sees it.
 */
export async function openPage(opts: PageOptions, scripts: string[] | { modern: string[] }): Promise<Page> {
    const html = opts.html.replace(/<script\b[^>]*><\/script>/g, '');
    const dom = new JSDOM(html, { url: 'http://localhost/page.html', runScripts: 'outside-only', pretendToBeVisual: true });
    const window = dom.window as any;
    const page: Page = {
        window,
        document: window.document,
        fetchCalls: [],
        sentWs: [],
        clipboard: [],
        downloads: [],
        runtimeMessages: [],
        emitRuntime: () => {},
        ws: () => sockets.at(-1),
        wsReceive: (msg) => sockets.at(-1)?.onmessage?.({ data: JSON.stringify(msg) }),
        settle: async (rounds = 8) => {
            for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
        },
        dispose: () => realClose()
    };
    const realClose = window.close.bind(window);

    for (const [k, v] of Object.entries(opts.localStorage ?? {})) window.localStorage.setItem(k, v);
    const chrome = createChrome(opts, page, window);
    window.chrome = chrome;
    page.emitRuntime = chrome._emit;

    window.alert = () => {};
    window.TextEncoder = TextEncoder;
    window.TextDecoder = TextDecoder;
    window.close = () => {};
    window.Element.prototype.scrollIntoView = function () {};
    window.Element.prototype.scrollTo = function () {};
    window.HTMLCanvasElement.prototype.getContext = () => null;
    window.navigator.clipboard = { writeText: async (t: string) => { page.clipboard.push(t); } };
    window.URL.createObjectURL = () => 'blob:x';
    window.URL.revokeObjectURL = () => {};
    const RealBlob = window.Blob;
    window.Blob = class extends RealBlob {
        _text: string;
        constructor(parts: string[], o?: any) { super(parts, o); this._text = parts.join(''); }
    };
    window.HTMLAnchorElement.prototype.click = function (this: any) {
        page.downloads.push({ name: this.download, content: lastBlobText });
    };
    let lastBlobText = '';
    const origCreate = window.URL.createObjectURL;
    window.URL.createObjectURL = (b: any) => { lastBlobText = b._text; return origCreate(b); };

    if (opts.image) {
        const img = opts.image;
        Object.defineProperty(window.HTMLImageElement.prototype, 'naturalWidth', { get: () => img.naturalWidth });
        Object.defineProperty(window.HTMLImageElement.prototype, 'naturalHeight', { get: () => img.naturalHeight });
        const r = img.rect;
        window.HTMLImageElement.prototype.getBoundingClientRect = () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top });
    }

    window.fetch = async (url: string, init: any = {}) => {
        const method = init.method || 'GET';
        const body = init.body ? JSON.parse(init.body) : undefined;
        if (url.startsWith('chrome-extension://')) {
            const path = url.replace('chrome-extension://testext/', '');
            const file = opts.files?.[path];
            if (file === undefined) return { ok: false, status: 404, text: async () => '', json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
            const bytes = typeof file === 'string' ? new TextEncoder().encode(file) : file;
            return {
                ok: true, status: 200,
                text: async () => (typeof file === 'string' ? file : new TextDecoder().decode(file)),
                json: async () => JSON.parse(typeof file === 'string' ? file : new TextDecoder().decode(file)),
                arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
            };
        }
        page.fetchCalls.push({ url, method, body });
        const reply = opts.fetch?.(url, { method, body }) ?? { success: true };
        if (reply instanceof Error) throw reply;
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(reply)) };
    };

    const sockets: any[] = [];
    class FakeWebSocket {
        static OPEN = 1;
        static CONNECTING = 0;
        readyState = 0;
        onopen: any; onmessage: any; onclose: any; onerror: any;
        constructor(readonly url: string) { sockets.push(this); }
        send(data: string) { page.sentWs.push(JSON.parse(data)); }
        close() { this.readyState = 3; }
        _open() { this.readyState = 1; this.onopen?.({}); }
    }
    window.WebSocket = FakeWebSocket;

    if (Array.isArray(scripts)) {
        // Scripts run while the document is still "loading"; jsdom then fires DOMContentLoaded itself.
        for (const script of scripts) window.eval(script);
    } else {
        const restore = bindGlobals(window);
        const dispose = page.dispose;
        page.dispose = () => { restore(); dispose(); };
        vi.resetModules();
        for (const entry of scripts.modern) await import(join(EXT, entry));
        // The import is async: if jsdom already fired DOMContentLoaded, replay it for the new listeners.
        if (window.document.readyState !== 'loading') window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    }
    await page.settle();
    return page;
}

/** Comparable markup: drop inter-tag whitespace and collapse runs of whitespace. */
export function normalizeHtml(html: string): string {
    return html
        .replace(/>\s+</g, '><')
        .replace(/\s+/g, ' ')
        .replace(/ >/g, '>')
        .replace(/ "/g, '"')
        .trim();
}

/**
 * Body markup for comparison. Copy-button attributes other than class/index are dropped:
 * the legacy page wrote data-copy-text unescaped, so values with `"` broke the markup.
 * The tests check data-copy-text on the new page separately.
 */
export function snapshot(page: Page, selector = 'body', exclude: string[] = []): string {
    const root = page.document.querySelector(selector);
    if (!root) return '';
    const clone = root.cloneNode(true) as Element;
    exclude.forEach((sel) => clone.querySelectorAll(sel).forEach((el) => el.remove()));
    clone.querySelectorAll('.copy-btn').forEach((el) => {
        for (const name of el.getAttributeNames()) {
            if (name !== 'class' && name !== 'data-locator-index' && name !== 'style') el.removeAttribute(name);
        }
    });
    return normalizeHtml(clone.innerHTML);
}

export function click(page: Page, el: Element | null, init: Record<string, unknown> = {}): void {
    if (!el) throw new Error('click target missing');
    el.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
}

export function readExtensionFile(path: string): string {
    return readFileSync(join(EXT, path), 'utf8');
}
