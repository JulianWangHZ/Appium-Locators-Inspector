/** Types shared by the extension, the backend and the native host. */

export type Platform = 'android' | 'ios';

export interface DeviceInfo {
    id: string;
    platform: Platform;
    name: string;
    version: string;
    status?: string;
    appPackage?: string;
    appActivity?: string;
    bundleId?: string;
    teamId?: string;
    platformVersion?: string;
}

export type LocatorStrategy =
    | 'id'
    | 'resource-id'
    | 'accessibility id'
    | 'class name'
    | 'xpath'
    | '-android uiautomator'
    | '-ios predicate string'
    | '-ios class chain';

export interface DiagnosticCheck {
    name: string;
    ok: boolean;
    warn?: boolean;
    detail: string;
}

export type GestureName = 'doubleTap' | 'longPress' | 'swipe' | 'pinchOpen' | 'pinchClose';
export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

export interface DeviceRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/* ── WebSocket: client → backend ─────────────────────────── */
export type ClientMessage =
    | { type: 'start-streaming'; platform: Platform; deviceId: string; fps?: number }
    | { type: 'stop-streaming' }
    | { type: 'get-page-source' };

/* ── WebSocket: backend → client ─────────────────────────── */
export type ServerMessage =
    | { type: 'connected'; message: string; clientId: number }
    | { type: 'screenshot'; data: string; deviceId: string }
    | { type: 'page-source'; data: string; deviceId: string }
    | { type: 'streaming-started'; fps: number; deviceId: string }
    | { type: 'streaming-stopped' }
    | { type: 'info'; message: string }
    | { type: 'error'; message: string; deviceId?: string };

/* ── Native messaging: extension → host ──────────────────── */
export type NativeCommand =
    | { command: 'start'; backendPort?: number | string; appiumPort?: number; fpsLimit?: number }
    | { command: 'stop' }
    | { command: 'status' }
    | { command: 'diagnose'; requestId: number; extensionId: string };

export interface ProcessStartResult {
    success: boolean;
    pid?: number;
    message?: string;
    fps?: number;
    error?: string;
    code?: string;
}

export interface SetupDiagnostics {
    backendInstalled: boolean;
    dependenciesInstalled: boolean;
    launcherInstalled: boolean;
    manifestInstalled: boolean;
    extensionAllowed: boolean;
    manifestPath: string;
    hostName: string;
    backendPath: string;
    installBase: string;
    companionVersion: string | null;
}

/* ── Native messaging: host → extension ──────────────────── */
export type NativeMessage =
    | { type: 'status'; backend: boolean; appium: boolean }
    | { type: 'start-result'; backend: ProcessStartResult; appium: ProcessStartResult }
    | { type: 'stop-result'; data: { success: boolean; backendStopped: boolean; appiumStopped: boolean } }
    | { type: 'diagnose-result'; requestId: number; data: SetupDiagnostics }
    | { type: 'log'; message: string; level: LogLevel };

export type LogLevel = 'info' | 'warning' | 'error';
