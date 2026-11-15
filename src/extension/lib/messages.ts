import type { DeviceInfo, LogLevel, SetupDiagnostics } from '../../shared/protocol.js';

export interface ServerStatus {
    backend: boolean;
    appium: boolean;
}

export interface ServerStartError {
    server?: string;
    error: string;
    code?: string;
}

export interface LogEntry {
    type: 'server-log';
    message: string;
    level: LogLevel;
    timestamp: number;
}

/** Requests sent by extension pages to the background service worker. */
export type BackgroundRequest =
    | { type: 'get-status' }
    | { type: 'check-setup' }
    | { type: 'start-server' }
    | { type: 'stop-server' }
    | { type: 'connect-device'; deviceInfo: DeviceInfo }
    | { type: 'open-logs-tab' }
    | { type: 'request-logs' };

export interface CommandResponse {
    success: boolean;
    error?: string;
    code?: string;
}

export interface SetupCheckResponse {
    success: boolean;
    nativeHost: boolean;
    diagnostics?: SetupDiagnostics;
    error?: string;
}

/** Broadcasts from the background to open pages. */
export type BackgroundEvent =
    | LogEntry
    | { type: 'initial-logs'; logs: LogEntry[] }
    | { type: 'server-status'; status: ServerStatus }
    | { type: 'server-start-error'; errors: ServerStartError[] }
    | { type: 'native-host-error'; error: string; needsHelp: boolean }
    | { type: 'native-host-unavailable'; error?: string }
    | { type: 'device-connection-result'; success: boolean; device?: string; error?: string };

/** Ask the background; rejects with Chrome's lastError when nobody answered. */
export function sendToBackground<T = unknown>(request: BackgroundRequest): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(request, (response: T | undefined) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) reject(new Error(lastError.message || 'No response from background'));
            else resolve(response);
        });
    });
}

/** Fire-and-forget broadcast; no page may be listening. */
export function broadcast(event: BackgroundEvent): void {
    chrome.runtime.sendMessage(event).catch(() => {});
}
