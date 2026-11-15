import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeMessages, encodeMessage } from '../../src/native-host/messaging.js';

let base = '';
let host: ChildProcessWithoutNullStreams;
let buffered: Buffer = Buffer.alloc(0);
const inbox: any[] = [];

async function freePort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((r) => probe.close(() => r()));
    return port;
}

async function waitFor(predicate: (m: any) => boolean, timeoutMs = 5000): Promise<any> {
    const start = Date.now();
    for (;;) {
        const hit = inbox.find(predicate);
        if (hit) return hit;
        if (Date.now() - start > timeoutMs) throw new Error(`no matching message; got ${JSON.stringify(inbox.map((m) => m.type))}`);
        await new Promise((r) => setTimeout(r, 20));
    }
}

beforeAll(async () => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'ali-host-e2e-')));
    mkdirSync(join(base, 'native-host'));
    mkdirSync(join(base, 'backend'));
    // A stand-in backend: listens on PORT like the real one and logs a line.
    writeFileSync(join(base, 'backend', 'server.js'),
        "require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('fake backend on '+process.env.PORT+' fps '+process.env.SCREEN_FPS));");
    writeFileSync(join(base, 'backend', 'package.json'), JSON.stringify({ version: '9.9.9' }));
    await build({
        entryPoints: [join(import.meta.dirname, '..', '..', 'src', 'native-host', 'launcher.ts')],
        outfile: join(base, 'native-host', 'launcher.js'),
        bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'silent'
    });
    host = spawn(process.execPath, [join(base, 'native-host', 'launcher.js')], { env: { HOME: base, PATH: '' } });
    host.stdout.on('data', (chunk: Buffer) => {
        const { messages, rest } = decodeMessages(Buffer.concat([buffered, chunk]));
        buffered = rest;
        inbox.push(...messages);
    });
});

afterAll(() => {
    host?.kill();
    rmSync(base, { recursive: true, force: true });
});

const send = (msg: unknown) => host.stdin.write(encodeMessage(msg));

describe('native host launcher (real process)', () => {
    it('announces itself and reports status', async () => {
        await waitFor((m) => m.type === 'log' && m.message.includes('Native host launcher started'));
        send({ command: 'status' });
        expect(await waitFor((m) => m.type === 'status')).toMatchObject({ type: 'status', backend: false });
    });

    it('diagnoses the install for an extension id', async () => {
        send({ command: 'diagnose', requestId: 41, extensionId: 'abc' });
        const result = await waitFor((m) => m.type === 'diagnose-result' && m.requestId === 41);
        expect(result.data).toMatchObject({ backendInstalled: true, launcherInstalled: true, manifestInstalled: false, companionVersion: '9.9.9', installBase: base });
    });

    it('starts the backend with the requested port and FPS, then stops it', async () => {
        const port = await freePort();
        // Appium is started too when installed; a free port keeps any running Appium untouched.
        send({ command: 'start', backendPort: port, appiumPort: await freePort(), fpsLimit: 99 });
        const started = await waitFor((m) => m.type === 'start-result');
        expect(started.backend).toMatchObject({ success: true });
        expect(started.appium.success || started.appium.code === 'APPIUM_NOT_FOUND').toBe(true);
        await waitFor((m) => m.type === 'log' && m.message.includes(`fake backend on ${port} fps 30`));
        expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe('ok');

        send({ command: 'stop' });
        expect((await waitFor((m) => m.type === 'stop-result')).data).toMatchObject({ success: true, backendStopped: true });
        await waitFor((m) => m.type === 'log' && m.message.includes('Backend process exited'));
    });

    it('survives malformed frames', async () => {
        const bad = Buffer.alloc(4);
        bad.writeUInt32LE(3, 0);
        host.stdin.write(Buffer.concat([bad, Buffer.from('{x}')]));
        await waitFor((m) => m.type === 'log' && m.message.includes('Invalid JSON message'));
        send({ command: 'status' });
        inbox.length = 0;
        send({ command: 'status' });
        await waitFor((m) => m.type === 'status');
    });
});
