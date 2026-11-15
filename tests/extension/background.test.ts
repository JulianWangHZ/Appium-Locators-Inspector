import { describe, expect, it, vi } from 'vitest';
import { LogHistory, MAX_LOG_HISTORY } from '../../src/extension/background/log-history.js';
import { explainDisconnect, startErrorsOf } from '../../src/extension/background/native-errors.js';
import { NativeHostClient } from '../../src/extension/background/native-host-client.js';

function fakePort() {
    const messageListeners: Array<(m: any) => void> = [];
    const disconnectListeners: Array<() => void> = [];
    return {
        posted: [] as any[],
        postMessage(m: any) { this.posted.push(m); },
        onMessage: { addListener: (fn: any) => messageListeners.push(fn) },
        onDisconnect: { addListener: (fn: any) => disconnectListeners.push(fn) },
        deliver: (m: any) => messageListeners.forEach((fn) => fn(m)),
        disconnect: () => disconnectListeners.forEach((fn) => fn())
    };
}

function withChrome(port: ReturnType<typeof fakePort> | Error) {
    (globalThis as any).chrome = {
        runtime: {
            lastError: undefined as undefined | { message: string },
            connectNative: () => {
                if (port instanceof Error) throw port;
                return port;
            }
        }
    };
    return (globalThis as any).chrome;
}

describe('NativeHostClient', () => {
    it('asks for status on connect and routes broadcast messages', () => {
        const port = fakePort();
        withChrome(port);
        const onMessage = vi.fn();
        const client = new NativeHostClient({ onMessage, onDisconnect: vi.fn(), onConnectFailed: vi.fn() });
        client.connect();
        expect(client.connected).toBe(true);
        expect(port.posted).toEqual([{ command: 'status' }]);
        port.deliver({ type: 'status', backend: true, appium: false });
        expect(onMessage).toHaveBeenCalledWith({ type: 'status', backend: true, appium: false });
    });

    it('matches responses to requests by requestId', async () => {
        const port = fakePort();
        withChrome(port);
        const onMessage = vi.fn();
        const client = new NativeHostClient({ onMessage, onDisconnect: vi.fn(), onConnectFailed: vi.fn() });
        client.connect();
        const pending = client.request({ command: 'diagnose', extensionId: 'abc' });
        const sent = port.posted.at(-1);
        expect(sent).toMatchObject({ command: 'diagnose', extensionId: 'abc' });
        port.deliver({ type: 'diagnose-result', requestId: sent.requestId, data: { ok: 1 } });
        await expect(pending).resolves.toMatchObject({ type: 'diagnose-result' });
        expect(onMessage).not.toHaveBeenCalled();
    });

    it('times out unanswered requests and fails fast when disconnected', async () => {
        const port = fakePort();
        const chrome = withChrome(port);
        const onDisconnect = vi.fn();
        const client = new NativeHostClient({ onMessage: vi.fn(), onDisconnect, onConnectFailed: vi.fn() });
        client.connect();
        await expect(client.request({ command: 'diagnose', extensionId: 'x' }, 10)).rejects.toThrow('did not respond');
        chrome.runtime.lastError = { message: 'Specified native messaging host not found.' };
        port.disconnect();
        expect(onDisconnect).toHaveBeenCalledWith('Specified native messaging host not found.');
        expect(client.connected).toBe(false);
        expect(client.post({ command: 'stop' })).toBe(false);
        await expect(client.request({ command: 'diagnose', extensionId: 'x' })).rejects.toThrow('not connected');
    });

    it('reports a connect failure', () => {
        withChrome(new Error('no permission'));
        const onConnectFailed = vi.fn();
        const client = new NativeHostClient({ onMessage: vi.fn(), onDisconnect: vi.fn(), onConnectFailed });
        client.connect();
        expect(onConnectFailed).toHaveBeenCalledWith('no permission');
        expect(client.connected).toBe(false);
    });
});

describe('native errors', () => {
    it('explains common native-host failures', () => {
        expect(explainDisconnect('Specified native messaging host not found.')).toMatchObject({ needsHelp: true });
        expect(explainDisconnect('Access to the specified native messaging host is forbidden.').message).toMatch('re-run the companion installer');
        expect(explainDisconnect('Native host has exited.').message).toMatch('Node.js');
        expect(explainDisconnect('weird')).toEqual({ message: 'weird', needsHelp: false });
    });

    it('collects start errors per server', () => {
        expect(startErrorsOf({ type: 'start-result', backend: { success: true }, appium: { success: false, error: 'missing', code: 'APPIUM_NOT_FOUND' } }))
            .toEqual([{ server: 'Appium', error: 'missing', code: 'APPIUM_NOT_FOUND' }]);
    });
});

describe('LogHistory', () => {
    it('keeps the newest entries only', () => {
        const history = new LogHistory();
        for (let i = 0; i < MAX_LOG_HISTORY + 5; i++) history.add(`m${i}`, undefined, i);
        const all = history.all();
        expect(all).toHaveLength(MAX_LOG_HISTORY);
        expect(all[0]).toEqual({ type: 'server-log', message: 'm5', level: 'info', timestamp: 5 });
        all.pop();
        expect(history.all()).toHaveLength(MAX_LOG_HISTORY);
    });
});
