import type { ServerMessage } from '../../shared/protocol.js';
import { DEFAULT_SCREEN_FPS } from '../../shared/fps.js';
import { loadSettings, normalizeFpsLimit } from '../lib/settings.js';
import { dom } from './dom.js';
import { showNotification } from './notify.js';
import { state } from './state.js';

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_MAX_ATTEMPTS = 50;
const PAGE_SOURCE_TIMEOUT_MS = 15_000;

export interface ConnectionHandlers {
    onScreenshot: (base64: string) => void;
    onPageSource: (xml: string) => void;
    onStreamStarted: () => void;
}

let ws: WebSocket | null = null;
let handlers: ConnectionHandlers | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;
let pageSourceTimer: ReturnType<typeof setTimeout> | null = null;

export function isConnected(): boolean {
    return ws !== null && ws.readyState === WebSocket.OPEN;
}

function sendJson(message: Record<string, unknown>): void {
    ws?.send(JSON.stringify(message));
}

function updateConnectionStatus(connected: boolean): void {
    dom.connectionDot.classList.toggle('connected', connected);
    dom.connectionStatus.textContent = connected ? 'Connected' : 'Disconnected';
}

export function connect(h: ConnectionHandlers): void {
    handlers = h;
    openSocket();
}

function openSocket(): void {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    try {
        ws = new WebSocket(state.wsUrl);
    } catch (error) {
        console.error('WebSocket creation failed:', error);
        scheduleReconnect();
        return;
    }

    ws.onopen = () => {
        reconnectAttempts = 0;
        intentionalClose = false;
        updateConnectionStatus(true);
        showNotification('Connected to backend', 'success');
        void startStreaming();
    };
    ws.onmessage = (event: MessageEvent<string>) => {
        try {
            handleMessage(JSON.parse(event.data) as ServerMessage);
        } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
        }
    };
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus(false);
    };
    ws.onclose = (event) => {
        console.log('WebSocket disconnected, code:', event.code);
        updateConnectionStatus(false);
        if (!intentionalClose) scheduleReconnect();
    };
}

function scheduleReconnect(): void {
    if (reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
        showNotification('Connection lost. Please refresh the page.', 'error');
        return;
    }
    // Exponential backoff with jitter.
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts + Math.random() * 1000, RECONNECT_MAX_DELAY_MS);
    reconnectAttempts++;
    showNotification(`Reconnecting... (attempt ${reconnectAttempts})`, 'warning');
    reconnectTimer = setTimeout(openSocket, delay);
}

function handleMessage(message: ServerMessage): void {
    // Ignore messages for other devices.
    if ('deviceId' in message && message.deviceId && state.session && message.deviceId !== state.session.device.id) return;

    switch (message.type) {
        case 'screenshot':
            handlers?.onScreenshot(message.data);
            return;
        case 'page-source':
            handlers?.onPageSource(message.data);
            return;
        case 'streaming-started':
            state.currentStreamFps = normalizeFpsLimit(message.fps, state.currentStreamFps || DEFAULT_SCREEN_FPS);
            // The server has bound this socket to the device; page source is safe to ask for now.
            handlers?.onStreamStarted();
            return;
        case 'error':
            console.error('Backend error:', message.message);
            showNotification(`Error: ${message.message}`, 'error');
            if (state.isLoadingPageSource) finishPageSourceLoad();
            return;
        default:
            return;
    }
}

export async function startStreaming(fpsOverride: number | null = null): Promise<void> {
    if (!isConnected() || !state.session?.device) return;
    const fps = fpsOverride == null
        ? normalizeFpsLimit((await loadSettings()).fpsLimit)
        : normalizeFpsLimit(fpsOverride, state.currentStreamFps || DEFAULT_SCREEN_FPS);
    if (!isConnected() || !state.session?.device) return;

    state.currentStreamFps = fps;
    resetFpsCounter?.();
    sendJson({ type: 'start-streaming', platform: state.session.device.platform, deviceId: state.session.device.id, fps });
}

let resetFpsCounter: (() => void) | null = null;
export function onStreamRestart(fn: () => void): void {
    resetFpsCounter = fn;
}

/** Ask for the page source; `silent` skips the loading overlay (auto refresh). */
export function requestPageSource(silent = false): void {
    if (!isConnected()) return;
    if (state.isLoadingPageSource) {
        console.log('Page source already loading, skipping...');
        return;
    }
    state.isLoadingPageSource = true;
    if (!silent) dom.sourceLoading.classList.remove('hidden');

    if (pageSourceTimer) clearTimeout(pageSourceTimer);
    pageSourceTimer = setTimeout(() => {
        if (!state.isLoadingPageSource) return;
        console.warn('Page source request timed out, resetting...');
        finishPageSourceLoad();
    }, PAGE_SOURCE_TIMEOUT_MS);

    sendJson({ type: 'get-page-source' });
}

/** Clear the loading flag and spinners (on arrival, error or timeout). */
export function finishPageSourceLoad(): void {
    state.isLoadingPageSource = false;
    if (pageSourceTimer) clearTimeout(pageSourceTimer);
    dom.sourceLoading.classList.add('hidden');
    dom.refreshBtn.classList.remove('spinning');
}

export function closeIntentionally(): void {
    intentionalClose = true;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (isConnected()) {
        sendJson({ type: 'stop-streaming' });
        ws?.close();
    }
}
