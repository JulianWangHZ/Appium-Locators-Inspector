import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Platform } from '../shared/protocol.js';
import { isValidDeviceId } from '../shared/validation.js';
import { runFile } from './exec.js';

const CAPTURE_TIMEOUT_MS = 10_000;

/** PNG bytes from `adb exec-out screencap -p`. */
export function captureAndroidScreen(deviceId: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const adb = spawn('adb', ['-s', deviceId, 'exec-out', 'screencap', '-p']);
        const chunks: Buffer[] = [];
        let settled = false;
        const settle = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn();
        };
        const timer = setTimeout(() => settle(() => {
            adb.kill('SIGKILL');
            reject(new Error('ADB screenshot timed out'));
        }), CAPTURE_TIMEOUT_MS);

        adb.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        adb.stderr.on('data', (data: Buffer) => console.error(`ADB Error: ${data}`));
        adb.on('error', (error) => settle(() => reject(error)));
        adb.on('close', (code) => settle(() => {
            if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
            else reject(new Error(`ADB process exited with code ${code}`));
        }));
    });
}

/** PNG bytes from `xcrun simctl io <udid> screenshot` (it cannot write to stdout). */
export async function captureIOSScreen(udid: string): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), 'ali-screen-'));
    const file = join(dir, 'screen.png');
    try {
        await runFile('xcrun', ['simctl', 'io', udid, 'screenshot', file], CAPTURE_TIMEOUT_MS);
        return await readFile(file);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

export async function captureScreenBase64(platform: Platform, deviceId: string): Promise<string> {
    if (!isValidDeviceId(deviceId)) throw new Error('Invalid deviceId');
    const image = platform === 'android'
        ? await captureAndroidScreen(deviceId)
        : platform === 'ios'
            ? await captureIOSScreen(deviceId)
            : null;
    if (!image) throw new Error('Unsupported platform');
    return image.toString('base64');
}
