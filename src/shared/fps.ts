export const DEFAULT_SCREEN_FPS = 3;
export const MIN_SCREEN_FPS = 1;
export const MAX_SCREEN_FPS = 30;

function toFiniteNumber(value: unknown): number {
    return value === '' || value == null ? NaN : Number(value);
}

function clampFps(value: number): number {
    return Math.min(MAX_SCREEN_FPS, Math.max(MIN_SCREEN_FPS, Math.round(value)));
}

/** Clamp a user/setting FPS value to [1, 30]; fall back when it is not a number. */
export function normalizeScreenFps(value: unknown, fallback: unknown = DEFAULT_SCREEN_FPS): number {
    const parsed = toFiniteNumber(value);
    if (Number.isFinite(parsed)) return clampFps(parsed);
    const parsedFallback = toFiniteNumber(fallback);
    return Number.isFinite(parsedFallback) ? clampFps(parsedFallback) : DEFAULT_SCREEN_FPS;
}
