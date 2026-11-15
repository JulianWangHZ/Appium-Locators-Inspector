import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakePort {
    posted: any[];
    postMessage: (m: any) => void;
    onMessage: { addListener: (fn: any) => void };
    onDisconnect: { addListener: (fn: any) => void };
    deliver: (m: any) => void;
    drop: (error?: string) => void;
}

function fakePort(chrome: any): FakePort {
    const onMsg: any[] = [];
    const onDisc: any[] = [];
    return {
        posted: [],
        postMessage(m) { this.posted.push(m); },
        onMessage: { addListener: (fn) => onMsg.push(fn) },
        onDisconnect: { addListener: (fn) => onDisc.push(fn) },
        deliver: (m) => onMsg.forEach((fn) => fn(m)),
        drop: (error) => {
            chrome.runtime.lastError = error ? { message: error } : undefined;
            onDisc.forEach((fn) => fn());
            chrome.runtime.lastError = undefined;
        }
    };
}

let chrome: any;
let ports: FakePort[];
let broadcasts: any[];
let messageListener: (req: any, sender: any, respond: (r: any) => void) => boolean;
let nativeAvailable = true;

beforeEach(async () => {
    vi.useFakeTimers();
    ports = [];
    broadcasts = [];
    nativeAvailable = true;
    chrome = {
        runtime: {
            id: 'ext-id',
            lastError: undefined,
            getURL: (p: string) => `chrome-extension://ext-id/${p}`,
            connectNative: () => {
                if (!nativeAvailable) throw new Error('not allowed');
                const port = fakePort(chrome);
                ports.push(port);
                return port;
            },
            sendMessage: (m: any) => { broadcasts.push(m); return Promise.resolve(); },
            onMessage: { addListener: (fn: any) => { messageListener = fn; } },
            onInstalled: { addListener: () => {} }
        },
        storage: { sync: { get: async (d: any) => ({ ...d, backendPort: '9000', appiumUrl: 'http://localhost:4800', fpsLimit: 99 }) }, local: { set: vi.fn(async () => {}) } },
        tabs: {
            onRemoved: { addListener: () => {} },
            create: vi.fn(async () => ({ id: 7 })),
            get: vi.fn(async () => ({ windowId: 1 })),
            update: vi.fn(async () => ({}))
        },
        windows: { update: vi.fn(async () => ({})) }
    };
    (globalThis as any).chrome = chrome;
    vi.resetModules();
    await import('../../src/extension/background/index.js');
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function ask(request: any): Promise<any> {
    return new Promise((resolve) => {
        const async = messageListener(request, { id: 'ext-id' }, resolve);
        if (!async) setTimeout(() => resolve(undefined), 0);
    }).then((r) => r);
}

describe('background service worker', () => {
    it('connects to the native host and tracks server status', async () => {
        expect(ports).toHaveLength(1);
        expect(ports[0]!.posted).toEqual([{ command: 'status' }]);
        ports[0]!.deliver({ type: 'status', backend: true, appium: false });
        expect(broadcasts).toContainEqual({ type: 'server-status', status: { backend: true, appium: false } });

        let status: any;
        messageListener({ type: 'get-status' }, { id: 'ext-id' }, (r) => { status = r; });
        expect(status).toEqual({ backend: true, appium: false });
    });

    it('starts servers with normalized settings', async () => {
        const reply = ask({ type: 'start-server' });
        await vi.runAllTimersAsync();
        expect(await reply).toEqual({ success: true });
        expect(ports[0]!.posted.at(-1)).toEqual({ command: 'start', backendPort: '9000', appiumPort: 4800, fpsLimit: 30 });
    });

    it('broadcasts start errors and native logs', () => {
        ports[0]!.deliver({ type: 'start-result', backend: { success: true }, appium: { success: false, error: 'missing', code: 'APPIUM_NOT_FOUND' } });
        expect(broadcasts).toContainEqual({ type: 'server-start-error', errors: [{ server: 'Appium', error: 'missing', code: 'APPIUM_NOT_FOUND' }] });
        ports[0]!.deliver({ type: 'log', message: 'hello', level: 'warning' });
        expect(broadcasts.at(-1)).toMatchObject({ type: 'server-log', message: 'hello', level: 'warning' });
        let logs: any;
        messageListener({ type: 'request-logs' }, { id: 'ext-id' }, (r) => { logs = r; });
        expect(logs.logs).toHaveLength(1);
    });

    it('explains a missing companion and answers stop/start without a port', async () => {
        nativeAvailable = false;
        ports[0]!.drop('Specified native messaging host not found.');
        expect(broadcasts).toContainEqual({ type: 'native-host-error', error: 'Set up the local companion once with: npx appium-locators-inspector setup', needsHelp: true });
        expect(broadcasts.at(-1)).toMatchObject({ type: 'server-start-error', errors: [{ code: 'COMPANION_SETUP_REQUIRED' }] });

        let stop: any;
        messageListener({ type: 'stop-server' }, { id: 'ext-id' }, (r) => { stop = r; });
        expect(stop).toEqual({ success: false, error: 'Native host is not connected' });

        const start = ask({ type: 'start-server' });
        await vi.runAllTimersAsync();
        expect(await start).toMatchObject({ success: false, code: 'COMPANION_SETUP_REQUIRED' });

        const setup = ask({ type: 'check-setup' });
        await vi.runAllTimersAsync();
        expect(await setup).toMatchObject({ success: false, nativeHost: false });
    });

    it('runs the setup diagnosis through the native host', async () => {
        const setup = ask({ type: 'check-setup' });
        await vi.advanceTimersByTimeAsync(150);
        const request = ports[0]!.posted.at(-1);
        expect(request).toMatchObject({ command: 'diagnose', extensionId: 'ext-id' });
        ports[0]!.deliver({ type: 'diagnose-result', requestId: request.requestId, data: { backendInstalled: true } });
        expect(await setup).toEqual({ success: true, nativeHost: true, diagnostics: { backendInstalled: true } });
    });

    it('creates a device session and opens the inspector', async () => {
        const fetchMock = vi.fn(async () => ({ json: async () => ({ success: true, sessionId: 's1' }) }));
        vi.stubGlobal('fetch', fetchMock);
        let started: any;
        messageListener({ type: 'connect-device', deviceInfo: { id: 'emu', platform: 'android', name: 'Pixel', version: '15' } }, { id: 'ext-id' }, (r) => { started = r; });
        expect(started).toEqual({ started: true });
        await vi.runAllTimersAsync();
        expect(fetchMock).toHaveBeenCalledWith('http://localhost:9000/api/session/create', expect.objectContaining({ method: 'POST' }));
        expect(chrome.storage.local.set).toHaveBeenCalled();
        expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://ext-id/inspector/inspector.html' });
        expect(broadcasts).toContainEqual({ type: 'device-connection-result', success: true, device: 'Pixel' });
    });

    it('reports session failures', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: false, error: 'WDA failed' }) })));
        messageListener({ type: 'connect-device', deviceInfo: { id: 'emu', platform: 'android', name: 'Pixel', version: '15' } }, { id: 'ext-id' }, () => {});
        await vi.runAllTimersAsync();
        expect(broadcasts).toContainEqual({ type: 'device-connection-result', success: false, error: 'WDA failed' });

        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('refused'); }));
        messageListener({ type: 'connect-device', deviceInfo: { id: 'emu', platform: 'android', name: 'Pixel', version: '15' } }, { id: 'ext-id' }, () => {});
        await vi.runAllTimersAsync();
        expect(broadcasts).toContainEqual({ type: 'device-connection-result', success: false, error: 'refused' });
    });

    it('opens the logs tab once and focuses it afterwards', async () => {
        messageListener({ type: 'open-logs-tab' }, { id: 'ext-id' }, () => {});
        await vi.runAllTimersAsync();
        messageListener({ type: 'open-logs-tab' }, { id: 'ext-id' }, () => {});
        await vi.runAllTimersAsync();
        expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.update).toHaveBeenCalledWith(7, { active: true });
        expect(chrome.windows.update).toHaveBeenCalledWith(1, { focused: true });
    });

    it('ignores messages from other extensions', () => {
        const respond = vi.fn();
        expect(messageListener({ type: 'get-status' }, { id: 'someone-else' }, respond)).toBe(false);
        expect(respond).not.toHaveBeenCalled();
    });
});
