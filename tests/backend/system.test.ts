import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.doUnmock('../../src/backend/exec.js');
    vi.doUnmock('node:child_process');
    vi.resetModules();
});

describe('device manager (mocked tools)', () => {
    it('lists android devices and simulators from tool output', async () => {
        vi.doMock('../../src/backend/exec.js', async (orig) => ({
            ...(await orig<typeof import('../../src/backend/exec.js')>()),
            runFile: vi.fn(async (file: string, args: string[]) => {
                if (file === 'adb' && args[0] === 'devices') return { stdout: 'List of devices attached\nemu-1 device\nbad;id device\n', stderr: '' };
                if (file === 'adb' && args.includes('ro.product.model')) return { stdout: 'Pixel 9\n', stderr: '' };
                if (file === 'adb') return { stdout: '15\n', stderr: '' };
                if (file === 'xcrun' && args[1] === 'list') return { stdout: JSON.stringify({ devices: { 'iOS-27-2': [{ udid: 'SIM-1', name: 'iPhone', state: 'Booted' }] } }), stderr: '' };
                return { stdout: '', stderr: '' };
            })
        }));
        const dm = await import('../../src/backend/device-manager.js');
        const all = await dm.listAllDevices();
        expect(all).toEqual([
            { id: 'emu-1', platform: 'android', name: 'Pixel 9', version: '15', status: 'connected' },
            ...(process.platform === 'win32' ? [] : [{ id: 'SIM-1', platform: 'ios', name: 'iPhone', version: '27.2', status: 'connected' }])
        ]);
        expect(await dm.isAdbAvailable()).toBe(true);
        expect(await dm.isAdbAvailable()).toBe(true); // cached
    });

    it('returns empty lists when tools fail', async () => {
        vi.doMock('../../src/backend/exec.js', async (orig) => ({
            ...(await orig<typeof import('../../src/backend/exec.js')>()),
            runFile: vi.fn(async () => { throw Object.assign(new Error('ENOENT'), { killed: false }); })
        }));
        const dm = await import('../../src/backend/device-manager.js');
        expect(await dm.listAndroidDevices()).toEqual([]);
        expect(await dm.listIOSSimulators()).toEqual([]);
        expect(await dm.isIOSToolsAvailable()).toBe(false);
    });
});

describe('diagnostics (mocked shell)', () => {
    it('builds the doctor report', async () => {
        const answers: Record<string, string | null> = {
            'command -v appium': '/opt/homebrew/bin/appium',
            'appium --version': '3.1.0',
            'appium driver list --installed 2>&1': '- uiautomator2@4\n- xcuitest@9',
            'command -v java': null,
            'command -v adb': '/usr/bin/adb',
            'command -v xcrun': '/usr/bin/xcrun',
            'xcode-select -p': '/Applications/Xcode.app',
            'xcodebuild -version 2>/dev/null': 'Xcode 27.0\nBuild 1',
            'xcrun simctl list devices available 2>/dev/null | grep -c -E "iPhone|iPad"': '4'
        };
        vi.doMock('../../src/backend/exec.js', async (orig) => ({
            ...(await orig<typeof import('../../src/backend/exec.js')>()),
            runShell: vi.fn(async (cmd: string) => answers[cmd] ?? null)
        }));
        const { gatherDiagnostics } = await import('../../src/backend/diagnostics.js');
        const checks = await gatherDiagnostics(8765, { JAVA_HOME: '/jdk' });
        const byName = Object.fromEntries(checks.map((c) => [c.name, c]));
        expect(byName['Appium (test server)']).toEqual({ name: 'Appium (test server)', ok: true, detail: 'on PATH (v3.1.0)' });
        expect(byName['Appium drivers']).toMatchObject({ ok: true, warn: false, detail: 'uiautomator2, xcuitest' });
        expect(byName['Java (UiAutomator2 JDK)']).toMatchObject({ ok: false, warn: true, detail: 'not found' });
        expect(byName['ANDROID_HOME']).toMatchObject({ ok: false, detail: 'not set' });
        expect(checks.at(-1)).toEqual({ name: 'Backend server', ok: true, detail: 'running on 8765' });
        if (process.platform === 'darwin') expect(byName['iOS simulators']).toMatchObject({ ok: true, detail: '4 available' });
    });
});

describe('exec helpers', () => {
    it('runs files and shell commands', async () => {
        const { runFile, runShell, errorMessage } = await import('../../src/backend/exec.js');
        expect((await runFile(process.execPath, ['-e', 'process.stdout.write("hi")'])).stdout).toBe('hi');
        await expect(runFile(process.execPath, ['-e', 'process.exit(3)'])).rejects.toThrow();
        expect(await runShell('echo shell-ok')).toBe('shell-ok');
        expect(await runShell('exit 1')).toBeNull();
        expect(errorMessage('x')).toBe('x');
    });
});

describe('screen capture', () => {
    it('rejects unsafe device ids before spawning anything', async () => {
        const { captureScreenBase64 } = await import('../../src/backend/screen-capture.js');
        await expect(captureScreenBase64('android', 'x; rm -rf /')).rejects.toThrow('Invalid deviceId');
        await expect(captureScreenBase64('windows' as any, 'emu')).rejects.toThrow('Unsupported platform');
    });

    it('reads PNG bytes from adb and simctl', async () => {
        vi.doMock('../../src/backend/exec.js', async (orig) => ({
            ...(await orig<typeof import('../../src/backend/exec.js')>()),
            runFile: vi.fn(async (_file: string, args: string[]) => {
                const { writeFileSync } = await import('node:fs');
                writeFileSync(args.at(-1)!, 'IOSPNG');
                return { stdout: '', stderr: '' };
            })
        }));
        vi.doMock('node:child_process', async (orig) => ({
            ...(await orig<typeof import('node:child_process')>()),
            spawn: () => spawn(process.execPath, ['-e', 'process.stdout.write("ANDROIDPNG")'])
        }));
        const { captureScreenBase64 } = await import('../../src/backend/screen-capture.js');
        expect(Buffer.from(await captureScreenBase64('android', 'emu-1'), 'base64').toString()).toBe('ANDROIDPNG');
        expect(Buffer.from(await captureScreenBase64('ios', 'SIM-1'), 'base64').toString()).toBe('IOSPNG');
    });
});

describe('native host port cleanup', () => {
    it.skipIf(process.platform === 'win32')('kills the process listening on a port', async () => {
        const probe = createServer();
        await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
        const port = (probe.address() as { port: number }).port;
        await new Promise<void>((r) => probe.close(() => r()));

        const child = spawn(process.execPath, ['-e', `require('net').createServer().listen(${port}, '127.0.0.1', () => console.log('up'))`]);
        await new Promise((r) => child.stdout.once('data', r));
        const exited = new Promise((r) => child.once('exit', r));

        const { killPortProcess, killProcessTree } = await import('../../src/native-host/ports.js');
        const logs: string[] = [];
        killPortProcess(port, (m) => logs.push(m));
        await exited;
        expect(logs[0]).toMatch(`on port ${port}`);
        killPortProcess(0, () => {}); // invalid port is ignored
        killProcessTree(undefined);
        killProcessTree(999_999_999); // already gone
    });
});
