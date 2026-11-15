import { afterEach, describe, expect, it } from 'vitest';
import { newSession, WebDriverError } from '../../src/backend/webdriver-client.js';
import { createServer } from 'node:http';
import { close, fakeAppium, listen } from './helpers.js';

const OPTS = { timeoutMs: 2000, retries: 0, commandTimeoutMs: 2000 };
let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });

describe('WebDriver client', () => {
    it('creates a session with W3C capabilities and runs commands', async () => {
        const fake = await fakeAppium({
            'POST /session': () => ({ value: { sessionId: 'abc', capabilities: {} } }),
            'GET /session/abc/source': () => ({ value: '<hierarchy/>' }),
            'POST /session/abc/element': () => ({ value: { 'element-6066-11e4-a52e-4f735466cecc': 'el-1' } }),
            'POST /session/abc/element/el-1/value': () => ({ value: null }),
            'DELETE /session/abc': () => ({ value: null })
        });
        stop = fake.stop;

        const session = await newSession(fake.url, { platformName: 'iOS' }, OPTS);
        expect(session.sessionId).toBe('abc');
        expect(fake.requests[0]?.body).toEqual({ capabilities: { alwaysMatch: { platformName: 'iOS' }, firstMatch: [{}] } });
        expect(await session.getPageSource()).toBe('<hierarchy/>');
        expect(await session.findElement('accessibility id', 'Login')).toBe('el-1');
        await session.elementSendKeys('el-1', 'hi');
        expect(fake.requests.at(-1)?.body).toEqual({ text: 'hi', value: ['h', 'i'] });
        await session.deleteSession();
    });

    it('surfaces WebDriver errors with their code so dead sessions are detectable', async () => {
        const fake = await fakeAppium({
            'POST /session': () => ({ value: { sessionId: 's1' } }),
            'GET /session/s1/source': () => ({ status: 404, value: { error: 'invalid session id', message: 'gone' } })
        });
        stop = fake.stop;
        const session = await newSession(fake.url, {}, OPTS);
        await expect(session.getPageSource()).rejects.toThrow('invalid session id: gone');
    });

    it('reports connection refused with the ECONNREFUSED code', async () => {
        const probe = createServer();
        const port = await listen(probe);
        await close(probe);
        const error = await newSession(`http://127.0.0.1:${port}`, {}, OPTS).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(WebDriverError);
        expect((error as Error).message).toContain('ECONNREFUSED');
    });
});
