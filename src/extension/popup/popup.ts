import type { DeviceInfo, Platform } from '../../shared/protocol.js';
import { requireById, byId } from '../lib/html.js';
import { sendToBackground, type BackgroundEvent, type CommandResponse, type ServerStatus } from '../lib/messages.js';
import { loadBackendUrl } from '../lib/settings.js';
import { currentDocumentTheme, loadTheme, saveTheme, setDocumentTheme } from '../lib/theme.js';
import { createErrorModal, isSetupRequiredError } from './error-modal.js';
import { createLogPanel } from './log-panel.js';
import { createSteps } from './steps.js';

const STATUS_POLL_MS = 2000;
const HEALTH_TIMEOUT_MS = 5000;
const MAX_HEALTH_RETRIES = 5;

const SPINNER = `
    <svg class="btn-icon spinning" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" opacity="0.3"/>
      <path d="M14 8C14 4.68629 11.3137 2 8 2" stroke="currentColor" stroke-width="2"/>
    </svg>`;
const CONNECT_ICON = `
    <svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    </svg>`;

const deviceSelect = requireById<HTMLSelectElement>('device-select');
const deviceSub = byId('device-sub');
const connectBtn = requireById<HTMLButtonElement>('connect-btn');
const errorMessage = requireById('error-message');
const serverBtn = requireById<HTMLButtonElement>('server-btn');
const backendDot = requireById('backend-dot');
const appiumDot = requireById('appium-dot');
const backendState = byId('backend-state');
const appiumState = byId('appium-state');
const platformSeg = requireById('platform-seg');

const logPanel = createLogPanel({
    toggle: requireById('logs-toggle'),
    content: requireById('logs-content'),
    openButton: byId('open-logs-btn')
});
const steps = createSteps([requireById('step-servers'), requireById('step-platform'), requireById('step-device')]);
const errorModal = createErrorModal({ onHelp: openSettings });

let backendUrl = '';
let devices: DeviceInfo[] = [];
let selectedPlatform: Platform | null = null;
let selectedDevice: DeviceInfo | null = null;
let serverStatus: ServerStatus = { backend: false, appium: false };
let healthCheckRetries = 0;

document.addEventListener('DOMContentLoaded', async () => {
    void loadTheme().then(setDocumentTheme);
    backendUrl = await loadBackendUrl();
    setupEventListeners();
    const response = await sendToBackground<{ logs?: Array<{ message: string; level: string }> }>({ type: 'request-logs' }).catch(() => undefined);
    response?.logs?.forEach((entry) => logPanel.add(entry.message, entry.level));
    void updateServerStatus();
    setInterval(updateServerStatus, STATUS_POLL_MS);
    refreshSteps();
});

function toggleTheme(): void {
    const next = currentDocumentTheme() === 'dark' ? 'light' : 'dark';
    setDocumentTheme(next);
    saveTheme(next);
}

function setupEventListeners(): void {
    platformSeg.addEventListener('click', handlePlatformClick);
    deviceSelect.addEventListener('change', handleDeviceChange);
    connectBtn.addEventListener('click', handleConnect);
    serverBtn.addEventListener('click', handleServerToggle);
    requireById('settings-link').addEventListener('click', (e) => {
        e.preventDefault();
        openSettings();
    });
    requireById('theme-toggle').addEventListener('click', toggleTheme);
    chrome.runtime.onMessage.addListener(handleBackgroundEvent);
}

function handleBackgroundEvent(message: BackgroundEvent): void {
    switch (message.type) {
        case 'server-log':
            logPanel.add(message.message, message.level);
            return;
        case 'server-start-error':
            logPanel.expand();
            errorModal.show(message.errors);
            return;
        case 'device-connection-result':
            if (message.success) {
                showNotice('');
            } else {
                showNotice(`Connection failed: ${message.error}`, { error: true });
                resetConnectButton();
            }
            return;
        case 'server-status':
            serverStatus = message.status || { backend: false, appium: false };
            renderServerStatus();
            return;
        default:
            return;
    }
}

function refreshSteps(): void {
    steps.update({ serversReady: !!serverStatus.backend, platformChosen: !!selectedPlatform, deviceChosen: !!selectedDevice });
}

function openSettings(): void {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else window.open(chrome.runtime.getURL('options.html'));
}

async function updateServerStatus(): Promise<void> {
    let response: ServerStatus | undefined;
    try {
        response = await sendToBackground<ServerStatus>({ type: 'get-status' });
    } catch {
        return;
    }
    serverStatus = response || { backend: false, appium: false };
    renderServerStatus();

    if (serverStatus.backend) {
        void checkBackendHealth();
    } else {
        // Reset the flow below servers; guidance comes from step states, not a banner.
        selectedPlatform = null;
        selectedDevice = null;
        devices = [];
        clearPlatformSelection();
        deviceSelect.disabled = true;
        deviceSelect.innerHTML = '<option value="">Select a platform first</option>';
        connectBtn.disabled = true;
    }
    refreshSteps();
}

function renderServerStatus(): void {
    backendDot.className = `status-dot ${serverStatus.backend ? 'connected' : 'disconnected'}`;
    appiumDot.className = `status-dot ${serverStatus.appium ? 'connected' : 'disconnected'}`;
    if (backendState) backendState.textContent = serverStatus.backend ? 'Running' : 'Stopped';
    if (appiumState) appiumState.textContent = serverStatus.appium ? 'Running' : 'Stopped';

    const isRunning = serverStatus.backend || serverStatus.appium;
    serverBtn.textContent = isRunning ? 'Stop servers' : 'Start servers';
    serverBtn.classList.toggle('btn-primary', !isRunning);
    serverBtn.classList.toggle('btn-quiet', isRunning);
}

async function handleServerToggle(): Promise<void> {
    const isRunning = serverStatus.backend || serverStatus.appium;
    serverBtn.disabled = true;
    serverBtn.textContent = isRunning ? 'Stopping…' : 'Starting…';

    let response: CommandResponse | undefined;
    let sendError: string | undefined;
    try {
        response = await sendToBackground<CommandResponse>({ type: isRunning ? 'stop-server' : 'start-server' });
    } catch (error) {
        sendError = (error as Error).message;
    }
    serverBtn.disabled = false;
    if (response?.success) {
        setTimeout(updateServerStatus, 1000);
        return;
    }
    const error = response?.error || sendError || 'Unknown error';
    if (isSetupRequiredError({ error, code: response?.code })) {
        errorModal.show([{ error, code: response?.code }]);
    } else {
        showNotice(`Failed to ${isRunning ? 'stop' : 'start'} servers: ${error}`, { error: true });
    }
    renderServerStatus();
}

async function checkBackendHealth(): Promise<void> {
    try {
        const response = await fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
        const data = (await response.json()) as { status?: string; adbAvailable?: boolean; iosToolsAvailable?: boolean };
        healthCheckRetries = 0;
        if (data.status !== 'ok') return;
        showNotice('');
        if (!data.adbAvailable && !data.iosToolsAvailable) {
            showNotice('Neither ADB nor iOS tools are available. Install Android SDK or Xcode.', { error: false });
        } else if (!data.adbAvailable) {
            showNotice('ADB not available. Android device detection will not work.', { error: false });
        } else if (!data.iosToolsAvailable) {
            showNotice('iOS tools not available. iOS simulator detection will not work.', { error: false });
        }
    } catch {
        healthCheckRetries++;
        if (healthCheckRetries > MAX_HEALTH_RETRIES) {
            showNotice('Backend server is not responding. It may still be starting up.', { error: true });
        }
    }
}

function showNotice(message: string, opts: { error?: boolean } = {}): void {
    if (message) {
        errorMessage.textContent = message;
        errorMessage.classList.toggle('is-error', opts.error !== false);
        errorMessage.classList.remove('hidden');
    } else {
        errorMessage.classList.add('hidden');
        errorMessage.textContent = '';
    }
}

function setDeviceSub(text: string): void {
    if (deviceSub) deviceSub.textContent = text;
}

/* ── Platform (segmented control) ──────────────────── */
function segButtons(): HTMLElement[] {
    return Array.from(platformSeg.querySelectorAll<HTMLElement>('.seg'));
}

function clearPlatformSelection(): void {
    segButtons().forEach((btn) => btn.setAttribute('aria-pressed', 'false'));
}

function handlePlatformClick(e: Event): void {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.seg');
    const platform = btn?.dataset.platform;
    if (platform === 'android' || platform === 'ios') void selectPlatform(platform);
}

async function selectPlatform(platform: Platform): Promise<void> {
    selectedPlatform = platform;
    selectedDevice = null;
    connectBtn.disabled = true;
    segButtons().forEach((btn) => btn.setAttribute('aria-pressed', btn.dataset.platform === platform ? 'true' : 'false'));

    deviceSelect.disabled = true;
    deviceSelect.innerHTML = '<option value="">Loading devices…</option>';
    setDeviceSub('Hang tight — looking for your devices…');
    refreshSteps();

    try {
        const response = await fetch(`${backendUrl}/api/devices/${platform}`);
        const data = (await response.json()) as { success: boolean; devices?: DeviceInfo[]; error?: string };
        if (data.success) {
            devices = data.devices ?? [];
            populateDeviceDropdown(devices);
        } else {
            showNotice(`Failed to fetch devices: ${data.error}`, { error: true });
            deviceSelect.innerHTML = '<option value="">No devices found</option>';
            setDeviceSub('Hmm, no devices turned up. Connect one and try again.');
        }
    } catch (error) {
        showNotice(`Error fetching devices: ${(error as Error).message}`, { error: true });
        deviceSelect.innerHTML = '<option value="">Error loading devices</option>';
        setDeviceSub("Couldn't reach the backend — is it still running?");
    }
    refreshSteps();
}

function populateDeviceDropdown(list: DeviceInfo[]): void {
    if (list.length === 0) {
        deviceSelect.innerHTML = '<option value="">No devices found</option>';
        deviceSelect.disabled = true;
        setDeviceSub('No devices yet — connect one, then pick the platform again.');
        refreshSteps();
        return;
    }
    deviceSelect.innerHTML = '<option value="">Select a device</option>';
    list.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `${device.name} (${device.version})`;
        deviceSelect.appendChild(option);
    });
    deviceSelect.disabled = false;
    setDeviceSub(`${list.length} device${list.length === 1 ? '' : 's'} ready to inspect.`);
    refreshSteps();
}

function handleDeviceChange(): void {
    const index = deviceSelect.value;
    selectedDevice = index === '' ? null : devices[Number.parseInt(index, 10)] ?? null;
    connectBtn.disabled = !selectedDevice;
    refreshSteps();
}

async function handleConnect(): Promise<void> {
    if (!selectedDevice) return;
    connectBtn.disabled = true;
    connectBtn.innerHTML = `${SPINNER}\n    Connecting…`;

    const response = await sendToBackground<{ started?: boolean; error?: string }>({ type: 'connect-device', deviceInfo: selectedDevice })
        .catch(() => undefined);
    if (response?.started) {
        connectBtn.innerHTML = `${SPINNER}\n            Creating session…`;
    } else {
        showNotice(`Connection error: ${response?.error || 'Unknown error'}`, { error: true });
        resetConnectButton();
    }
}

function resetConnectButton(): void {
    connectBtn.disabled = false;
    connectBtn.innerHTML = `${CONNECT_ICON}\n    Connect to device`;
}

// Spinner animation
const style = document.createElement('style');
style.textContent = `
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .spinning { animation: spin 1s linear infinite; }
`;
document.head.appendChild(style);

