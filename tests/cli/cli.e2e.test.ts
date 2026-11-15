import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main } from '../../src/cli/cli.js';
import { runCompanion } from '../../src/cli/start.js';

let pkg = '';

async function freePort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((r) => probe.close(() => r()));
    return port;
}

async function until(check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
    const start = Date.now();
    while (!(await check())) {
        if (Date.now() - start > ms) throw new Error('timed out');
        await new Promise((r) => setTimeout(r, 25));
    }
}

beforeAll(() => {
    pkg = mkdtempSync(join(tmpdir(), 'ali-cli-'));
    mkdirSync(join(pkg, 'backend'));
    writeFileSync(join(pkg, 'package.json'), '{"version":"1.2.0"}');
    // Stand-in backend: serves /health and exits on POST /api/shutdown, like the real one.
    writeFileSync(join(pkg, 'backend', 'server.js'), `
        const http = require('http');
        const server = http.createServer((req, res) => {
            if (req.url === '/api/shutdown') { res.end('{"success":true}'); setImmediate(() => process.exit(0)); return; }
            res.end(JSON.stringify({ status: 'ok', fps: process.env.SCREEN_FPS, appiumPort: process.env.APPIUM_PORT }));
        });
        server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log('listening ' + process.env.PORT));
    `);
});
afterAll(() => rmSync(pkg, { recursive: true, force: true }));

function capture() {
    const lines: string[] = [];
    return { lines, out: { log: (l: string) => lines.push(l), error: (l: string) => lines.push(`ERR ${l}`) } };
}

describe('companion start', () => {
    it('runs the backend in the foreground and exits when the extension asks it to stop', async () => {
        const port = await freePort();
        const appiumPort = await freePort();
        const { lines, out } = capture();
        const running = runCompanion(pkg, { port, appiumPort, fps: 30, appium: false, verbose: false, appiumLogFile: join(pkg, 'appium.log') }, out);

        await until(() => lines.some((l) => l === `[backend] listening ${port}`));
        const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
        expect(health).toEqual({ status: 'ok', fps: '30', appiumPort: String(appiumPort) });
        expect(lines).toContain('Appium Locators Inspector companion is running.');

        await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST' });
        expect(await running).toBe(0);
    });

    it('reuses an Appium server that is already running', async () => {
        const appium = createServer().listen(0, '127.0.0.1');
        await new Promise((r) => appium.once('listening', r));
        const appiumPort = (appium.address() as { port: number }).port;
        const port = await freePort();
        const { lines, out } = capture();
        const running = runCompanion(pkg, { port, appiumPort, fps: 3, appium: true, verbose: false, appiumLogFile: join(pkg, 'appium.log') }, out);
        await until(() => lines.some((l) => l.startsWith('[backend] listening')));
        expect(lines).toContain(`Using the Appium server already running on port ${appiumPort}.`);
        await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST' });
        expect(await running).toBe(0);
        appium.close();
    });

    it('refuses a busy backend port', async () => {
        const busy = createServer().listen(0, '127.0.0.1');
        await new Promise((r) => busy.once('listening', r));
        const port = (busy.address() as { port: number }).port;
        const { lines, out } = capture();
        expect(await runCompanion(pkg, { port, appiumPort: 1, fps: 3, appium: false, verbose: false, appiumLogFile: join(pkg, 'appium.log') }, out)).toBe(1);
        expect(lines[0]).toBe(`ERR Port ${port} is already in use. Is the companion already running?`);
        busy.close();
    });

    it.skipIf(process.platform === 'win32')('starts a found Appium and writes its log to a file unless --verbose', async () => {
        const bin = join(pkg, 'bin');
        mkdirSync(bin, { recursive: true });
        const fakeAppium = join(bin, 'appium');
        writeFileSync(fakeAppium, `#!/bin/sh\necho "fake appium $@"\nexit 3\n`, { mode: 0o755 });
        process.env.APPIUM_PATH = fakeAppium;
        try {
            for (const verbose of [false, true]) {
                const port = await freePort();
                const appiumPort = await freePort();
                const logFile = join(pkg, `appium-${verbose}.log`);
                const { lines, out } = capture();
                const running = runCompanion(pkg, { port, appiumPort, fps: 3, appium: true, verbose, appiumLogFile: logFile }, out);
                await until(() => lines.some((l) => l.includes('Appium exited with code 3')));
                if (verbose) expect(lines).toContain(`[appium] fake appium --port ${appiumPort}`);
                else expect(readFileSync(logFile, 'utf8')).toBe(`fake appium --port ${appiumPort}\n`);
                await until(() => lines.some((l) => l.startsWith('[backend] listening')));
                await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST' });
                expect(await running).toBe(0);
            }
        } finally {
            delete process.env.APPIUM_PATH;
        }
    });
});

describe('cli main', () => {
    it('prints help, version and rejects unknown input', async () => {
        const logs: string[] = [];
        const original = { log: console.log, error: console.error };
        console.log = (l: string) => logs.push(l);
        console.error = (l: string) => logs.push(`ERR ${l}`);
        try {
            expect(await main(['--help'], pkg)).toBe(0);
            expect(logs.at(-1)).toContain('npx appium-locators-inspector setup');
            expect(await main(['-v'], pkg)).toBe(0);
            expect(logs.at(-1)).toBe('1.2.0');
            expect(await main(['bogus'], pkg)).toBe(2);
            expect(logs).toContain('ERR Unknown command: bogus');
            expect(await main(['--nope'], pkg)).toBe(2);
            expect(await main(['setup', '--extension-id', 'bad'], pkg).catch((e: Error) => e.message)).toMatch('Invalid Chrome extension ID');
        } finally {
            Object.assign(console, original);
        }
    });

    it('stops the backend on Ctrl+C', async () => {
        const port = await freePort();
        // Run the CLI as a real process to exercise the signal handling.
        const { build } = await import('esbuild');
        const cli = join(pkg, 'cli.js');
        await build({ entryPoints: [join(import.meta.dirname, '..', '..', 'src', 'cli', 'index.ts')], outfile: cli, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
        const child = spawn(process.execPath, [cli, '--port', String(port), '--no-appium']);
        let output = '';
        child.stdout.on('data', (d) => { output += d; });
        await until(() => output.includes(`listening ${port}`));
        child.kill('SIGINT');
        const code = await new Promise((r) => child.once('exit', r));
        expect(output).toContain('Stopping');
        expect(code).not.toBeNull();
        await until(async () => !(await fetch(`http://127.0.0.1:${port}/health`).then(() => true, () => false)));
    });
});
