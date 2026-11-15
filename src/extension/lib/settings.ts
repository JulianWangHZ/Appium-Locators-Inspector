import { DEFAULT_APPIUM_PORT, DEFAULT_APPIUM_URL, DEFAULT_BACKEND_PORT } from '../../shared/defaults.js';
import { DEFAULT_SCREEN_FPS, normalizeScreenFps } from '../../shared/fps.js';
import { parsePort } from '../../shared/validation.js';

export interface Settings {
    /** Stored as typed in the options page (may be a string). */
    backendPort: number | string;
    appiumUrl: string;
    fpsLimit: number;
}

export const DEFAULT_SETTINGS: Settings = {
    backendPort: DEFAULT_BACKEND_PORT,
    appiumUrl: DEFAULT_APPIUM_URL,
    fpsLimit: DEFAULT_SCREEN_FPS
};

export const normalizeFpsLimit = normalizeScreenFps;

export async function loadSettings(): Promise<Settings> {
    return (await chrome.storage.sync.get({ ...DEFAULT_SETTINGS })) as Settings;
}

export function backendPortOf(settings: Pick<Settings, 'backendPort'>): number {
    return parsePort(settings.backendPort, DEFAULT_BACKEND_PORT);
}

export function backendHttpUrl(port: number): string {
    return `http://localhost:${port}`;
}

export function backendWsUrl(port: number): string {
    return `ws://localhost:${port}`;
}

export function appiumPortOf(appiumUrl: string): number {
    try {
        return parsePort(new URL(appiumUrl).port, DEFAULT_APPIUM_PORT);
    } catch {
        return DEFAULT_APPIUM_PORT;
    }
}

export async function loadBackendUrl(): Promise<string> {
    return backendHttpUrl(backendPortOf(await loadSettings()));
}
