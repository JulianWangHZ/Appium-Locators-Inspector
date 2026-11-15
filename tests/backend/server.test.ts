import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { WebSocket } from 'ws';
import { AppiumSessions } from '../../src/backend/appium-client.js';
import { createBackendServer } from '../../src/backend/app.js';
import { ScreenMirror } from '../../src/backend/screen-mirror.js';
import { close, fakeAppium, listen } from './helpers.js';

let server: Server;
let base: string;
let appium: Awaited<ReturnType<typeof fakeAppium>>;

beforeEach(async () => {
    appium = await fakeAppium({
        'POST /session': () => ({ value: { sessionId: 's1' } }),
        'GET /session/s1/source': () => ({ value: '<hierarchy><node/></hierarchy>' }),
        'POST /session/s1/actions': () => ({ value: null }),
        'DELETE /session/s1/actions': () => ({ value: null }),
        'DELETE /session/s1': () => ({ value: null })
    });
    const mirror = new ScreenMirror(async () => 'BASE64PNG');
    server = createBackendServer({ sessions: new AppiumSessions(appium.url), mirror, port: 0, defaultFps: 30, heartbeatMs: 60_000 });
    const port = await listen(server);
    base = `http://127.0.0.1:${port}`;
});
afterEach(async () => {
    await close(server);
    await appium.stop();
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('HTTP API', () => {
    it('rejects requests from web pages', async () => {
        const res = await post('/api/tap', { deviceId: 'emu', x: 1, y: 1 }, { Origin: 'https://evil.example' });
        expect(res.status).toBe(403);
    });

    it('allows extension origins and echoes CORS headers', async () => {
        const res = await fetch(`${base}/api/devices/bogus`, { headers: { Origin: 'chrome-extension://abc' } });
        expect(res.status).toBe(400);
        expect(res.headers.get('access-control-allow-origin')).toBe('chrome-extension://abc');
        expect(await res.json()).toEqual({ success: false, error: 'Invalid platform' });
    });

    it('validates device ids before they reach a shell', async () => {
        const res = await post('/api/session/create', { deviceInfo: { id: 'x;reboot', platform: 'android' } });
        expect(res.status).toBe(400);
    });

    it('creates a session, taps, and keeps the legacy response shape', async () => {
        const created = await (await post('/api/session/create', { deviceInfo: { id: 'emu-1', platform: 'android', name: 'Pixel', version: '14' } })).json();
        expect(created).toEqual({ success: true, sessionId: 's1', deviceId: 'emu-1' });

        const tap = await post('/api/tap', { deviceId: 'emu-1', x: 10, y: 20 });
        expect(await tap.json()).toEqual({ success: true, deviceId: 'emu-1' });
        const actions = appium.requests.find((r) => r.url === '/session/s1/actions' && r.method === 'POST');
        expect(actions?.body).toMatchObject({ actions: [{ type: 'pointer', actions: [{ type: 'pointerMove', x: 10, y: 20 }, {}, {}, {}] }] });

        const missingText = await post('/api/type', { deviceId: 'emu-1', text: '' });
        expect(missingText.status).toBe(400);

        const closed = await (await post('/api/session/close', { deviceId: 'emu-1' })).json();
        expect(closed).toEqual({ success: true, deviceId: 'emu-1' });
    });
});

describe('WebSocket', () => {
    function open(origin?: string): Promise<{ ws: WebSocket; next: () => Promise<any> }> {
        const ws = new WebSocket(base.replace('http', 'ws'), origin ? { origin } : {});
        const queue: any[] = [];
        const waiters: Array<(v: any) => void> = [];
        ws.on('message', (raw) => {
            const msg = JSON.parse(raw.toString());
            const w = waiters.shift();
            if (w) w(msg); else queue.push(msg);
        });
        const next = () => new Promise<any>((resolve) => {
            const m = queue.shift();
            if (m) resolve(m); else waiters.push(resolve);
        });
        return new Promise((resolve, reject) => {
            ws.on('open', () => resolve({ ws, next }));
            ws.on('error', reject);
        });
    }

    it('refuses web-page origins', async () => {
        await expect(open('https://evil.example')).rejects.toThrow();
    });

    it('streams screenshots and serves page source for the streaming device', async () => {
        await post('/api/session/create', { deviceInfo: { id: 'emu-1', platform: 'android', name: 'Pixel', version: '14' } });
        const { ws, next } = await open('chrome-extension://abc');
        expect((await next()).type).toBe('connected');

        ws.send(JSON.stringify({ type: 'get-page-source' }));
        expect((await next()).message).toMatch('Start streaming first');

        ws.send(JSON.stringify({ type: 'start-streaming', platform: 'android', deviceId: 'emu-1', fps: 99 }));
        expect(await next()).toEqual({ type: 'streaming-started', fps: 30, deviceId: 'emu-1' });
        expect(await next()).toEqual({ type: 'screenshot', data: 'BASE64PNG', deviceId: 'emu-1' });

        ws.send(JSON.stringify({ type: 'get-page-source' }));
        let msg = await next();
        while (msg.type === 'screenshot') msg = await next();
        expect(msg).toEqual({ type: 'page-source', data: '<hierarchy><node/></hierarchy>', deviceId: 'emu-1' });
        ws.close();
    });
});
