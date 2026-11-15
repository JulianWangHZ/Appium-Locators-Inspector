import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NativeMessage } from '../../src/shared/protocol.js';
import { ServerProcesses } from '../../src/native-host/server-processes.js';

let base = '';
afterEach(() => rmSync(base, { recursive: true, force: true }));

async function freePort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((r) => probe.close(() => r()));
    return port;
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
    const start = Date.now();
    while (!check()) {
        if (Date.now() - start > ms) throw new Error('timed out');
        await new Promise((r) => setTimeout(r, 20));
    }
}

function setup(serverJs: string) {
    base = mkdtempSync(join(tmpdir(), 'ali-proc-'));
    mkdirSync(join(base, 'backend'));
    writeFileSync(join(base, 'backend', 'server.js'), serverJs);
    const logs: Array<{ message: string; level?: string }> = [];
    const sent: NativeMessage[] = [];
    const procs = new ServerProcesses({
        installBase: base,
        env: { ...process.env, PATH: '' },
        nodePath: process.execPath,
        log: (message, level) => logs.push({ message, level }),
        send: (m) => sent.push(m)
    });
    return { procs, logs, sent };
}

describe('ServerProcesses', () => {
    it('starts the backend once with normalized settings and stops it', async () => {
        const { procs, logs, sent } = setup("console.log('fps='+process.env.SCREEN_FPS+' appium='+process.env.APPIUM_PORT); setInterval(()=>{}, 1000);");
        const port = await freePort();
        const first = procs.startBackend(port, '4800', '0');
        expect(first.success).toBe(true);
        expect(procs.backendRunning).toBe(true);
        expect(procs.startBackend(port, 4800, 3)).toMatchObject({ success: true, message: 'Backend already running', fps: 1 });
        await until(() => logs.some((l) => l.message === '[Backend] fps=1 appium=4800'));

        expect(procs.stopAll()).toEqual({ success: true, backendStopped: true, appiumStopped: false });
        expect(procs.backendRunning).toBe(false);
        await until(() => sent.some((m) => m.type === 'status'));
    });

    it('flags missing backend dependencies and reports the exit', async () => {
        const { procs, logs, sent } = setup("console.error(\"Error: Cannot find module 'express'\"); process.exit(1);");
        procs.startBackend(await freePort(), undefined, undefined);
        await until(() => sent.some((m) => m.type === 'status'));
        expect(logs.some((l) => l.message.startsWith('ACTION REQUIRED') && l.level === 'error')).toBe(true);
        expect(logs.some((l) => l.message === 'Backend process exited with code 1' && l.level === 'warning')).toBe(true);
        expect(procs.backendRunning).toBe(false);
    });

    it('reports a backend that cannot be spawned', async () => {
        const { procs, logs } = setup('');
        const broken = new ServerProcesses({ installBase: base, env: {}, nodePath: join(base, 'no-such-node'), log: (m, l) => logs.push({ message: m, level: l }), send: () => {} });
        expect(broken.startBackend(await freePort(), 4723, 3).success).toBe(true);
        await until(() => logs.some((l) => l.message.startsWith('Backend process error')));
        expect(broken.backendRunning).toBe(false);
    });
});
