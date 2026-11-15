/** adb serials, simulator UDIDs and emulator-host:port ids. Blocks shell metacharacters. */
const DEVICE_ID_PATTERN = /^[a-zA-Z0-9._:-]+$/;

export function isValidDeviceId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 128 && DEVICE_ID_PATTERN.test(value);
}

export function parsePort(value: unknown, fallback: number): number {
    const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

export function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}
