import type { DeviceInfo } from '../shared/protocol.js';
import { isValidDeviceId } from '../shared/validation.js';
import { errorMessage, runFile } from './exec.js';

const EXEC_TIMEOUT_MS = 15_000;
const TOOL_CHECK_TIMEOUT_MS = 5_000;
const TOOL_CHECK_CACHE_MS = 10_000;

function logListError(tool: string, error: unknown): void {
    const killed = (error as { killed?: boolean }).killed;
    console.error(killed ? `${tool} command timed out` : `Error listing devices via ${tool}: ${errorMessage(error)}`);
}

/** Parse `adb devices -l` output into ready device serials. */
export function parseAdbDevices(output: string): string[] {
    return output
        .split('\n')
        .slice(1)
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length >= 2 && parts[1] === 'device')
        .map((parts) => parts[0] as string);
}

/** "com.apple.CoreSimulator.SimRuntime.iOS-17-5" or "iOS 17.5" → "17.5". */
export function extractIOSVersion(runtime: string): string {
    const match = runtime.match(/iOS[.\s-]*(\d+(?:[.-]\d+)*)/i);
    return match?.[1]?.replace(/-/g, '.') ?? 'Unknown';
}

interface SimctlDevices {
    devices: Record<string, Array<{ udid: string; name: string; state: string }>>;
}

export function parseBootedSimulators(json: string): DeviceInfo[] {
    const data = JSON.parse(json) as SimctlDevices;
    return Object.entries(data.devices ?? {}).flatMap(([runtime, devices]) =>
        devices
            .filter((device) => device.state === 'Booted' && isValidDeviceId(device.udid))
            .map((device): DeviceInfo => ({
                id: device.udid,
                platform: 'ios',
                name: device.name,
                version: extractIOSVersion(runtime),
                status: 'connected'
            }))
    );
}

async function getAndroidProp(deviceId: string, prop: string): Promise<string> {
    const { stdout } = await runFile('adb', ['-s', deviceId, 'shell', 'getprop', prop], EXEC_TIMEOUT_MS);
    return stdout.trim();
}

async function describeAndroidDevice(deviceId: string): Promise<DeviceInfo> {
    try {
        const [model, version] = await Promise.all([
            getAndroidProp(deviceId, 'ro.product.model'),
            getAndroidProp(deviceId, 'ro.build.version.release')
        ]);
        return { id: deviceId, platform: 'android', name: model || deviceId, version: version || 'Unknown', status: 'connected' };
    } catch {
        return { id: deviceId, platform: 'android', name: deviceId, version: 'Unknown', status: 'connected' };
    }
}

export async function listAndroidDevices(): Promise<DeviceInfo[]> {
    try {
        const { stdout } = await runFile('adb', ['devices', '-l'], EXEC_TIMEOUT_MS);
        const serials = parseAdbDevices(stdout).filter((id) => {
            if (isValidDeviceId(id)) return true;
            console.warn(`Skipping device with invalid ID: ${id}`);
            return false;
        });
        return Promise.all(serials.map(describeAndroidDevice));
    } catch (error) {
        logListError('adb', error);
        return [];
    }
}

export async function listIOSSimulators(): Promise<DeviceInfo[]> {
    if (process.platform === 'win32') return [];
    try {
        const { stdout } = await runFile('xcrun', ['simctl', 'list', 'devices', 'booted', '--json'], EXEC_TIMEOUT_MS);
        return parseBootedSimulators(stdout);
    } catch (error) {
        logListError('xcrun', error);
        return [];
    }
}

export async function listAllDevices(): Promise<DeviceInfo[]> {
    const [android, ios] = await Promise.all([listAndroidDevices(), listIOSSimulators()]);
    return [...android, ...ios];
}

function cachedCheck(check: () => Promise<boolean>): () => Promise<boolean> {
    let cache: { value: boolean; at: number } | null = null;
    return async () => {
        if (cache && Date.now() - cache.at < TOOL_CHECK_CACHE_MS) return cache.value;
        const value = await check();
        cache = { value, at: Date.now() };
        return value;
    };
}

async function succeeds(file: string, args: string[]): Promise<boolean> {
    try {
        await runFile(file, args, TOOL_CHECK_TIMEOUT_MS);
        return true;
    } catch {
        return false;
    }
}

export const isAdbAvailable = cachedCheck(() => succeeds('adb', ['version']));
export const isIOSToolsAvailable = cachedCheck(async () =>
    process.platform !== 'win32' && succeeds('xcrun', ['simctl', 'help'])
);
