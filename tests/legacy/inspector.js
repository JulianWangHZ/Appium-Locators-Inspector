let BACKEND_URL = 'http://localhost:8765';
let WS_URL = 'ws://localhost:8765';

const DEFAULT_FPS_LIMIT = 3;
const MIN_FPS_LIMIT = 1;
const MAX_FPS_LIMIT = 30;
const DEFAULT_THEME = 'light';

// Reconnection config
const WS_RECONNECT_BASE_DELAY = 1000; // Start at 1 second
const WS_RECONNECT_MAX_DELAY = 30000; // Max 30 seconds
const WS_RECONNECT_MAX_ATTEMPTS = 50;

// State
let ws = null;
let sessionInfo = null;
let currentPageSource = null;
let currentXmlDoc = null; // Cache parsed XML
let selectedElement = null;
let isElementLocked = false; // Lock selection after click
let isLoadingPageSource = false; // Prevent simultaneous loads
let isInteractMode = false; // Toggle between inspect and interact modes
let isRecording = false; // Record taps into a test script
let recordedSteps = []; // { locator, action, text?, label }
let typingBuffer = ''; // Accumulated text typed since the last field tap (interact mode)
let typingTargetElement = null; // The field element the buffer is being typed into
let exportFullFile = true; // Export a full runnable test file vs. steps only
let recordSelected = null; // { element, x, y } currently selected while recording
let recSubtab = 'actions'; // Which Record subtab is active: 'actions' | 'assert'
let fpsCounter = 0;
let lastFpsUpdate = Date.now();
let coordinateScale = 1.0; // Scale factor between Screenshot Pixels and XML Points (e.g. 3.0 for iPhone Pro)
let elementToNodeMap = new WeakMap(); // Map XML elements to DOM tree nodes
let nodeIdCounter = 0; // Counter for generating unique node IDs
let wsReconnectAttempts = 0;
let wsReconnectTimer = null;
let wsIntentionalClose = false; // Track if we closed on purpose
let currentStreamFps = null;
let currentDisplayedLocators = [];
let sourceSearchTracked = false;
let snippetLang = (() => {
    try { return localStorage.getItem('ali-snippet-lang') || 'java'; } catch (e) { return 'java'; }
})();
let pendingPageSourceRefreshSource = 'manual';

// DOM Elements
const deviceNameEl = document.getElementById('device-name');
const modeToggleBtn = document.getElementById('mode-toggle-btn');
const refreshBtn = document.getElementById('refresh-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const screenImage = document.getElementById('screen-image');
const screenLoading = document.getElementById('screen-loading');
const fpsIndicator = document.getElementById('fps-indicator');
const sourceTree = document.getElementById('source-tree');
const sourceLoading = document.getElementById('source-loading');
const elementDetails = document.getElementById('element-details');
const connectionDot = document.getElementById('connection-dot');
const connectionStatus = document.getElementById('connection-status');
const elementCount = document.getElementById('element-count');
const searchInput = document.getElementById('search-input');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const moonIcon = document.getElementById('moon-icon');
const sunIcon = document.getElementById('sun-icon');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    const settings = await new Promise(r => chrome.storage.sync.get({ backendPort: 8765 }, r));
    BACKEND_URL = `http://localhost:${settings.backendPort}`;
    WS_URL = `ws://localhost:${settings.backendPort}`;

    await loadTheme();
    await loadSession();
    
    setupEventListeners();
    connectWebSocket();
});

async function loadTheme() {
    // Shared with popup/options: chrome.storage.sync 'theme' + localStorage fast-path
    const storage = await chrome.storage.sync.get({ theme: null });
    let theme = storage.theme;
    if (!theme) {
        try { theme = localStorage.getItem('ali-theme'); } catch (e) { /* ignore */ }
    }
    applyTheme(theme || DEFAULT_THEME);
}

function normalizeTheme(theme) {
    return theme === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
    const normalizedTheme = normalizeTheme(theme);
    const isDark = normalizedTheme === 'dark';

    // Drive the shared dark tokens (tokens.css uses [data-theme="dark"])
    if (isDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    document.body.classList.toggle('light-theme', !isDark);

    // Show the icon for the theme you'll switch TO
    moonIcon.style.display = isDark ? 'none' : 'block';
    sunIcon.style.display = isDark ? 'block' : 'none';
}

function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const theme = isDark ? 'light' : 'dark';

    applyTheme(theme);
    chrome.storage.sync.set({ theme });
    try { localStorage.setItem('ali-theme', theme); } catch (e) { /* ignore */ }
    
}

async function loadSession() {
    const storage = await chrome.storage.local.get('activeSession');

    if (!storage.activeSession) {
        alert('No active session found. Please connect from the extension popup.');
        window.close();
        return;
    }

    sessionInfo = storage.activeSession;
    deviceNameEl.textContent = `${sessionInfo.device.name} (${sessionInfo.device.platform})`;
    applyDeviceFrame(sessionInfo.device);
}

// Family-adaptive device body: iOS vs Android look (no per-model assets).
function applyDeviceFrame(device) {
    const frame = document.getElementById('device-frame');
    if (!frame || !device) return;
    const platform = String(device.platform || '').toLowerCase();
    const name = String(device.name || '').toLowerCase();
    const isIOS = platform.includes('ios') || /iphone|ipad|ios/.test(name);
    frame.dataset.device = isIOS ? 'ios' : 'android';
}

function setupEventListeners() {
    modeToggleBtn.addEventListener('click', toggleMode);
    themeToggleBtn.addEventListener('click', toggleTheme);
    refreshBtn.addEventListener('click', () => {
        
        if (isLoadingPageSource) {
            showNotification('Already refreshing...', 'info');
            return;
        }
        refreshBtn.classList.add('spinning');
        refreshPageSource();
    });
    disconnectBtn.addEventListener('click', disconnect);
    searchInput.addEventListener('input', handleSearch);
    chrome.storage.onChanged.addListener(handleSettingsChange);

    // Add click-to-inspect on screen mirror
    screenImage.addEventListener('click', handleScreenClick);

    setupDetailTabs();
    setupRecordControls();
    document.addEventListener('keydown', handleKeyboardInput);

    // Click the empty canvas around the device → deselect
    const deviceStage = document.querySelector('.device-stage');
    if (deviceStage) {
        deviceStage.addEventListener('click', (e) => {
            if (!e.target.closest('#screen-container')) {
                deselectElement();
            }
        });
    }
    screenImage.addEventListener('mousemove', handleScreenHover);
    screenImage.addEventListener('mouseleave', () => {
        // Keep the lock when leaving - don't change anything
        // This preserves the selected element for copying
    });

    screenImage.addEventListener('mouseenter', () => {
        // Unlock when re-entering screen to enable hovering
        if (isElementLocked) {
            isElementLocked = false;
            console.log('Selection unlocked on mouse re-enter');
        }
    });

    // Fix for race condition: Recalculate scale when image FIRST loads
    let imageInitialized = false;
    screenImage.onload = () => {
        if (!imageInitialized && currentXmlDoc) {
            imageInitialized = true;
            console.log('Image loaded first time, recalculating scale...');
            updatePageSource(currentPageSource); // Re-run logic with cached source
        }
    };

    screenImage.style.cursor = 'crosshair';

    // ESC key to unlock selection
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isElementLocked) {
            isElementLocked = false;
            clearElementHighlight();
            console.log('Selection unlocked');
        }
    });
}

function connectWebSocket() {
    // Clear any pending reconnect
    if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
    }

    try {
        ws = new WebSocket(WS_URL);
    } catch (e) {
        console.error('WebSocket creation failed:', e);
        scheduleReconnect();
        return;
    }

    ws.onopen = () => {
        console.log('WebSocket connected');
        wsReconnectAttempts = 0;
        wsIntentionalClose = false;
        updateConnectionStatus(true);
        showNotification('Connected to backend', 'success');
        
        startStreaming();
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            handleWebSocketMessage(message);
        } catch (e) {
            console.error('Failed to parse WebSocket message:', e);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus(false);
    };

    ws.onclose = (event) => {
        console.log('WebSocket disconnected, code:', event.code);
        updateConnectionStatus(false);
        

        if (!wsIntentionalClose) {
            scheduleReconnect();
        }
    };
}

function scheduleReconnect() {
    if (wsReconnectAttempts >= WS_RECONNECT_MAX_ATTEMPTS) {
        showNotification('Connection lost. Please refresh the page.', 'error');
        
        return;
    }

    // Exponential backoff with jitter
    const delay = Math.min(
        WS_RECONNECT_BASE_DELAY * Math.pow(2, wsReconnectAttempts) + Math.random() * 1000,
        WS_RECONNECT_MAX_DELAY
    );
    wsReconnectAttempts++;

    console.log(`Reconnecting in ${Math.round(delay / 1000)}s (attempt ${wsReconnectAttempts}/${WS_RECONNECT_MAX_ATTEMPTS})`);
    showNotification(`Reconnecting... (attempt ${wsReconnectAttempts})`, 'warning');
    

    wsReconnectTimer = setTimeout(() => {
        connectWebSocket();
    }, delay);
}

function handleWebSocketMessage(message) {
    // Filter messages for other devices (if multi-streaming)
    if (message.deviceId && sessionInfo && message.deviceId !== sessionInfo.device.id) {
        // console.log(`Ignoring message for device ${message.deviceId} (current: ${sessionInfo.device.id})`);
        return;
    }

    switch (message.type) {
        case 'connected':
            console.log('Backend connected:', message.message);
            break;

        case 'screenshot':
            updateScreenshot(message.data);
            break;

        case 'page-source':
            updatePageSource(message.data);
            break;

        case 'streaming-started':
            currentStreamFps = normalizeFpsLimit(message.fps, currentStreamFps || DEFAULT_FPS_LIMIT);
            console.log(`Streaming started at ${currentStreamFps} FPS`);
            
            // Safe to request page source now — ws.deviceId is set on the server
            refreshPageSource();
            break;

        case 'error':
            console.error('Backend error:', message.message);
            showNotification('Error: ' + message.message, 'error');
            // Reset any in-progress loading state
            if (isLoadingPageSource) {
                isLoadingPageSource = false;
                if (pageSourceTimeout) clearTimeout(pageSourceTimeout);
                sourceLoading.classList.add('hidden');
                refreshBtn.classList.remove('spinning');
            }
            break;
    }
}

async function startStreaming(fpsOverride = null) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionInfo?.device) return;

    const fps = fpsOverride == null
        ? await getSavedFpsLimit()
        : normalizeFpsLimit(fpsOverride, currentStreamFps || DEFAULT_FPS_LIMIT);

    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionInfo?.device) return;

    currentStreamFps = fps;
    fpsCounter = 0;
    lastFpsUpdate = Date.now();

    ws.send(JSON.stringify({
        type: 'start-streaming',
        platform: sessionInfo.device.platform,
        deviceId: sessionInfo.device.id,
        fps
    }));
    // Page source is requested when 'streaming-started' is received,
    // ensuring ws.deviceId is set on the server before we ask for it.
}

async function getSavedFpsLimit() {
    const settings = await chrome.storage.sync.get({ fpsLimit: DEFAULT_FPS_LIMIT });
    return normalizeFpsLimit(settings.fpsLimit);
}

function normalizeFpsLimit(value, fallback = DEFAULT_FPS_LIMIT) {
    const parsed = value === '' || value == null ? NaN : Number(value);
    if (Number.isFinite(parsed)) {
        return Math.min(MAX_FPS_LIMIT, Math.max(MIN_FPS_LIMIT, Math.round(parsed)));
    }

    const parsedFallback = fallback === '' || fallback == null ? NaN : Number(fallback);
    return Number.isFinite(parsedFallback)
        ? Math.min(MAX_FPS_LIMIT, Math.max(MIN_FPS_LIMIT, Math.round(parsedFallback)))
        : DEFAULT_FPS_LIMIT;
}

function handleSettingsChange(changes, areaName) {
    if (areaName !== 'sync') return;

    if (changes.theme) {
        applyTheme(changes.theme.newValue);
    }

    if (!changes.fpsLimit) return;

    const nextFps = normalizeFpsLimit(changes.fpsLimit.newValue, currentStreamFps || DEFAULT_FPS_LIMIT);
    if (nextFps === currentStreamFps) return;

    startStreaming(nextFps);
}

function updateScreenshot(base64Data) {
    const previousScreenshot = screenImage.src;
    screenImage.src = `data:image/png;base64,${base64Data}`;
    screenImage.classList.add('loaded');
    screenLoading.classList.add('hidden');

    // Update FPS counter
    fpsCounter++;
    const now = Date.now();
    if (now - lastFpsUpdate >= 1000) {
        const measuredFps = Math.round((fpsCounter * 1000) / (now - lastFpsUpdate));
        fpsIndicator.textContent = `${measuredFps} FPS`;
        fpsCounter = 0;
        lastFpsUpdate = now;
    }

    // Detect screen changes and auto-refresh page source
    detectScreenChange();
}

// Offscreen canvas for comparing against last page source refresh
let pageSourceSnapshot = null;
let pageSourceSnapshotContext = null;
// Reusable canvas for current-frame comparison (avoids creating one per frame)
let diffCanvas = null;
let diffCtx = null;
// Debounce: only trigger auto-refresh at most once every 2 seconds
let screenChangeDebounceTimer = null;

function detectScreenChange() {
    if (!screenImage.classList.contains('loaded')) return;
    if (!pageSourceSnapshot) return; // No snapshot yet = nothing to compare
    if (!screenImage.complete) return;

    try {
        const width = screenImage.naturalWidth;
        const height = screenImage.naturalHeight;

        if (!width || !height) return;

        // If dimensions changed, force refresh immediately
        if (pageSourceSnapshot.width !== width || pageSourceSnapshot.height !== height) {
            console.log('Screen dimensions changed, forcing page source refresh...');
            if (isLoadingPageSource) {
                showStaleIndicator();
            } else {
                refreshPageSource(true);
            }
            return;
        }

        // Reuse the comparison canvas across frames
        if (!diffCanvas || diffCanvas.width !== width || diffCanvas.height !== height) {
            diffCanvas = document.createElement('canvas');
            diffCanvas.width = width;
            diffCanvas.height = height;
            diffCtx = diffCanvas.getContext('2d', { willReadFrequently: true });
        }
        diffCtx.drawImage(screenImage, 0, 0);

        const currentData = diffCtx.getImageData(0, 0, width, height).data;
        const snapshotData = pageSourceSnapshotContext.getImageData(0, 0, width, height).data;

        let diffPixels = 0;
        const sampledPixels = Math.floor(width * height / 10); // sample every 10th pixel
        const threshold = 30;

        for (let i = 0; i < currentData.length; i += 40) {
            const rDiff = Math.abs(currentData[i] - snapshotData[i]);
            const gDiff = Math.abs(currentData[i + 1] - snapshotData[i + 1]);
            const bDiff = Math.abs(currentData[i + 2] - snapshotData[i + 2]);
            if (rDiff + gDiff + bDiff > threshold) diffPixels++;
        }

        const changePercent = (diffPixels / sampledPixels * 100);

        if (diffPixels > sampledPixels * 0.01) {
            // Screen changed — always show stale indicator immediately
            showStaleIndicator();

            // Debounce the actual refresh to avoid hammering the backend
            // while a screen is animating/transitioning
            if (!screenChangeDebounceTimer) {
                screenChangeDebounceTimer = setTimeout(() => {
                    screenChangeDebounceTimer = null;
                    if (!isLoadingPageSource) {
                        console.log(`🔄 Screen change detected (${changePercent.toFixed(1)}% pixels changed), refreshing page source...`);
                        refreshPageSource(true);
                    }
                }, 2000);
            }
        }

    } catch (e) {
        console.warn('Screen diff error:', e);
    }
}

// Take a snapshot when page source is refreshed
function capturePageSourceSnapshot() {
    if (!screenImage.classList.contains('loaded')) return;
    if (!screenImage.complete) return;

    const width = screenImage.naturalWidth;
    const height = screenImage.naturalHeight;

    if (!width || !height) return;

    pageSourceSnapshot = document.createElement('canvas');
    pageSourceSnapshot.width = width;
    pageSourceSnapshot.height = height;
    pageSourceSnapshotContext = pageSourceSnapshot.getContext('2d', { willReadFrequently: true });
    pageSourceSnapshotContext.drawImage(screenImage, 0, 0);

    console.log('Captured page source snapshot for change detection');
}

function showStaleIndicator() {
    // Add a badge/glow to refresh button to indicate stale data
    refreshBtn.classList.add('stale');
    refreshBtn.title = '⚠️ Screen changed - Click to refresh page source';
}

function hideStaleIndicator() {
    refreshBtn.classList.remove('stale');
    refreshBtn.title = 'Refresh Page Source';
}

async function sendTap(x, y) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!sessionInfo || !sessionInfo.device) return;

    console.log(`Sending tap: (${x}, ${y}) to device ${sessionInfo.device.id}`);

    try {
        // Send tap command via backend API
        await fetch(`${BACKEND_URL}/api/tap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: sessionInfo.device.id,
                x,
                y
            })
        });

        // Force a refresh after tap
        setTimeout(() => refreshPageSource(true), 1000); // Wait 1s for animation
        

    } catch (error) {
        console.error('Tap failed:', error);
        showNotification('Tap failed: ' + error.message, 'error');
        
    }
}

// The element's rect in device coordinates (same space as tap coords).
function deviceRectOf(el) {
    const a = el.attributes || {};
    if (a.bounds) {
        const m = a.bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
        if (m) {
            const [, x1, y1, x2, y2] = m.map(Number);
            return { left: x1, top: y1, width: x2 - x1, height: y2 - y1 };
        }
    } else if (a.x != null && a.width != null) {
        return {
            left: parseFloat(a.x), top: parseFloat(a.y),
            width: parseFloat(a.width), height: parseFloat(a.height)
        };
    }
    return null;
}

// Perform a mobile gesture on the device via the backend.
async function sendGestureToDevice(gesture, opts) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!sessionInfo || !sessionInfo.device) return;
    try {
        await fetch(`${BACKEND_URL}/api/gesture`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: sessionInfo.device.id,
                platform: sessionInfo.device.platform,
                gesture,
                ...opts
            })
        });
        setTimeout(() => refreshPageSource(true), 1000);
    } catch (error) {
        console.error('Gesture failed:', error);
    }
}

// Reliably type into a specific element (backend finds it by locator → setValue).
async function sendTextToElement(locator, text) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!sessionInfo || !sessionInfo.device || !locator) return;
    try {
        await fetch(`${BACKEND_URL}/api/type`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: sessionInfo.device.id,
                strategy: locator.strategy,
                value: locator.value,
                text
            })
        });
        setTimeout(() => refreshPageSource(true), 800);
    } catch (error) {
        console.error('Type (element) failed:', error);
    }
}

// Forward typed text to the focused element on the device.
async function sendKeysToDevice(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!sessionInfo || !sessionInfo.device) return;
    try {
        await fetch(`${BACKEND_URL}/api/type`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: sessionInfo.device.id, text })
        });
    } catch (error) {
        console.error('Type failed:', error);
    }
}

// When recording, flush the accumulated text as a single input step.
function commitTypingStep() {
    if (isRecording && typingBuffer && typingTargetElement) {
        const locator = getRecommendedLocator(typingTargetElement);
        if (locator) {
            recordedSteps.push({ locator, action: 'input', text: typingBuffer, label: typingTargetElement.tagName });
            renderRecordTab();
            renderRecordedTab();
            showNotification('Input step recorded', 'success');
        }
    }
    typingBuffer = '';
}

// Keyboard capture: in Interact or Record mode, forward keystrokes to the device
// (live typing) and buffer them for the recorded input step.
function handleKeyboardInput(e) {
    // Live keyboard forwarding is for Interact mode; recording uses the Type button.
    if (!isInteractMode) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // Don't hijack typing into the inspector's own inputs (search box, selects…)
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;

    if (e.key === 'Backspace') {
        e.preventDefault();
        typingBuffer = typingBuffer.slice(0, -1);
        sendKeysToDevice(''); // WDIO/W3C backspace
    } else if (e.key === 'Enter') {
        e.preventDefault();
        commitTypingStep();
        sendKeysToDevice('\n');
    } else if (e.key.length === 1) {
        e.preventDefault();
        typingBuffer += e.key;
        sendKeysToDevice(e.key);
    }
}

function toggleMode() {
    isInteractMode = !isInteractMode;

    const inspectIcon = document.getElementById('inspect-icon');
    const interactIcon = document.getElementById('interact-icon');
    const modeLabel = document.getElementById('mode-label');

    if (isInteractMode) {
        // Switch to interact mode
        modeToggleBtn.classList.add('active');
        inspectIcon.style.display = 'none';
        interactIcon.style.display = 'block';
        modeLabel.textContent = 'Interact';
        screenImage.style.cursor = 'pointer';
        clearElementHighlight();
        isElementLocked = false;
        showNotification('Interact Mode: Click to tap, Drag to scroll', 'info');
        
    } else {
        // Switch to inspect mode
        modeToggleBtn.classList.remove('active');
        inspectIcon.style.display = 'block';
        interactIcon.style.display = 'none';
        modeLabel.textContent = 'Inspect';
        screenImage.style.cursor = 'crosshair';
        showNotification('Inspect Mode: Click to select elements', 'info');
        
    }
}

async function handleScreenClick(event) {
    console.log('Screen clicked!', { mode: isInteractMode ? 'interact' : 'inspect', currentPageSource: !!currentPageSource, currentXmlDoc: !!currentXmlDoc });

    // Get click coordinates relative to image
    const rect = screenImage.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    // Calculate actual pixel coordinates on the screenshot image
    const scaleX = screenImage.naturalWidth / rect.width;
    const scaleY = screenImage.naturalHeight / rect.height;

    const imageX = Math.round(clickX * scaleX);
    const imageY = Math.round(clickY * scaleY);

    console.log(`Click at display: (${clickX}, ${clickY}) → image: (${imageX}, ${imageY})`);

    // For XML search, we need coordinates in "points" (which might differ from pixels on Retina)
    const deviceX = imageX / coordinateScale;
    const deviceY = imageY / coordinateScale;

    console.log(`Device Search Coords: (${deviceX}, ${deviceY}) (Scale: ${coordinateScale})`);

    if (isRecording) {
        // Recording : tapping SELECTS the element — the actual action
        // is chosen from the Record panel buttons. No auto-record, no device drive here.
        if (!currentPageSource || !currentXmlDoc) {
            await refreshPageSource();
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (currentXmlDoc) {
            const node = findXmlElementAtPoint(deviceX, deviceY);
            if (node) {
                drawElementHighlight(node, true);
                recordSelected = { element: elementFromNode(node), x: deviceX, y: deviceY };
                renderRecordTab();
            }
        }
        return;
    }

    if (isInteractMode) {
        // Interact mode: Send tap to device (WDA expects points usually, or pixels?)
        // WDA usually handles scaling automatically, or expects points.
        // Let's send points (deviceX/Y)
        await sendTap(deviceX, deviceY);
        return;
    }

    // Inspect mode: Select element
    if (!currentPageSource || !currentXmlDoc) {
        console.log('Page source not available, fetching...');
        showNotification('Fetching page source...', 'info');
        await refreshPageSource();

        // Wait a bit for the page source to arrive
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (!currentPageSource || !currentXmlDoc) {
            showNotification('Please wait for page source to load, then try again', 'warning');
            return;
        }
    }

    // Lock the element selection on click
    isElementLocked = true;

    // Find element at these coordinates in page source
    findElementAtCoordinates(deviceX, deviceY, true); // true = isClick
}

function handleScreenHover(event) {
    // Don't change selection if locked
    if (isElementLocked) return;

    if (!currentPageSource || !currentXmlDoc) return;

    // Get coordinates (same logic as click)
    const rect = screenImage.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    const scaleX = screenImage.naturalWidth / rect.width;
    const scaleY = screenImage.naturalHeight / rect.height;

    const imageX = Math.round(clickX * scaleX);
    const imageY = Math.round(clickY * scaleY);

    const deviceX = imageX / coordinateScale;
    const deviceY = imageY / coordinateScale;

    // Find element without selecting it permanently
    findElementAtCoordinates(deviceX, deviceY, false);
}

// Pure hit-test: smallest element whose bounds contain the point. No side effects.
function findXmlElementAtPoint(x, y) {
    if (!currentXmlDoc) return null;

    let foundElement = null;
    let smallestArea = Infinity;

    function traverseElement(element) {
        const bounds = element.getAttribute('bounds');
        let x1, y1, x2, y2;

        if (bounds) {
            const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
            if (match) {
                [, x1, y1, x2, y2] = match.map(Number);
            }
        } else if (element.getAttribute('x') && element.getAttribute('width')) {
            x1 = parseFloat(element.getAttribute('x'));
            y1 = parseFloat(element.getAttribute('y'));
            const w = parseFloat(element.getAttribute('width'));
            const h = parseFloat(element.getAttribute('height'));
            x2 = x1 + w;
            y2 = y1 + h;
        }

        if (x1 !== undefined) {
            if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
                const area = (x2 - x1) * (y2 - y1);
                let isBetter = false;

                if (foundElement === null) {
                    isBetter = true;
                } else if (area < smallestArea) {
                    isBetter = true;
                } else if (area === smallestArea) {
                    const currentHasName = !!(element.getAttribute('name') || element.getAttribute('label'));
                    const foundHasName = !!(foundElement.getAttribute('name') || foundElement.getAttribute('label'));
                    if (currentHasName && !foundHasName) isBetter = true;
                }

                if (isBetter) {
                    smallestArea = area;
                    foundElement = element;
                }
            }
        }

        if (element.childNodes) {
            for (let i = 0; i < element.childNodes.length; i++) {
                const child = element.childNodes[i];
                if (child.nodeType === 1) traverseElement(child);
            }
        }
    }

    traverseElement(currentXmlDoc.documentElement);
    return foundElement;
}

// Build the selectedElement-style object from an xml node.
function elementFromNode(node) {
    return {
        tagName: node.tagName,
        attributes: LocatorGenerator.extractAttributes(node),
        xpath: LocatorGenerator.generateXPath(node),
        xmlNode: node
    };
}

function findElementAtCoordinates(x, y, isClick = false) {
    if (!currentXmlDoc) {
        console.error('currentXmlDoc is null!');
        showNotification('Page source not loaded', 'error');
        return;
    }

    const foundElement = findXmlElementAtPoint(x, y);

    if (foundElement) {
        drawElementHighlight(foundElement, isClick);
        highlightElementInTree(foundElement);
        selectedElement = elementFromNode(foundElement);
        displayElementDetails(selectedElement, isClick);
        if (isClick) showNotification(`Element found: ${foundElement.tagName}`, 'success');
    } else if (isClick) {
        deselectElement();
    } else {
        clearElementHighlight();
    }
}

function drawElementHighlight(xmlElement, isClick = false) {
    const displayRect = getDisplayRectForElement(xmlElement);
    if (!displayRect) return;

    clearElementHighlight();
    positionScreenOverlay();

    const highlight = document.createElement('div');
    highlight.className = `element-highlight ${isClick ? '' : 'hover'}`;
    highlight.style.left = `${displayRect.x}px`;
    highlight.style.top = `${displayRect.y}px`;
    highlight.style.width = `${displayRect.width}px`;
    highlight.style.height = `${displayRect.height}px`;

    // If the element spans (almost) the whole screen — e.g. the root
    // XCUIElementTypeApplication — round the highlight to match the device
    // screen corners so it doesn't look broken at the four corners.
    const imgRect = screenImage.getBoundingClientRect();
    if (displayRect.width >= imgRect.width * 0.98 && displayRect.height >= imgRect.height * 0.98) {
        const screenContainer = document.getElementById('screen-container');
        if (screenContainer) {
            highlight.style.borderRadius = getComputedStyle(screenContainer).borderTopLeftRadius;
        }
    }

    document.getElementById('screen-overlay').appendChild(highlight);
}

function getDisplayRectForElement(xmlElement) {
    let x1, y1, x2, y2;
    let needsScaling = false; // Android bounds are in pixels, iOS are in points

    // Get coords in POINTS (iOS) or PIXELS (Android)
    const bounds = xmlElement.getAttribute('bounds');
    if (bounds) {
        // Android - bounds are already in pixels, no scaling needed
        const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
        if (match) {
            [, x1, y1, x2, y2] = match.map(Number);
            needsScaling = false;
        }
    } else if (xmlElement.getAttribute('x')) {
        // iOS - coordinates are in points, need to scale to pixels
        x1 = parseFloat(xmlElement.getAttribute('x'));
        y1 = parseFloat(xmlElement.getAttribute('y'));
        const w = parseFloat(xmlElement.getAttribute('width'));
        const h = parseFloat(xmlElement.getAttribute('height'));
        x2 = x1 + w;
        y2 = y1 + h;
        needsScaling = true;
    }

    if (x1 === undefined) return;

    // Convert Points -> Pixels (only for iOS)
    if (needsScaling) {
        x1 *= coordinateScale;
        y1 *= coordinateScale;
        x2 *= coordinateScale;
        y2 *= coordinateScale;
    }

    // Get the screen image dimensions
    const rect = screenImage.getBoundingClientRect();
    const scaleX = rect.width / screenImage.naturalWidth;
    const scaleY = rect.height / screenImage.naturalHeight;

    // Scale coordinates to display size
    const displayX = x1 * scaleX;
    const displayY = y1 * scaleY;
    const displayWidth = (x2 - x1) * scaleX;
    const displayHeight = (y2 - y1) * scaleY;

    return {
        x: displayX,
        y: displayY,
        width: displayWidth,
        height: displayHeight
    };
}

function positionScreenOverlay() {
    const screenOverlay = document.getElementById('screen-overlay');
    const container = document.getElementById('screen-container');
    const imageRect = screenImage.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    screenOverlay.style.position = 'absolute';
    screenOverlay.style.left = `${imageRect.left - containerRect.left}px`;
    screenOverlay.style.top = `${imageRect.top - containerRect.top}px`;
    screenOverlay.style.width = `${imageRect.width}px`;
    screenOverlay.style.height = `${imageRect.height}px`;
}

function clearElementHighlight() {
    const screenOverlay = document.getElementById('screen-overlay');
    if (screenOverlay) screenOverlay.innerHTML = '';
}

// Clear the current selection entirely: highlight box, tree selection,
// and reset Element Details back to its empty state.
function deselectElement() {
    clearElementHighlight();
    clearLocatorMatchHighlights();
    selectedElement = null;
    isElementLocked = false;

    document.querySelectorAll('.tree-node-header.selected').forEach(el => {
        el.classList.remove('selected');
    });

    resetDetailPanes();
}

/* ── Element Details tabs (Locators / Attributes / Record / Recorded) ── */
function activateDetailTab(name) {
    document.querySelectorAll('.detail-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.detail-pane').forEach(p => p.classList.toggle('active', p.id === `dpane-${name}`));
}

function setupDetailTabs() {
    document.querySelectorAll('.detail-tab').forEach(tab => {
        tab.addEventListener('click', () => activateDetailTab(tab.dataset.tab));
    });
}

// Reset the data-driven panes to their empty state (keeps the tabs intact).
function resetDetailPanes() {
    const loc = document.getElementById('dpane-locators');
    const attr = document.getElementById('dpane-attributes');
    if (loc) {
        loc.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5" />
                    <path d="M9 9L15 15M15 9L9 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
                <p>Tap an element on the screen and its locators show up here.</p>
            </div>`;
    }
    if (attr) attr.innerHTML = '<div class="pane-empty">Tap an element to see its attributes.</div>';
}

/* ── Record → Recorded script (live-drive codegen) ─────── */
function stepLabel(s) {
    if (s.action === 'assert') return `assert ${s.matcher}`;
    if (s.action === 'tap') return 'tap';
    if (s.action === 'input') return `type "${s.text || ''}"`;
    if (s.action === 'swipe') return `swipe ${s.direction || ''}`;
    return s.action; // doubleTap, longPress, pinchOpen, pinchClose, clear
}

function stepRowsHtml() {
    return recordedSteps.map((s, i) => `
        <div class="step-row">
            <span class="step-index">${i + 1}</span>
            <div class="step-body">
                <div class="step-action">${escapeHtml(stepLabel(s))} <span class="step-type">${escapeHtml(s.label || '')}</span></div>
                <div class="step-locator"><span class="step-strategy">${escapeHtml(s.locator.strategy)}</span> ${escapeHtml(s.locator.value)}</div>
            </div>
            <button class="step-delete" data-step-index="${i}" title="Remove step" type="button">&times;</button>
        </div>
    `).join('');
}

function renderRecordTab() {
    const pane = document.getElementById('dpane-record');
    if (!pane) return;
    const n = recordedSteps.length;
    const sel = recordSelected;
    const dis = sel ? '' : 'disabled';
    const selTitle = sel ? escapeHtml(sel.element.tagName) : 'No element selected';
    const selSub = sel
        ? escapeHtml(`${getRecommendedLocator(sel.element)?.strategy || ''} ${getRecommendedLocator(sel.element)?.value || ''}`)
        : (isRecording ? 'Tap an element on the screen to select it.' : 'Press Start, then tap an element.');

    const actionsPane = `
        <button class="rec-act primary" data-act="tap" ${dis}><span class="ico">▶</span> Click</button>
        <div class="rec-grid2">
            <button class="rec-act" data-act="doubleTap" ${dis}>Double tap</button>
            <button class="rec-act" data-act="longPress" ${dis}>Long press</button>
        </div>
        <div class="rec-subtitle">Swipe</div>
        <div class="rec-grid4">
            <button class="rec-act" data-act="swipe" data-dir="up" ${dis}>↑</button>
            <button class="rec-act" data-act="swipe" data-dir="down" ${dis}>↓</button>
            <button class="rec-act" data-act="swipe" data-dir="left" ${dis}>←</button>
            <button class="rec-act" data-act="swipe" data-dir="right" ${dis}>→</button>
        </div>
        <div class="rec-subtitle">Pinch</div>
        <div class="rec-grid2">
            <button class="rec-act" data-act="pinchOpen" ${dis}>Pinch out (zoom in)</button>
            <button class="rec-act" data-act="pinchClose" ${dis}>Pinch in (zoom out)</button>
        </div>
        <div class="rec-subtitle">Type text</div>
        <div class="rec-input-row">
            <input class="rec-input" id="rec-type-input" placeholder="Text to type…" ${dis}>
            <button class="rec-act" data-act="input" ${dis}>Type</button>
            <button class="rec-act" data-act="clear" ${dis} title="Clear the field">Clear</button>
        </div>`;

    const assertPane = `
        <div class="rec-grid2">
            <button class="rec-act" data-assert="visible" ${dis}>Visible</button>
            <button class="rec-act" data-assert="hidden" ${dis}>Hidden</button>
            <button class="rec-act" data-assert="enabled" ${dis}>Enabled</button>
            <button class="rec-act" data-assert="disabled" ${dis}>Disabled</button>
            <button class="rec-act" data-assert="checked" ${dis}>Checked</button>
            <button class="rec-act" data-assert="unchecked" ${dis}>Unchecked</button>
            <button class="rec-act" data-assert="empty" ${dis}>Empty</button>
        </div>`;

    pane.innerHTML = `
        <div class="record-panel">
            <button id="record-toggle" class="btn ${isRecording ? 'btn-quiet' : 'btn-primary'} record-toggle" type="button">
                ${isRecording ? '■ Stop recording' : '● Start recording'}
            </button>

            <div class="rec-selected ${sel ? 'has-sel' : ''}">
                <div class="rec-sel-title">${selTitle}</div>
                <div class="rec-sel-sub">${selSub}</div>
            </div>

            <div class="rec-subtabs">
                <button class="rec-subtab ${recSubtab === 'actions' ? 'active' : ''}" data-recsub="actions" type="button">Actions</button>
                <button class="rec-subtab ${recSubtab === 'assert' ? 'active' : ''}" data-recsub="assert" type="button">Assertions</button>
            </div>
            <div class="rec-subpane">${recSubtab === 'actions' ? actionsPane : assertPane}</div>

            ${n
                ? `<div class="record-live-head">${n} step${n === 1 ? '' : 's'} · <a href="#" id="goto-recorded">view &amp; export</a></div>
                   <div class="step-list">${stepRowsHtml()}</div>`
                : ''}
        </div>
    `;
}

function renderRecordedTab() {
    const pane = document.getElementById('dpane-recorded');
    if (!pane) return;
    if (!recordedSteps.length) {
        pane.innerHTML = '<div class="pane-empty">No steps yet. Switch to Record and tap elements to capture a flow.</div>';
        return;
    }
    const rows = stepRowsHtml();
    const platform = sessionInfo?.device?.platform;
    const script = exportFullFile
        ? SnippetGenerator.generateTestFile(recordedSteps, platform, snippetLang)
        : SnippetGenerator.generateScript(recordedSteps, platform, snippetLang);
    pane.innerHTML = `
        <div class="recorded-toolbar">
            <div class="snippet-lang">
                <label for="script-lang-select">Export as</label>
                <select id="script-lang-select" class="method-select">
                    ${SnippetGenerator.TARGETS.map(t => `<option value="${t.id}" ${t.id === snippetLang ? 'selected' : ''}>${t.label}</option>`).join('')}
                </select>
            </div>
            <div class="recorded-actions">
                <button id="export-script" class="btn btn-primary btn-sm" type="button">Copy ${exportFullFile ? 'test file' : 'steps'}</button>
                <button id="clear-steps" class="btn btn-quiet btn-sm" type="button">Clear</button>
            </div>
        </div>
        <label class="full-file-toggle"><input type="checkbox" id="full-file-check" ${exportFullFile ? 'checked' : ''}> Full test file (imports &amp; test wrapper)</label>
        <div class="step-list">${rows}</div>
        <div class="script-block">
            <button class="copy-script-icon" id="copy-script-icon" type="button" title="Copy code">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
            </button>
            <pre class="script-preview"><code>${escapeHtml(script)}</code></pre>
        </div>
    `;
}

function toggleRecording() {
    isRecording = !isRecording;
    recordSelected = null;
    showNotification(isRecording ? 'Recording started — tap an element, then pick an action' : 'Recording stopped', isRecording ? 'success' : 'info');
    renderRecordTab();
    activateDetailTab('record'); // stay on the Record tab, codegen-style
}

function addRecordedStep(element) {
    const locator = getRecommendedLocator(element);
    if (!locator) {
        showNotification('Could not build a locator for that element — step skipped', 'warning');
        return;
    }
    recordedSteps.push({ locator, action: 'tap', label: element.tagName });
    renderRecordTab();
    renderRecordedTab();
    showNotification(`Step ${recordedSteps.length} recorded`, 'success');
}

function deleteStep(index) {
    recordedSteps.splice(index, 1);
    renderRecordTab();
    renderRecordedTab();
}

function clearSteps() {
    recordedSteps = [];
    recordSelected = null;
    renderRecordTab();
    renderRecordedTab();
}

function activateRecSub(name) {
    recSubtab = name;
    renderRecordTab();
}

// Apply an action from the Record panel to the currently selected element.
async function performRecordAction(act, dir) {
    if (!recordSelected) return;
    const el = recordSelected.element;
    const locator = getRecommendedLocator(el);
    if (!locator) { showNotification('Could not build a locator for that element', 'warning'); return; }

    const stepObj = { locator, action: act, label: el.tagName };
    if (act === 'input') stepObj.text = document.getElementById('rec-type-input')?.value || '';
    if (act === 'swipe') stepObj.direction = dir || 'up';

    recordedSteps.push(stepObj);
    renderRecordTab();
    renderRecordedTab();
    showNotification('Step recorded', 'success');

    // Live-drive on the device so the app advances.
    const { x, y } = recordSelected;
    if (act === 'tap') {
        await sendTap(x, y);
    } else if (act === 'input') {
        await sendTextToElement(stepObj.locator, stepObj.text);
    } else if (act === 'doubleTap' || act === 'longPress') {
        await sendGestureToDevice(act, { x, y });
    } else if (act === 'swipe') {
        await sendGestureToDevice('swipe', { direction: stepObj.direction, ...(deviceRectOf(el) || {}) });
    } else if (act === 'pinchOpen' || act === 'pinchClose') {
        await sendGestureToDevice(act, { ...(deviceRectOf(el) || {}) });
    }
    // 'clear' is recorded only (no destructive device action)
}

function recordAssertion(matcher) {
    if (!recordSelected) return;
    const locator = getRecommendedLocator(recordSelected.element);
    if (!locator) { showNotification('Could not build a locator for that element', 'warning'); return; }
    recordedSteps.push({ locator, action: 'assert', matcher, label: recordSelected.element.tagName });
    renderRecordTab();
    renderRecordedTab();
    showNotification(`Assertion recorded: ${matcher}`, 'success');
}

async function exportScript() {
    const platform = sessionInfo?.device?.platform;
    const script = exportFullFile
        ? SnippetGenerator.generateTestFile(recordedSteps, platform, snippetLang)
        : SnippetGenerator.generateScript(recordedSteps, platform, snippetLang);
    if (!script) { showNotification('No steps to export yet', 'warning'); return; }
    await copyToClipboard(script, document.getElementById('export-script'));
}

// Delegated controls for the Record / Recorded panes
function setupRecordControls() {
    elementDetails.addEventListener('click', (e) => {
        if (e.target.closest('#record-toggle')) { toggleRecording(); return; }
        if (e.target.closest('#goto-recorded')) { e.preventDefault(); activateDetailTab('recorded'); return; }
        if (e.target.closest('#export-script')) { exportScript(); return; }
        if (e.target.closest('#copy-script-icon')) { exportScript(); return; }
        if (e.target.closest('#clear-steps')) { clearSteps(); return; }
        const sub = e.target.closest('.rec-subtab[data-recsub]');
        if (sub) { activateRecSub(sub.dataset.recsub); return; }
        const actBtn = e.target.closest('.rec-act[data-act]');
        if (actBtn) { performRecordAction(actBtn.dataset.act, actBtn.dataset.dir); return; }
        const asrtBtn = e.target.closest('.rec-act[data-assert]');
        if (asrtBtn) { recordAssertion(asrtBtn.dataset.assert); return; }
        const del = e.target.closest('.step-delete');
        if (del) { deleteStep(Number(del.dataset.stepIndex)); return; }
    });
    elementDetails.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'script-lang-select') {
            snippetLang = e.target.value;
            try { localStorage.setItem('ali-snippet-lang', snippetLang); } catch (err) { /* ignore */ }
            renderRecordedTab();
        } else if (e.target && e.target.id === 'full-file-check') {
            exportFullFile = e.target.checked;
            renderRecordedTab();
        }
    });
    renderRecordTab();
    renderRecordedTab();
}

function highlightElementInTree(xmlElement) {
    // Use direct element-to-node mapping for precise navigation
    const headerDiv = elementToNodeMap.get(xmlElement);

    if (!headerDiv) {
        console.warn('Element not found in tree map');
        return;
    }

    // Clear previous selections
    document.querySelectorAll('.tree-node-header.selected').forEach(el => {
        el.classList.remove('selected');
    });

    // Select this element
    headerDiv.classList.add('selected');

    revealTreeHeader(headerDiv);

    // Scroll into view
    headerDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function revealTreeHeader(headerDiv) {
    let parent = headerDiv.parentElement; // Start with .tree-node
    while (parent) {
        if (parent.classList.contains('tree-children')) {
            parent.classList.add('expanded');

            // Also expand the toggle arrow of the parent header
            const parentNode = parent.parentElement; // .tree-node
            if (parentNode) {
                const parentHeader = parentNode.querySelector(':scope > .tree-node-header');
                if (parentHeader) {
                    const toggle = parentHeader.querySelector('.tree-toggle');
                    if (toggle) {
                        toggle.classList.add('expanded');
                    }
                }
            }
        }
        parent = parent.parentElement;
    }
}

function clearLocatorMatchHighlights() {
    document.querySelectorAll('.tree-node-header.locator-match').forEach(el => {
        el.classList.remove('locator-match');
    });
}

let pageSourceTimeout = null;

async function refreshPageSource(silent = false) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Prevent multiple simultaneous requests
    if (isLoadingPageSource) {
        console.log('Page source already loading, skipping...');
        return;
    }

    isLoadingPageSource = true;
    pendingPageSourceRefreshSource = silent ? 'auto' : 'manual';
    if (!silent) {
        sourceLoading.classList.remove('hidden');
    }

    // Safety timeout - reset loading flag if response never arrives
    if (pageSourceTimeout) clearTimeout(pageSourceTimeout);
    pageSourceTimeout = setTimeout(() => {
        if (isLoadingPageSource) {
            console.warn('Page source request timed out, resetting...');
            isLoadingPageSource = false;
            sourceLoading.classList.add('hidden');
            refreshBtn.classList.remove('spinning');
        }
    }, 15000);

    ws.send(JSON.stringify({
        type: 'get-page-source'
    }));
}

function updatePageSource(xmlString) {
    currentPageSource = xmlString;
    isLoadingPageSource = false; // Reset loading flag
    if (pageSourceTimeout) clearTimeout(pageSourceTimeout); // Clear safety timeout
    if (screenChangeDebounceTimer) { // Cancel any pending auto-refresh
        clearTimeout(screenChangeDebounceTimer);
        screenChangeDebounceTimer = null;
    }
    sourceLoading.classList.add('hidden'); // Always hide on complete
    refreshBtn.classList.remove('spinning'); // Stop button animation
    hideStaleIndicator(); // Clear stale indicator since we just refreshed
    capturePageSourceSnapshot(); // Save screen snapshot for change detection

    // Clear stale UI state from previous page source
    clearElementHighlight(); // Remove highlight box from screen
    selectedElement = null; // Clear selected element
    isElementLocked = false; // Unlock element selection

    // Clear any tree selections
    document.querySelectorAll('.tree-node-header.selected').forEach(el => {
        el.classList.remove('selected');
    });

    // Clear search highlights
    clearSearchHighlights();
    clearLocatorMatchHighlights();

    // Reset element details panes to empty state (keeps the tabs)
    resetDetailPanes();

    // Parse XML once
    const parser = new DOMParser();
    currentXmlDoc = parser.parseFromString(xmlString, 'text/xml');
    const xmlDoc = currentXmlDoc;

    console.log('Page source updated, root element:', xmlDoc.documentElement.tagName);

    // Calculate Coordinate Scale (Retina Detection)
    // ---------------------------------------------
    // Image Pixel Width vs XML Point Width
    if (screenImage && screenImage.naturalWidth > 0) {
        const screenWidth = screenImage.naturalWidth;
        let xmlMaxWidth = 0;

        // Scan for XCUIElementTypeApplication specifically first
        let appWidth = 0;
        const appEl = xmlDoc.querySelector('XCUIElementTypeApplication');
        if (appEl) {
            if (appEl.getAttribute('bounds')) {
                const match = appEl.getAttribute('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
                if (match) {
                    const [_, x1, y1, x2, y2] = match.map(Number);
                    appWidth = x2 - x1;
                }
            } else if (appEl.getAttribute('width')) {
                appWidth = parseFloat(appEl.getAttribute('width'));
            }
        }

        let xmlReferenceWidth = appWidth;

        // If no app element (rare), fallback to max width scanning but ignore potentially huge overlays
        // unless they are the only thing there.
        if (xmlReferenceWidth === 0) {
            console.log('No Application element found, scanning all elements...');
            const allElements = xmlDoc.getElementsByTagName('*');
            let maxW = 0;
            for (let i = 0; i < allElements.length; i++) {
                const el = allElements[i];
                // Skip StatusBars or other system overlays which might be in native pixels
                if (el.tagName.includes('StatusBar')) continue;

                let w = 0;
                if (el.getAttribute('width')) {
                    w = parseFloat(el.getAttribute('width'));
                }
                if (w > maxW) maxW = w;
            }
            xmlReferenceWidth = maxW;
        }

        console.log(`Scaling Check: ImageWidth=${screenWidth}, XMLRefWidth=${xmlReferenceWidth}`);

        if (xmlReferenceWidth > 0) {
            // If XML width is significantly smaller than image width, it's likely Points vs Pixels
            // e.g. Image 1206, XML 402 -> Scale 3.0
            const ratio = screenWidth / xmlReferenceWidth;

            if (Math.abs(ratio - 1.0) < 0.1) {
                coordinateScale = 1.0;
            } else if (ratio > 1.5) {
                // It's likely a retina scale (2.0, 3.0 etc)
                coordinateScale = Math.round(ratio * 10) / 10; // Round to 1 decimal
            } else {
                coordinateScale = 1.0;
            }
            console.log(`Scale: ${coordinateScale} (Calculated from ratio ${ratio})`);
        } else {
            coordinateScale = 1.0;
        }
    }

    // Count elements
    const allElements = xmlDoc.getElementsByTagName('*');
    elementCount.textContent = `${allElements.length} elements`;
    

    // Reset element-to-node mapping for new page source
    elementToNodeMap = new WeakMap();
    nodeIdCounter = 0;

    // Render tree
    sourceTree.innerHTML = '';
    renderTree(xmlDoc.documentElement, sourceTree);
}

function renderTree(xmlNode, container, level = 0) {
    // container.innerHTML = ''; // removed to avoid clearing siblings in recursion

    if (!xmlNode || !xmlNode.tagName) return;

    const treeDiv = document.createElement('div');
    treeDiv.className = 'tree-node';

    const headerDiv = document.createElement('div');
    headerDiv.className = 'tree-node-header';
    headerDiv.dataset.level = level;
    headerDiv.dataset.elementId = nodeIdCounter++; // Assign unique ID

    // Store mapping from XML element to DOM tree node
    elementToNodeMap.set(xmlNode, headerDiv);

    const hasChildren = xmlNode.children && xmlNode.children.length > 0;

    // Toggle icon
    if (hasChildren) {
        const toggle = document.createElement('span');
        toggle.className = 'tree-toggle';
        toggle.innerHTML = '▶';
        headerDiv.appendChild(toggle);
    } else {
        const spacer = document.createElement('span');
        spacer.style.width = '14px';
        headerDiv.appendChild(spacer);
    }

    // Tag name
    const tagSpan = document.createElement('span');
    tagSpan.className = 'tree-tag';
    tagSpan.textContent = `<${xmlNode.tagName}`;
    headerDiv.appendChild(tagSpan);

    // Key attributes
    const keyAttrs = getKeyAttributes(xmlNode);
    if (keyAttrs.length > 0) {
        const attrSpan = document.createElement('span');
        attrSpan.innerHTML = ' ' + keyAttrs.map(attr =>
            `<span class="tree-attr-name">${attr.name}</span>=<span class="tree-attr-value">"${attr.value}"</span>`
        ).join(' ');
        headerDiv.appendChild(attrSpan);
    }

    const closingTag = document.createElement('span');
    closingTag.className = 'tree-tag';
    closingTag.textContent = hasChildren ? '>' : '/>';
    headerDiv.appendChild(closingTag);

    let childrenDiv = null;

    // Click handler
    headerDiv.addEventListener('click', (e) => {
        e.stopPropagation();

        if (hasChildren && e.target.classList.contains('tree-toggle')) {
            if (childrenDiv) {
                toggleNode(headerDiv, childrenDiv);
            }
        } else {
            selectElement(xmlNode, headerDiv);
        }
    });

    // Hover handler - highlight on screen when hovering tree node
    headerDiv.addEventListener('mouseenter', () => {
        if (!isElementLocked) {
            drawElementHighlight(xmlNode, false);
        }
    });

    treeDiv.appendChild(headerDiv);

    // Children
    if (hasChildren) {
        childrenDiv = document.createElement('div');
        childrenDiv.className = 'tree-children';

        Array.from(xmlNode.children).forEach(child => {
            if (child.nodeType === 1) { // Only render Element nodes
                renderTree(child, childrenDiv, level + 1);
            }
        });

        treeDiv.appendChild(childrenDiv);
    }

    container.appendChild(treeDiv);
}

// Helper to get valid element children
function getElementChildren(node) {
    if (!node.children) return [];
    return Array.from(node.children).filter(child => child.nodeType === 1); // 1 = ELEMENT_NODE
}

function getKeyAttributes(xmlNode) {
    const keyAttrNames = [
        'resource-id', 'content-desc', 'text', 'name', 'label', 'value',
        'class', 'id', 'type', 'enabled', 'clickable'
    ];

    const attrs = [];
    if (xmlNode.attributes) {
        for (let i = 0; i < xmlNode.attributes.length; i++) {
            const attr = xmlNode.attributes[i];
            if (keyAttrNames.includes(attr.name) && attr.value) {
                attrs.push({ name: attr.name, value: attr.value });
            }
        }
    }

    return attrs.slice(0, 3); // Limit to 3 key attributes
}

function toggleNode(headerDiv, childrenDiv) {
    const toggle = headerDiv.querySelector('.tree-toggle');
    const willExpand = !childrenDiv.classList.contains('expanded');

    if (!willExpand) {
        childrenDiv.classList.remove('expanded');
        toggle.classList.remove('expanded');
    } else {
        childrenDiv.classList.add('expanded');
        toggle.classList.add('expanded');
    }
    
}

function selectElement(xmlNode, headerDiv) {
    // Remove previous selection
    document.querySelectorAll('.tree-node-header.selected').forEach(el => {
        el.classList.remove('selected');
    });

    // Add new selection
    headerDiv.classList.add('selected');

    // Draw highlight on screen mirror
    drawElementHighlight(xmlNode, true);

    // Extract attributes
    const attributes = LocatorGenerator.extractAttributes(xmlNode);
    const xpath = LocatorGenerator.generateXPath(xmlNode);

    selectedElement = {
        tagName: xmlNode.tagName,
        attributes,
        xpath,
        xmlNode
    };

    // Generate and display locators
    displayElementDetails(selectedElement, true);
    
}

function countMatchingElements(locator) {
    return getMatchingElements(locator).length;
}

function getMatchingElements(locator) {
    if (!currentXmlDoc || !locator) return [];

    try {
        const strategy = locator.strategy;
        const value = locator.value;

        if (strategy === 'id' || strategy === 'resource-id') {
            return getElementsByAttribute('resource-id', value);
        }

        if (strategy === 'accessibility id') {
            return [
                ...getElementsByAttribute('name', value),
                ...getElementsByAttribute('content-desc', value)
            ];
        }

        if (strategy === 'class name') {
            return getElementsByAttribute('class', value);
        }

        if (strategy === 'xpath') {
            return evaluateXPath(value);
        }

        if (strategy === '-android uiautomator') {
            const resourceId = extractQuotedSelectorValue(value, 'resourceId');
            if (resourceId) return getElementsByAttribute('resource-id', resourceId);

            const text = extractQuotedSelectorValue(value, 'text');
            if (text) return getElementsByAttribute('text', text);
        }

        if (strategy === '-ios predicate string') {
            const predicate = parseSimplePredicate(value);
            if (predicate) return getElementsByAttribute(predicate.attribute, predicate.value);
        }

        if (strategy === '-ios class chain') {
            let matches = [];
            const className = extractIOSClassName(value);
            if (className) {
                matches = Array.from(currentXmlDoc.getElementsByTagName(className));
            }

            const predicate = parseSimplePredicate(value);
            if (predicate) {
                const predicateMatches = getElementsByAttribute(predicate.attribute, predicate.value);
                if (matches.length > 0) {
                    return predicateMatches.filter(element => matches.includes(element));
                }
                return predicateMatches;
            }

            return matches;
        }
    } catch (e) {
        console.error('Error matching elements:', e);
    }

    return [];
}

function getElementsByAttribute(attribute, value) {
    return Array.from(currentXmlDoc.getElementsByTagName('*')).filter(element => (
        element.getAttribute(attribute) === value
    ));
}

function evaluateXPath(xpath) {
    try {
        const result = currentXmlDoc.evaluate(
            xpath,
            currentXmlDoc,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
        );
        const matches = [];
        for (let i = 0; i < result.snapshotLength; i++) {
            matches.push(result.snapshotItem(i));
        }
        return matches;
    } catch (e) {
        console.warn('XPath evaluation error:', e);
        return [];
    }
}

function extractQuotedSelectorValue(selector, methodName) {
    const match = selector.match(new RegExp(`${methodName}\\("((?:\\\\.|[^"])*)"\\)`));
    return match ? unescapeLocatorString(match[1]) : '';
}

function parseSimplePredicate(predicate) {
    const match = predicate.match(/\b(name|label|value)\s*==\s*"((?:\\.|[^"])*)"/);
    if (!match) return null;

    return {
        attribute: match[1],
        value: unescapeLocatorString(match[2])
    };
}

function extractIOSClassName(classChain) {
    const match = classChain.match(/(?:^|\/)(XCUIElementType[A-Za-z0-9_]+)/);
    return match ? match[1] : '';
}

function unescapeLocatorString(value) {
    return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function getMatchCountClass(matchCount) {
    if (matchCount === 1) return 'count-unique';
    if (matchCount === 0) return 'count-none';
    return 'count-multiple';
}

function formatMatchCount(matchCount) {
    return `${matchCount} ${matchCount === 1 ? 'match' : 'matches'}`;
}

function getMatchCountBucket(matchCount) {
    if (matchCount === 1) return '1';
    if (matchCount <= 5) return '2_5';
    if (matchCount <= 20) return '6_20';
    return '20_plus';
}

function buildLocatorDisplayItems(locators, selectedXmlNode) {
    let items = locators
        .map(locator => ({
            locator,
            matchCount: countMatchingElements(locator)
        }))
        .filter(item => item.matchCount > 0);

    const hasUniqueLocator = items.some(item => item.matchCount === 1);

    if (!hasUniqueLocator && selectedXmlNode) {
        const fallbackLocators = createUniqueFallbackLocators(selectedXmlNode, locators);
        const fallbackItems = fallbackLocators
            .map(locator => ({
                locator,
                matchCount: countMatchingElements(locator)
            }))
            .filter(item => item.matchCount === 1);

        items = [...fallbackItems, ...items];
    }

    return items.sort((a, b) => {
        const uniqueDelta = Number(b.matchCount === 1) - Number(a.matchCount === 1);
        if (uniqueDelta !== 0) return uniqueDelta;
        return b.locator.priority - a.locator.priority;
    });
}

function createUniqueFallbackLocators(xmlNode, existingLocators) {
    const existingKeys = new Set(existingLocators.map(locator => `${locator.strategy}::${locator.value}`));
    const candidates = [
        createIndexedXPathLocator(xmlNode),
        createCoordinateXPathLocator(xmlNode)
    ].filter(Boolean);

    return candidates.filter(locator => {
        const key = `${locator.strategy}::${locator.value}`;
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
    });
}

function createCoordinateXPathLocator(xmlNode) {
    const tagName = xmlNode.tagName;
    if (!tagName) return null;

    const attrPairs = [];
    if (xmlNode.getAttribute('x') && xmlNode.getAttribute('y')) {
        attrPairs.push(['x', xmlNode.getAttribute('x')], ['y', xmlNode.getAttribute('y')]);
    } else if (xmlNode.getAttribute('bounds')) {
        attrPairs.push(['bounds', xmlNode.getAttribute('bounds')]);
    }

    if (attrPairs.length === 0) return null;

    const predicates = attrPairs
        .map(([name, value]) => `@${name}=${toXPathLiteral(value)}`)
        .join(' and ');

    return {
        type: 'XPATH',
        strategy: 'xpath',
        value: `//${tagName}[${predicates}]`,
        priority: 90,
        confidence: 'fallback'
    };
}

function createIndexedXPathLocator(xmlNode) {
    const tagName = xmlNode.tagName;
    if (!tagName || !currentXmlDoc) return null;

    const sameTagElements = Array.from(currentXmlDoc.getElementsByTagName(tagName));
    const index = sameTagElements.indexOf(xmlNode);
    if (index < 0) return null;

    return {
        type: 'XPATH',
        strategy: 'xpath',
        value: `(//${tagName})[${index + 1}]`,
        priority: 95,
        confidence: 'fallback'
    };
}

function toXPathLiteral(value) {
    const text = String(value);
    if (!text.includes('"')) return `"${text}"`;
    if (!text.includes("'")) return `'${text}'`;

    return `concat(${text.split('"').map(part => `"${part}"`).join(', \'"\', ')})`;
}

// A locator is "brittle" if it's structurally fragile: an index/coordinate
// fallback, a positional XPath, or class-name-only (usually non-specific).
function isBrittleLocator(locator) {
    if (!locator) return false;
    if (locator.confidence === 'fallback') return true;
    if (locator.strategy === 'class name') return true;
    if (locator.strategy === 'xpath' && /\[\d+\]/.test(locator.value)) return true;
    return false;
}

// Short reason for why a locator is the recommended pick.
function recommendedReason(locator) {
    switch (locator.strategy) {
        case 'accessibility id': return 'Unique accessibility id';
        case 'id':
        case 'resource-id': return 'Unique resource id';
        case '-ios predicate string': return 'Unique predicate';
        case '-ios class chain': return 'Unique class chain';
        case '-android uiautomator': return 'Unique UiAutomator';
        case 'xpath': return 'Unique attribute XPath';
        default: return 'Unique match';
    }
}

// Best locator for an element: first unique & non-brittle, else first unique, else first.
function getRecommendedLocator(element) {
    if (!sessionInfo || !sessionInfo.device) return null;
    const locators = LocatorGenerator.generateLocators(element, sessionInfo.device.platform);
    const items = buildLocatorDisplayItems(locators, element.xmlNode);
    if (!items.length) return null;
    let idx = items.findIndex(it => it.matchCount === 1 && !isBrittleLocator(it.locator));
    if (idx === -1) idx = items.findIndex(it => it.matchCount === 1);
    if (idx === -1) idx = 0;
    return items[idx].locator;
}

function displayElementDetails(element, focusLocators = true) {
    console.log('displayElementDetails called with:', element);
    clearLocatorMatchHighlights();

    try {
        if (!sessionInfo || !sessionInfo.device) {
            console.error('Session info missing');
            const lp = document.getElementById('dpane-locators');
            if (lp) lp.innerHTML = '<div class="error-state">Session info missing</div>';
            return;
        }

        console.log('Generating locators for platform:', sessionInfo.device.platform);
        const locators = LocatorGenerator.generateLocators(element, sessionInfo.device.platform);
        const locatorsWithMatches = buildLocatorDisplayItems(locators, element.xmlNode);
        const hasFallbackUnique = locatorsWithMatches.some(item => item.locator.confidence === 'fallback' && item.matchCount === 1);
        currentDisplayedLocators = locatorsWithMatches.map(item => item.locator);
        console.log('Generated locators:', currentDisplayedLocators);

        let attributesHtml = '';
        let locatorsHtml = '';
        let methodsHtml = '';

        // Attributes section
        attributesHtml += '<div class="detail-section">';
        attributesHtml += '<h3>Attributes</h3>';

        if (Object.keys(element.attributes).length === 0) {
            attributesHtml += '<p>No attributes available</p>';
        } else {
            for (const [key, value] of Object.entries(element.attributes)) {
                if (value) {
                    attributesHtml += `
                <div class="detail-row">
                  <div class="detail-label">${key}</div>
                  <div class="detail-value">${escapeHtml(value)}</div>
                </div>
              `;
                }
            }
        }
        attributesHtml += '</div>';

        // Locators section
        locatorsHtml += '<div class="detail-section locator-strategies-section" id="locator-strategies-section">';
        locatorsHtml += `
            <div class="locator-section-header">
                <h3>Locator Strategies</h3>
                <div class="snippet-lang">
                    <label for="snippet-lang-select">Copy as</label>
                    <select id="snippet-lang-select" class="method-select">
                        ${SnippetGenerator.TARGETS.map(t => `<option value="${t.id}" ${t.id === snippetLang ? 'selected' : ''}>${t.label}</option>`).join('')}
                    </select>
                </div>
            </div>
        `;

        if (locatorsWithMatches.length === 0) {
            locatorsHtml += '<p class="empty-state">We couldn\'t build a locator for this element — try picking a nearby one with an id or label.</p>';
        } else {
            if (hasFallbackUnique) {
                locatorsHtml += `
                    <div class="locator-guidance">
                        Heads up — there's no stable unique ID or accessibility locator here, so we added a unique relative XPath as a fallback. For something more durable, ask the developers to add an accessibility id.
                    </div>
                `;
            }
            // Recommended = first unique & non-brittle locator; else first unique.
            let recommendedIndex = locatorsWithMatches.findIndex(
                it => it.matchCount === 1 && !isBrittleLocator(it.locator)
            );
            if (recommendedIndex === -1) {
                recommendedIndex = locatorsWithMatches.findIndex(it => it.matchCount === 1);
            }

            locatorsWithMatches.forEach(({ locator, matchCount }, index) => {
                const countClass = getMatchCountClass(matchCount);
                const matchText = formatMatchCount(matchCount);
                const isRecommended = index === recommendedIndex;
                const brittle = isBrittleLocator(locator);

                const badges = [
                    isRecommended ? `<span class="locator-badge recommended" title="${recommendedReason(locator)}">★ Recommended</span>` : '',
                    brittle ? '<span class="locator-badge brittle" title="Structurally fragile — prefer a stable id or accessibility id">Brittle</span>' : ''
                ].join('');

                locatorsHtml += `
              <div class="locator-item ${isRecommended ? 'is-recommended' : ''} ${locator.confidence === 'fallback' ? 'locator-fallback' : ''}">
                <div class="locator-header">
                  <div class="locator-title">
                    <span class="locator-type">${locator.type}</span>
                    ${badges}
                  </div>
                  <div class="locator-actions">
                    <button class="match-count ${countClass}" type="button" data-locator-index="${index}" title="Show ${matchText} on the screen mirror">${matchText}</button>
                    <button class="copy-code-btn" type="button" data-locator-index="${index}" title="Copy as code snippet">&lt;/&gt;</button>
                    <button class="copy-btn" data-copy-text="${escapeHtml(locator.value)}" data-locator-index="${index}">
                      Copy
                    </button>
                  </div>
                </div>
                <div class="locator-meta">
                    <span>${escapeHtml(locator.strategy)}</span>
                    ${isRecommended ? `<span class="locator-reason">${recommendedReason(locator)}</span>` : ''}
                </div>
                <div class="locator-value">${escapeHtml(locator.value)}</div>
              </div>
            `;
            });
        }
        locatorsHtml += '</div>';

        // Appium Methods Preview Section
        const methods = LocatorGenerator.generateAppiumMethods(element, sessionInfo.device.platform);
        if (methods && methods.length > 0) {
            methodsHtml += '<div class="detail-section">';
            methodsHtml += '<h3>Appium Methods Preview</h3>';

            methodsHtml += `
            <div class="method-preview-container">
                <div class="method-control">
                    <label for="appium-method-select">Method:</label>
                    <select id="appium-method-select" class="method-select">
                        ${methods.map((m, i) => `<option value="${i}">${m.name}</option>`).join('')}
                    </select>
                </div>
                <div class="method-result">
                    <div class="result-label">Return Value:</div>
                    <div class="result-value-box">
                        <code id="method-result-value">${methods[0].value}</code>
                        <button class="copy-icon-btn" title="Copy Value" data-copy-source="method-result-value">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>`;
            methodsHtml += '</div>';
        }

        const locPane = document.getElementById('dpane-locators');
        const attrPane = document.getElementById('dpane-attributes');
        if (locPane) locPane.innerHTML = locatorsHtml;
        if (attrPane) attrPane.innerHTML = attributesHtml + methodsHtml;

        if (focusLocators) {
            activateDetailTab('locators');
            elementDetails.closest('.panel-body')?.scrollTo({ top: 0, behavior: 'auto' });
        }

        // Add event listener for dropdown change
        const selectEl = document.getElementById('appium-method-select');
        if (selectEl) {
            selectEl.addEventListener('change', (e) => {
                const index = e.target.value;
                const selectedMethod = methods[index];
                document.getElementById('method-result-value').textContent = selectedMethod.value;
            });
        }

        console.log('Element details updated successfully');
    } catch (error) {
        console.error('Error displaying details:', error);
        const lp = document.getElementById('dpane-locators');
        if (lp) lp.innerHTML = `<div class="error-state">Error generating locators: ${error.message}</div>`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showLocatorMatches(locatorIndex) {
    const locator = currentDisplayedLocators[locatorIndex];
    if (!locator) return;

    const matches = getMatchingElements(locator);
    clearElementHighlight();
    clearLocatorMatchHighlights();

    if (matches.length === 0) {
        showNotification("Nothing on screen matches this locator right now", 'warning');
        
        return;
    }

    positionScreenOverlay();
    const screenOverlay = document.getElementById('screen-overlay');

    matches.forEach((xmlElement, index) => {
        const displayRect = getDisplayRectForElement(xmlElement);
        if (displayRect) {
            const highlight = document.createElement('div');
            highlight.className = 'element-highlight locator-match-highlight';
            highlight.style.left = `${displayRect.x}px`;
            highlight.style.top = `${displayRect.y}px`;
            highlight.style.width = `${displayRect.width}px`;
            highlight.style.height = `${displayRect.height}px`;

            const badge = document.createElement('span');
            badge.className = 'locator-match-number';
            badge.textContent = String(index + 1);
            highlight.appendChild(badge);
            screenOverlay.appendChild(highlight);
        }

        const headerDiv = elementToNodeMap.get(xmlElement);
        if (headerDiv) {
            headerDiv.classList.add('locator-match');
            revealTreeHeader(headerDiv);
            if (index === 0) {
                headerDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    });

    showNotification(`Showing ${formatMatchCount(matches.length)} for ${locator.strategy}`, matches.length === 1 ? 'success' : 'warning');
    
}

// Event delegation for copy buttons (CSP-safe approach)
// Attach once to the element details container
elementDetails.addEventListener('click', async (e) => {
    const matchBtn = e.target.closest('.match-count');
    if (matchBtn) {
        e.preventDefault();
        e.stopPropagation();
        showLocatorMatches(parseInt(matchBtn.dataset.locatorIndex, 10));
        return;
    }

    const codeBtn = e.target.closest('.copy-code-btn');
    if (codeBtn) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number(codeBtn.dataset.locatorIndex);
        const locator = currentDisplayedLocators[idx];
        if (locator) {
            const platform = sessionInfo?.device?.platform;
            const snippet = SnippetGenerator.generate(locator, platform, snippetLang) || locator.value;
            await copyToClipboard(snippet, codeBtn);
            
        }
        return;
    }

    const copyBtn = e.target.closest('.copy-btn, .copy-icon-btn');
    if (!copyBtn) return;

    e.preventDefault();
    e.stopPropagation();

    let textToCopy = '';

    // Check if it's a copy button with data-copy-text attribute
    if (copyBtn.hasAttribute('data-copy-text')) {
        textToCopy = copyBtn.getAttribute('data-copy-text');
    }
    // Or if it's a copy icon button with data-copy-source
    else if (copyBtn.hasAttribute('data-copy-source')) {
        const sourceId = copyBtn.getAttribute('data-copy-source');
        const sourceElement = document.getElementById(sourceId);
        if (sourceElement) {
            textToCopy = sourceElement.textContent;
        }
    }

    if (textToCopy) {
        // No need to unescape - data attributes already contain raw text
        await copyToClipboard(textToCopy, copyBtn);
    }
});

// Persist the "Copy as" language choice
elementDetails.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'snippet-lang-select') {
        snippetLang = e.target.value;
        try { localStorage.setItem('ali-snippet-lang', snippetLang); } catch (err) { /* ignore */ }
    }
});

window.copyToClipboard = async (text, button) => {
    try {
        // Use text directly - no need to unescape from HTML entities
        const plainText = text;

        // Try modern clipboard API first
        let copied = false;
        try {
            await navigator.clipboard.writeText(plainText);
            copied = true;
        } catch (clipboardError) {
            console.log('Clipboard API failed, using fallback:', clipboardError);

            // Fallback: use execCommand (works in extensions)
            const textArea = document.createElement('textarea');
            textArea.value = plainText;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();

            try {
                copied = document.execCommand('copy');
            } catch (err) {
                console.error('execCommand failed:', err);
            }

            document.body.removeChild(textArea);
        }

        if (copied) {
            const locatorIndex = button.dataset.locatorIndex;
            const locator = locatorIndex == null ? null : currentDisplayedLocators[Number(locatorIndex)];
            
            // Visual feedback
            const originalText = button.textContent;
            button.textContent = 'Copied!';
            button.style.background = '#10b981';
            button.style.borderColor = '#10b981';
            button.style.color = 'white';

            setTimeout(() => {
                button.textContent = originalText;
                button.style.background = '';
                button.style.borderColor = '';
                button.style.color = '';
            }, 2000);
        } else {
            showNotification('Failed to copy to clipboard', 'error');
            
        }
    } catch (error) {
        console.error('Failed to copy:', error);
        showNotification('Copy failed: ' + error.message, 'error');
        
    }
};

function clearSearchHighlights() {
    document.querySelectorAll('.tree-node-header.search-match').forEach(el => {
        el.classList.remove('search-match');
    });
}

function handleSearch(e) {
    const searchTerm = e.target.value.toLowerCase();

    // Clear previous search highlighting
    clearSearchHighlights();

    if (!searchTerm) {
        sourceSearchTracked = false;
        // Reset: Show all, but don't change expansion state
        document.querySelectorAll('.tree-node-header').forEach(el => {
            el.style.display = '';
        });
        return;
    }

    if (!sourceSearchTracked && searchTerm.length >= 2) {
        sourceSearchTracked = true;
        
    }

    // 1. Hide everything first
    document.querySelectorAll('.tree-node-header').forEach(el => el.style.display = 'none');

    let firstMatch = null;

    // 2. Find matches
    document.querySelectorAll('.tree-node-header').forEach(el => {
        const text = el.textContent.toLowerCase();

        if (text.includes(searchTerm)) {
            // Show match
            el.style.display = '';

            // Add search highlight class
            el.classList.add('search-match');

            // Track first match
            if (!firstMatch) {
                firstMatch = el;
            }

            // 3. Walk up to reveal and expand ancestors
            let parent = el.parentElement; // .tree-node
            while (parent) {
                // If it's a children container, expand it
                if (parent.classList.contains('tree-children')) {
                    parent.classList.add('expanded');
                }

                // If it's a node wrapper (ancestor node)
                if (parent.classList.contains('tree-node')) {
                    const header = parent.querySelector('.tree-node-header');
                    if (header) {
                        header.style.display = ''; // Show ancestor

                        // Expand ancestor's toggle arrow
                        const toggle = header.querySelector('.tree-toggle');
                        if (toggle) toggle.classList.add('expanded');
                    }
                }

                parent = parent.parentElement;
            }
        }
    });

    // 4. Auto-select and scroll to first match
    if (firstMatch) {
        // Clear previous selections
        document.querySelectorAll('.tree-node-header.selected').forEach(el => {
            el.classList.remove('selected');
        });

        // Select first match
        firstMatch.classList.add('selected');

        // Scroll into view
        firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function updateConnectionStatus(connected) {
    if (connected) {
        connectionDot.classList.add('connected');
        connectionStatus.textContent = 'Connected';
    } else {
        connectionDot.classList.remove('connected');
        connectionStatus.textContent = 'Disconnected';
    }
}

async function disconnect() {
    try {
        const deviceId = sessionInfo?.device?.id;
        

        // Mark as intentional so we don't auto-reconnect
        wsIntentionalClose = true;
        if (wsReconnectTimer) {
            clearTimeout(wsReconnectTimer);
            wsReconnectTimer = null;
        }

        // Stop streaming
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'stop-streaming' }));
            ws.close();
        }

        // Close Appium session for THIS device only
        await fetch(`${BACKEND_URL}/api/session/close`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId })
        });

        // Clear storage
        await chrome.storage.local.remove('activeSession');

        // Close window
        window.close();
    } catch (error) {
        console.error('Error disconnecting:', error);
    }
}

let notificationTimeout = null;

function showNotification(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);

    // Create or reuse notification element
    let toast = document.getElementById('notification-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'notification-toast';
        document.body.appendChild(toast);
    }

    // Clear previous timeout
    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
    }

    // Set content and style
    toast.textContent = message;
    toast.className = `notification-toast notification-${type} notification-visible`;

    // Auto-hide after delay (longer for errors)
    const delay = type === 'error' ? 6000 : type === 'warning' ? 4000 : 2500;
    notificationTimeout = setTimeout(() => {
        toast.classList.remove('notification-visible');
    }, delay);
}
