let BACKEND_URL = 'http://localhost:8765';

// DOM Elements
const deviceSelect = document.getElementById('device-select');
const deviceSub = document.getElementById('device-sub');
const connectBtn = document.getElementById('connect-btn');
const errorMessage = document.getElementById('error-message');
const serverBtn = document.getElementById('server-btn');
const backendDot = document.getElementById('backend-dot');
const appiumDot = document.getElementById('appium-dot');
const backendState = document.getElementById('backend-state');
const appiumState = document.getElementById('appium-state');

const platformSeg = document.getElementById('platform-seg');
const stepServers = document.getElementById('step-servers');
const stepPlatform = document.getElementById('step-platform');
const stepDevice = document.getElementById('step-device');

const themeToggle = document.getElementById('theme-toggle');
const settingsLink = document.getElementById('settings-link');
const logsToggle = document.getElementById('logs-toggle');
const logsContent = document.getElementById('logs-content');
const openLogsBtn = document.getElementById('open-logs-btn');

// Error Modal Elements
const errorModal = document.getElementById('error-modal');
const errorModalTitle = document.getElementById('error-modal-title');
const errorModalBody = document.getElementById('error-modal-body');
const errorModalClose = document.getElementById('error-modal-close');
const errorHelpBtn = document.getElementById('error-help-btn');

// State
let devices = [];
let selectedPlatform = null;
let selectedDevice = null;
let serverStatus = { backend: false, appium: false };

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    

    initTheme();

    chrome.storage.sync.get({ backendPort: 8765 }, (s) => {
        BACKEND_URL = `http://localhost:${s.backendPort}`;

        setupEventListeners();

        // Load existing log history
        chrome.runtime.sendMessage({ type: 'request-logs' }, (response) => {
            if (chrome.runtime.lastError || !response?.logs) return;
            response.logs.forEach(entry => addLogEntry(entry.message, entry.level));
        });

        // Poll for status
        updateServerStatus();
        setInterval(updateServerStatus, 2000);
        updateStepStates();
    });
});

/* ── Theme ─────────────────────────────────────────── */
function applyTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
}

function initTheme() {
    chrome.storage.sync.get({ theme: null }, (s) => {
        let theme = s.theme;
        if (!theme) {
            try { theme = localStorage.getItem('ali-theme'); } catch (e) { /* ignore */ }
        }
        applyTheme(theme === 'dark' ? 'dark' : 'light');
    });
}

function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('ali-theme', next); } catch (e) { /* ignore */ }
    chrome.storage.sync.set({ theme: next });
    
}

function setupEventListeners() {
    platformSeg.addEventListener('click', handlePlatformClick);
    deviceSelect.addEventListener('change', handleDeviceChange);
    connectBtn.addEventListener('click', handleConnect);
    serverBtn.addEventListener('click', handleServerToggle);
    settingsLink.addEventListener('click', handleSettings);
    themeToggle.addEventListener('click', toggleTheme);

    logsToggle.addEventListener('click', toggleLogs);

    if (openLogsBtn) {
        openLogsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openLogsInNewTab();
        });
    }

    if (errorModalClose) {
        errorModalClose.addEventListener('click', hideErrorModal);
    }
    if (errorHelpBtn) {
        errorHelpBtn.addEventListener('click', (e) => {
            
            handleSettings(e);
        });
    }
    if (errorModal) {
        errorModal.addEventListener('click', (e) => {
            if (e.target === errorModal) hideErrorModal();
        });
    }

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'server-log') {
            addLogEntry(message.message, message.level);
        } else if (message.type === 'server-start-error') {
            handleServerStartError(message.errors);
        } else if (message.type === 'device-connection-result') {
            if (message.success) {
                showNotice('');
            } else {
                showNotice(`Connection failed: ${message.error}`, { error: true });
                resetConnectButton();
            }
        } else if (message.type === 'server-status') {
            serverStatus = message.status || { backend: false, appium: false };
            renderServerStatus();
        }
    });
}

/* ── Step state machine ────────────────────────────── */
function setStepState(step, state) {
    step.dataset.state = state;
    const index = step.querySelector('.step-index');
    if (index) {
        index.textContent = state === 'done' ? '✓' : index.dataset.n || index.textContent;
    }
}

function updateStepStates() {
    const serversReady = !!serverStatus.backend;

    // Cache the original step numbers once
    [stepServers, stepPlatform, stepDevice].forEach((step, i) => {
        const idx = step.querySelector('.step-index');
        if (idx && !idx.dataset.n) idx.dataset.n = String(i + 1);
    });

    setStepState(stepServers, serversReady ? 'done' : 'active');
    if (!serversReady) {
        setStepState(stepPlatform, 'locked');
        setStepState(stepDevice, 'locked');
    } else if (!selectedPlatform) {
        setStepState(stepPlatform, 'active');
        setStepState(stepDevice, 'locked');
    } else if (!selectedDevice) {
        setStepState(stepPlatform, 'done');
        setStepState(stepDevice, 'active');
    } else {
        setStepState(stepPlatform, 'done');
        setStepState(stepDevice, 'done');
    }
}

function toggleLogs() {
    logsContent.classList.toggle('visible');
    logsToggle.classList.toggle('expanded');
    
}

function addLogEntry(message, level = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${level}`;
    entry.textContent = message;
    const threshold = 20;
    const wasAtBottom = logsContent.scrollHeight - logsContent.scrollTop <= logsContent.clientHeight + threshold;

    logsContent.appendChild(entry);

    if (wasAtBottom) {
        logsContent.scrollTop = logsContent.scrollHeight;
    }

    while (logsContent.children.length > 100) {
        logsContent.removeChild(logsContent.firstChild);
    }
}

function handleSettings(e) {
    e.preventDefault();
    
    if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
    } else {
        window.open(chrome.runtime.getURL('options.html'));
    }
}

function updateServerStatus() {
    chrome.runtime.sendMessage({ type: 'get-status' }, (response) => {
        if (chrome.runtime.lastError) return;

        serverStatus = response || { backend: false, appium: false };
        renderServerStatus();

        if (serverStatus.backend) {
            checkBackendStatus();
        } else {
            // Reset the flow below servers; guidance comes from step states, not a banner
            selectedPlatform = null;
            selectedDevice = null;
            devices = [];
            clearPlatformSelection();
            deviceSelect.disabled = true;
            deviceSelect.innerHTML = '<option value="">Select a platform first</option>';
            connectBtn.disabled = true;
        }
        updateStepStates();
    });
}

function renderServerStatus() {
    backendDot.className = `status-dot ${serverStatus.backend ? 'connected' : 'disconnected'}`;
    appiumDot.className = `status-dot ${serverStatus.appium ? 'connected' : 'disconnected'}`;
    if (backendState) backendState.textContent = serverStatus.backend ? 'Running' : 'Stopped';
    if (appiumState) appiumState.textContent = serverStatus.appium ? 'Running' : 'Stopped';

    const isRunning = serverStatus.backend || serverStatus.appium;
    if (isRunning) {
        serverBtn.textContent = 'Stop servers';
        serverBtn.classList.remove('btn-primary');
        serverBtn.classList.add('btn-quiet');
    } else {
        serverBtn.textContent = 'Start servers';
        serverBtn.classList.add('btn-primary');
        serverBtn.classList.remove('btn-quiet');
    }
}

async function handleServerToggle() {
    const isRunning = serverStatus.backend || serverStatus.appium;
    const command = isRunning ? 'stop-server' : 'start-server';
    const action = isRunning ? 'stop' : 'start';

    

    serverBtn.disabled = true;
    serverBtn.textContent = isRunning ? 'Stopping…' : 'Starting…';

    chrome.runtime.sendMessage({ type: command }, (response) => {
        serverBtn.disabled = false;
        if (response && response.success) {
            
            setTimeout(updateServerStatus, 1000);
        } else {
            const errorMsg = response?.error || chrome.runtime.lastError?.message || 'Unknown error';
            
            if (isSetupRequiredError({ error: errorMsg, code: response?.code })) {
                showErrorModal([{ error: errorMsg, code: response?.code }]);
                renderServerStatus();
                return;
            }
            showNotice(`Failed to ${isRunning ? 'stop' : 'start'} servers: ${errorMsg}`, { error: true });
            renderServerStatus();
        }
    });
}

let healthCheckRetries = 0;
const MAX_HEALTH_RETRIES = 5;

async function checkBackendStatus() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${BACKEND_URL}/health`, { signal: controller.signal });
        clearTimeout(timeout);
        const data = await response.json();

        healthCheckRetries = 0;

        if (data.status === 'ok') {
            showNotice('');

            if (!data.adbAvailable && !data.iosToolsAvailable) {
                showNotice('Neither ADB nor iOS tools are available. Install Android SDK or Xcode.', { error: false });
            } else if (!data.adbAvailable) {
                showNotice('ADB not available. Android device detection will not work.', { error: false });
            } else if (!data.iosToolsAvailable) {
                showNotice('iOS tools not available. iOS simulator detection will not work.', { error: false });
            }
        }
    } catch (error) {
        healthCheckRetries++;
        if (healthCheckRetries > MAX_HEALTH_RETRIES) {
            showNotice('Backend server is not responding. It may still be starting up.', { error: true });
        }
    }
}

function showNotice(message, opts = {}) {
    if (message) {
        errorMessage.textContent = message;
        errorMessage.classList.toggle('is-error', opts.error !== false);
        errorMessage.classList.remove('hidden');
    } else {
        errorMessage.classList.add('hidden');
        errorMessage.textContent = '';
    }
}

/* ── Platform (segmented control) ──────────────────── */
function clearPlatformSelection() {
    platformSeg.querySelectorAll('.seg').forEach(btn => btn.setAttribute('aria-pressed', 'false'));
}

function handlePlatformClick(e) {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    selectPlatform(btn.dataset.platform);
}

async function selectPlatform(platform) {
    if (!platform) return;
    selectedPlatform = platform;
    selectedDevice = null;
    connectBtn.disabled = true;

    platformSeg.querySelectorAll('.seg').forEach(btn => {
        btn.setAttribute('aria-pressed', btn.dataset.platform === platform ? 'true' : 'false');
    });

    

    deviceSelect.disabled = true;
    deviceSelect.innerHTML = '<option value="">Loading devices…</option>';
    if (deviceSub) deviceSub.textContent = 'Hang tight — looking for your devices…';
    updateStepStates();

    try {
        const response = await fetch(`${BACKEND_URL}/api/devices/${platform}`);
        const data = await response.json();

        if (data.success) {
            devices = data.devices;
            populateDeviceDropdown(devices);
            
        } else {
            showNotice(`Failed to fetch devices: ${data.error}`, { error: true });
            deviceSelect.innerHTML = '<option value="">No devices found</option>';
            if (deviceSub) deviceSub.textContent = 'Hmm, no devices turned up. Connect one and try again.';
            
        }
    } catch (error) {
        showNotice(`Error fetching devices: ${error.message}`, { error: true });
        deviceSelect.innerHTML = '<option value="">Error loading devices</option>';
        if (deviceSub) deviceSub.textContent = "Couldn't reach the backend — is it still running?";
        
    }
    updateStepStates();
}

function populateDeviceDropdown(list) {
    if (list.length === 0) {
        deviceSelect.innerHTML = '<option value="">No devices found</option>';
        deviceSelect.disabled = true;
        if (deviceSub) deviceSub.textContent = 'No devices yet — connect one, then pick the platform again.';
        updateStepStates();
        return;
    }

    deviceSelect.innerHTML = '<option value="">Select a device</option>';
    list.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `${device.name} (${device.version})`;
        deviceSelect.appendChild(option);
    });

    deviceSelect.disabled = false;
    if (deviceSub) {
        deviceSub.textContent = `${list.length} device${list.length === 1 ? '' : 's'} ready to inspect.`;
    }
    updateStepStates();
}

function handleDeviceChange(e) {
    const deviceIndex = e.target.value;

    if (deviceIndex === '') {
        selectedDevice = null;
        connectBtn.disabled = true;
    } else {
        selectedDevice = devices[parseInt(deviceIndex)];
        connectBtn.disabled = false;
        
    }
    updateStepStates();
}

async function handleConnect() {
    if (!selectedDevice) return;

    

    connectBtn.disabled = true;
    connectBtn.innerHTML = `
    <svg class="btn-icon spinning" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" opacity="0.3"/>
      <path d="M14 8C14 4.68629 11.3137 2 8 2" stroke="currentColor" stroke-width="2"/>
    </svg>
    Connecting…`;

    chrome.runtime.sendMessage({
        type: 'connect-device',
        deviceInfo: selectedDevice
    }, (response) => {
        if (response && response.started) {
            connectBtn.innerHTML = `
            <svg class="btn-icon spinning" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" opacity="0.3"/>
              <path d="M14 8C14 4.68629 11.3137 2 8 2" stroke="currentColor" stroke-width="2"/>
            </svg>
            Creating session…`;
        } else {
            
            showNotice(`Connection error: ${response?.error || 'Unknown error'}`, { error: true });
            resetConnectButton();
        }
    });
}

function resetConnectButton() {
    connectBtn.disabled = false;
    connectBtn.innerHTML = `
    <svg class="btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    </svg>
    Connect to device`;
}

function openLogsInNewTab() {
    
    chrome.runtime.sendMessage({ type: 'open-logs-tab' });
}

/* ── Setup / info modal ────────────────────────────── */
function isSetupRequiredError(error) {
    return error?.code === 'COMPANION_SETUP_REQUIRED' ||
        error?.code === 'NATIVE_HOST_ERROR' ||
        error?.error?.includes('auto setup installer') ||
        error?.error?.includes('native host');
}

function showErrorModal(errors) {
    if (!errorModal || !errorModalBody) return;

    errorModalBody.innerHTML = '';
    const isSetupRequired = errors.some(isSetupRequiredError);

    if (errorModalTitle) {
        errorModalTitle.textContent = isSetupRequired ? 'One-time setup needed' : 'Setup information';
    }
    if (errorHelpBtn) {
        errorHelpBtn.textContent = isSetupRequired ? 'Set up companion' : 'Open settings';
    }

    if (isSetupRequired) {
        const setupMessage = document.createElement('div');
        setupMessage.className = 'error-item';
        setupMessage.innerHTML = `
            <div class="error-server">Appium Locators Inspector is ready.</div>
            <div class="error-text">Install the local companion once to start servers and connect your devices.</div>
        `;
        errorModalBody.appendChild(setupMessage);
        errorModal.classList.remove('hidden');
        return;
    }

    errors.forEach(error => {
        const errorItem = document.createElement('div');
        errorItem.className = 'error-item';

        const serverName = document.createElement('div');
        serverName.className = 'error-server';
        serverName.textContent = error.server ? `${error.server} needs attention:` : 'Needs attention:';

        const errorText = document.createElement('div');
        errorText.className = 'error-text';
        errorText.textContent = error.error;

        errorItem.appendChild(serverName);
        errorItem.appendChild(errorText);
        errorModalBody.appendChild(errorItem);
    });

    errorModal.classList.remove('hidden');
}

function hideErrorModal() {
    if (errorModal) {
        errorModal.classList.add('hidden');
        
    }
}

function handleServerStartError(errors) {
    

    if (!logsContent.classList.contains('visible')) {
        logsContent.classList.add('visible');
        logsToggle.classList.add('expanded');
    }

    showErrorModal(errors);
}

// Spinner animation
const style = document.createElement('style');
style.textContent = `
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .spinning { animation: spin 1s linear infinite; }
`;
document.head.appendChild(style);
