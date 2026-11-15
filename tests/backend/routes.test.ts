import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { request, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { AppiumSessions } from '../../src/backend/appium-client.js';
import { createBackendServer } from '../../src/backend/app.js';
import { ScreenMirror } from '../../src/backend/screen-mirror.js';
import { close, fakeAppium, listen } from './helpers.js';

let server: Server;
let shutdownCalls = 0;
let base: string;
let appium: Awaited<ReturnType<typeof fakeAppium>>;
let sourceCalls = 0;
let sessionCount = 0;
let captureFails = false;

beforeEach(async () => {
    shutdownCalls = 0;
    sourceCalls = 0;
    sessionCount = 0;
    captureFails = false;
    appium = await fakeAppium({
        'GET /status': () => ({ value: { ready: true } }),
        'POST /session': () => ({ value: { sessionId: `s${++sessionCount}` } }),
        'GET /session/s1/source': () => (++sourceCalls === 1
            ? { status: 404, value: { error: 'invalid session id', message: 'gone' } }
            : { value: '<a/>' }),
        'GET /session/s2/source': () => ({ value: '<recovered/>' }),
        'GET /session/s1/screenshot': () => ({ value: 'PNG' }),
        'POST /session/s1/execute/sync': () => ({ value: null }),
        'POST /session/s1/actions': () => ({ value: null }),
        'POST /session/s1/element': () => ({ value: { ELEMENT: 'e1' } }),
        'POST /session/s1/element/e1/clear': () => ({ status: 500, value: { error: 'invalid element state', message: 'nope' } }),
        'POST /session/s1/element/e1/value': () => ({ value: null }),
        'DELETE /session/s1': () => ({ status: 500, value: { error: 'unknown error', message: 'x' } }),
        'DELETE /session/s2': () => ({ value: null })
    });
    const mirror = new ScreenMirror(async () => {
        if (captureFails) throw new Error('adb gone');
        return 'IMG';
    });
    server = createBackendServer({ sessions: new AppiumSessions(appium.url), mirror, port: 4242, defaultFps: 30, heartbeatMs: 20, appiumUrl: appium.url, onShutdown: () => { shutdownCalls++; } });
    base = `http://127.0.0.1:${await listen(server)}`;
});
afterEach(async () => {
    await close(server);
    await appium.stop();
});

const post = async (path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
};
const createIos = () => post('/api/session/create', { deviceInfo: { id: 'SIM-1', platform: 'ios', name: 'iPhone', version: '27.2' } });

describe('REST routes', () => {
    it('reports Appium availability in /health and shuts down on request', async () => {
        const health = await (await fetch(`${base}/health`)).json();
        expect(health).toMatchObject({ status: 'ok', appiumAvailable: true });
        expect((await post('/api/shutdown', {})).body).toEqual({ success: true });
        await new Promise((r) => setImmediate(r));
        expect(shutdownCalls).toBe(1);
    });

    it('validates gesture, type and tap input', async () => {
        await createIos();
        expect((await post('/api/gesture', { deviceId: 'SIM-1' })).status).toBe(400);
        expect((await post('/api/gesture', { deviceId: 'SIM-1', gesture: 'explode' })).body.error).toBe('Unsupported gesture: explode');
        expect((await post('/api/gesture', { deviceId: 'SIM-1', gesture: 'swipe', direction: 'sideways' })).status).toBe(400);
        expect((await post('/api/gesture', { deviceId: 'SIM-1', gesture: 'doubleTap', x: 'a' })).status).toBe(400);
        expect((await post('/api/tap', { deviceId: 'SIM-1', x: 1 })).body.error).toBe('y must be a number');
        expect((await post('/api/type', { deviceId: 'SIM-1', text: 'a', strategy: 'css', value: 'x' })).body.error).toBe('Unsupported locator strategy');
        expect((await post('/api/tap', { x: 1, y: 1 })).body.error).toBe('deviceId required in request body');
    });

    it('runs gestures, keys and element typing against Appium', async () => {
        await createIos();
        expect((await post('/api/gesture', { deviceId: 'SIM-1', platform: 'ios', gesture: 'swipe', direction: 'up', left: 0, top: 1, width: 2, height: 3 })).body).toEqual({ success: true, deviceId: 'SIM-1' });
        expect(appium.requests.find((r) => r.url.endsWith('/execute/sync'))?.body).toEqual({ script: 'mobile: swipe', args: [{ direction: 'up' }] });
        expect((await post('/api/type', { deviceId: 'SIM-1', text: 'hi' })).body.success).toBe(true);
        expect((await post('/api/type', { deviceId: 'SIM-1', text: 'hi', strategy: 'accessibility id', value: 'email' })).body.success).toBe(true);
        expect(appium.requests.at(-1)).toMatchObject({ url: '/session/s1/element/e1/value', body: { text: 'hi' } });
        expect((await post('/api/gesture', { deviceId: 'nobody', gesture: 'longPress', x: 1, y: 1 })).status).toBe(500);
    });

    it('serves screenshots and validates query ids', async () => {
        await createIos();
        expect((await (await fetch(`${base}/api/screenshot?deviceId=SIM-1`)).json())).toEqual({ success: true, screenshot: 'PNG', deviceId: 'SIM-1' });
        expect((await fetch(`${base}/api/page-source`)).status).toBe(400);
        expect((await fetch(`${base}/api/page-source?deviceId=a;b`)).status).toBe(400);
        const status = await new Promise<number>((resolve, reject) => {
            const url = new URL(`${base}/health`);
            request({ host: url.hostname, port: url.port, path: '/health', headers: { Host: 'evil.example' } }, (res) => {
                res.resume();
                resolve(res.statusCode ?? 0);
            }).on('error', reject).end();
        });
        expect(status).toBe(403); // DNS-rebinding guard
    });

    it('closes all sessions and answers preflight requests', async () => {
        await createIos();
        expect((await post('/api/session/close', {})).body).toEqual({ success: true, deviceId: 'all' });
        const preflight = await fetch(`${base}/api/tap`, { method: 'OPTIONS', headers: { Origin: 'chrome-extension://abc' } });
        expect(preflight.status).toBe(204);
        expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
    });

    it('recreates a dead session and retries the page source', async () => {
        await createIos();
        const ws = new WebSocket(base.replace('http', 'ws'));
        const messages: any[] = [];
        ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
        await new Promise((r) => ws.on('open', r));
        ws.send(JSON.stringify({ type: 'start-streaming', platform: 'ios', deviceId: 'SIM-1', fps: 1 }));
        ws.send(JSON.stringify({ type: 'get-page-source' }));
        await expectEventually(() => messages.some((m) => m.type === 'page-source'));
        expect(messages).toContainEqual({ type: 'info', message: 'Session lost — reconnecting automatically...' });
        expect(messages).toContainEqual({ type: 'page-source', data: '<recovered/>', deviceId: 'SIM-1' });
        ws.close();
    });

    it('rejects bad WebSocket messages and stops streaming on request', async () => {
        const ws = new WebSocket(base.replace('http', 'ws'));
        const messages: any[] = [];
        ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
        await new Promise((r) => ws.on('open', r));
        ws.send('not json');
        ws.send(JSON.stringify({ type: 'nope' }));
        ws.send(JSON.stringify({ type: 'start-streaming' }));
        ws.send(JSON.stringify({ type: 'start-streaming', platform: 'ios', deviceId: '$(id)' }));
        ws.send(JSON.stringify({ type: 'stop-streaming' }));
        await expectEventually(() => messages.length >= 6);
        expect(messages.slice(1).map((m) => m.message ?? m.type)).toEqual([
            expect.stringContaining('JSON'), 'Unknown message type', 'Platform and deviceId required', 'Invalid platform or deviceId', 'streaming-stopped'
        ]);
        ws.close();
    });

    it('reports repeated capture failures to the client', async () => {
        captureFails = true;
        const ws = new WebSocket(base.replace('http', 'ws'));
        const messages: any[] = [];
        ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
        await new Promise((r) => ws.on('open', r));
        ws.send(JSON.stringify({ type: 'start-streaming', platform: 'android', deviceId: 'emu', fps: 30 }));
        await expectEventually(() => messages.some((m) => m.type === 'error'), 3000);
        expect(messages.find((m) => m.type === 'error')).toEqual({ type: 'error', message: 'Screen capture failed repeatedly. Device may be disconnected.', deviceId: 'emu' });
        ws.close();
    });
});

async function expectEventually(check: () => boolean, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    while (!check()) {
        if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
        await new Promise((r) => setTimeout(r, 10));
    }
}
