// Background service worker: owns the native-host port, log history and device connections.
import type { NativeMessage } from '../../shared/protocol.js';
import { broadcast, type BackgroundRequest, type CommandResponse, type ServerStatus, type SetupCheckResponse } from '../lib/messages.js';
import { appiumPortOf, loadSettings, normalizeFpsLimit } from '../lib/settings.js';
import { connectDevice } from './device-connection.js';
import { LogHistory } from './log-history.js';
import { forgetLogsTab, openLogsTab } from './logs-tab.js';
import { explainDisconnect, SETUP_REQUIRED_MESSAGE, startErrorsOf } from './native-errors.js';
import { NativeHostClient } from './native-host-client.js';

/** Give a fresh connectNative() a moment to fail before using it. */
const CONNECT_SETTLE_MS = 100;
const UNAVAILABLE_CHECK_MS = 1000;

let serverStatus: ServerStatus = { backend: false, appium: false };
const logs = new LogHistory();

function setStatus(status: ServerStatus): void {
    serverStatus = status;
    broadcast({ type: 'server-status', status });
}

function handleNativeMessage(msg: NativeMessage): void {
    switch (msg.type) {
        case 'status':
            setStatus({ backend: msg.backend, appium: msg.appium });
            return;
        case 'start-result': {
            const errors = startErrorsOf(msg);
            if (errors.length) broadcast({ type: 'server-start-error', errors });
            host.post({ command: 'status' });
            return;
        }
        case 'log':
            broadcast(logs.add(msg.message, msg.level));
            return;
        default:
            return;
    }
}

const host = new NativeHostClient({
    onMessage: handleNativeMessage,
    onDisconnect: (lastError) => {
        setStatus({ backend: false, appium: false });
        if (!lastError) return;
        const { message, needsHelp } = explainDisconnect(lastError);
        broadcast({ type: 'native-host-error', error: message, needsHelp });
        broadcast({
            type: 'server-start-error',
            errors: [{ server: 'Local Companion', error: message, code: needsHelp ? 'COMPANION_SETUP_REQUIRED' : 'NATIVE_HOST_ERROR' }]
        });
    },
    onConnectFailed: (error) => broadcast({ type: 'native-host-unavailable', error })
});

const settle = () => new Promise((resolve) => setTimeout(resolve, CONNECT_SETTLE_MS));

async function ensureConnected(): Promise<boolean> {
    if (host.connected) return true;
    host.connect();
    await settle();
    return host.connected;
}

async function checkSetup(): Promise<SetupCheckResponse> {
    if (!(await ensureConnected())) {
        return {
            success: false,
            nativeHost: false,
            error: 'Native host not found. Run the Appium Locators Inspector auto setup installer, then reload the extension.'
        };
    }
    try {
        const msg = await host.request({ command: 'diagnose', extensionId: chrome.runtime.id });
        return { success: true, nativeHost: true, diagnostics: msg.type === 'diagnose-result' ? msg.data : undefined };
    } catch (error) {
        return { success: false, nativeHost: true, error: (error as Error).message };
    }
}

async function startServers(): Promise<CommandResponse> {
    const settings = await loadSettings();
    const command = {
        command: 'start' as const,
        backendPort: settings.backendPort,
        appiumPort: appiumPortOf(settings.appiumUrl),
        fpsLimit: normalizeFpsLimit(settings.fpsLimit)
    };
    if (!(await ensureConnected())) {
        return { success: false, code: 'COMPANION_SETUP_REQUIRED', error: SETUP_REQUIRED_MESSAGE };
    }
    host.post(command);
    return { success: true };
}

function stopServers(): CommandResponse {
    return host.post({ command: 'stop' })
        ? { success: true }
        : { success: false, error: 'Native host is not connected' };
}

type Respond = (response: unknown) => void;

/** Returns true when the response is sent asynchronously. */
function route(request: BackgroundRequest, sender: chrome.runtime.MessageSender, respond: Respond): boolean {
    switch (request.type) {
        case 'get-status':
            respond(serverStatus);
            host.post({ command: 'status' });
            return false;
        case 'check-setup':
            void checkSetup().then(respond);
            return true;
        case 'start-server':
            void startServers().then(respond);
            return true;
        case 'stop-server':
            respond(stopServers());
            return false;
        case 'connect-device':
            void connectDevice(request.deviceInfo);
            respond({ started: true });
            return false;
        case 'open-logs-tab':
            void openLogsTab();
            respond({ success: true });
            return false;
        case 'request-logs':
            respond({ success: true, logs: logs.all() });
            return false;
        default:
            return false;
    }
}

chrome.runtime.onMessage.addListener((request: BackgroundRequest, sender, sendResponse) => {
    if (!request || typeof request !== 'object' || sender.id !== chrome.runtime.id) return false;
    return route(request, sender, sendResponse);
});

chrome.tabs.onRemoved.addListener(forgetLogsTab);
chrome.runtime.onInstalled.addListener(() => host.connect());

host.connect();
setTimeout(() => {
    if (!host.connected) broadcast({ type: 'native-host-unavailable' });
}, UNAVAILABLE_CHECK_MS);

console.log('Appium Locators Inspector background service initialized');
