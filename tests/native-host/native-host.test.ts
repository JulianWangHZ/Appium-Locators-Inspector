import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { diagnoseSetup } from '../../src/native-host/diagnose.js';
import { buildSpawnEnv } from '../../src/native-host/environment.js';
import { decodeMessages, encodeMessage } from '../../src/native-host/messaging.js';

describe('native messaging framing', () => {
    it('round-trips messages, including multi-byte text', () => {
        const frame = encodeMessage({ command: 'status', note: '測試' });
        expect(frame.readUInt32LE(0)).toBe(frame.length - 4);
        expect(decodeMessages(frame)).toEqual({ messages: [{ command: 'status', note: '測試' }], rest: Buffer.alloc(0) });
    });

    it('decodes several frames and keeps a partial tail', () => {
        const a = encodeMessage({ command: 'start' });
        const b = encodeMessage({ command: 'stop' });
        const joined = Buffer.concat([a, b.subarray(0, 6)]);
        const first = decodeMessages(joined);
        expect(first.messages).toEqual([{ command: 'start' }]);
        const second = decodeMessages(Buffer.concat([first.rest, b.subarray(6)]));
        expect(second.messages).toEqual([{ command: 'stop' }]);
        expect(second.rest.length).toBe(0);
    });

    it('drops the buffer on an absurd length', () => {
        const bad = Buffer.alloc(8);
        bad.writeUInt32LE(0xffffffff, 0);
        const result = decodeMessages(bad);
        expect(result.error).toMatch('Invalid message length');
        expect(result.rest.length).toBe(0);
    });
});

describe('diagnoseSetup', () => {
    let dir = '';
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('reports a complete install that allows this extension', () => {
        dir = mkdtempSync(join(tmpdir(), 'ali-diag-'));
        mkdirSync(join(dir, 'backend', 'node_modules'), { recursive: true });
        mkdirSync(join(dir, 'native-host'));
        writeFileSync(join(dir, 'backend', 'server.js'), '');
        writeFileSync(join(dir, 'backend', 'package.json'), JSON.stringify({ version: '1.1.0' }));
        writeFileSync(join(dir, 'native-host', 'launcher.js'), '');
        writeFileSync(join(dir, 'native-host', 'com.appium_locators_inspector.host.json'),
            JSON.stringify({ allowed_origins: ['chrome-extension://abc/'] }));

        expect(diagnoseSetup(dir, 'abc')).toEqual({
            backendInstalled: true,
            dependenciesInstalled: true,
            launcherInstalled: true,
            manifestInstalled: true,
            extensionAllowed: true,
            manifestPath: join(dir, 'native-host', 'com.appium_locators_inspector.host.json'),
            hostName: 'com.appium_locators_inspector.host',
            backendPath: join(dir, 'backend'),
            installBase: dir,
            companionVersion: '1.1.0'
        });
        expect(diagnoseSetup(dir, 'other').extensionAllowed).toBe(false);
    });

    it('reports a missing install', () => {
        dir = mkdtempSync(join(tmpdir(), 'ali-diag-'));
        expect(diagnoseSetup(dir, 'abc')).toMatchObject({ backendInstalled: false, manifestInstalled: false, extensionAllowed: false, companionVersion: null });
    });
});

describe('buildSpawnEnv', () => {
    it('prepends tool paths and does not mutate the input env', () => {
        const env = { PATH: '/custom/bin', HOME: '/nonexistent' };
        const out = buildSpawnEnv(env);
        expect(env.PATH).toBe('/custom/bin');
        expect(out.PATH?.endsWith('/custom/bin')).toBe(true);
    });
});
