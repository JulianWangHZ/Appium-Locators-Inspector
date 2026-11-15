import type { ServerStatus } from '../lib/messages.js';

export interface Health {
    status?: string;
    adbAvailable?: boolean;
    iosToolsAvailable?: boolean;
    appiumAvailable?: boolean;
}

/** Running if the native host started it, or if the backend answers /health. */
export function combineStatus(native: ServerStatus, h: Health | null): ServerStatus {
    const backendUp = h?.status === 'ok';
    return { backend: native.backend || backendUp, appium: native.appium || (backendUp && !!h?.appiumAvailable) };
}
