import type { DeviceInfo } from '../../shared/protocol.js';
import { DEFAULT_SCREEN_FPS } from '../../shared/fps.js';
import { backendHttpUrl, backendPortOf, backendWsUrl, loadSettings, normalizeFpsLimit } from '../lib/settings.js';
import { currentDocumentTheme, loadTheme, normalizeTheme, saveTheme, setDocumentTheme, type Theme } from '../lib/theme.js';
import { closeIntentionally, connect, finishPageSourceLoad, onStreamRestart, requestPageSource, startStreaming } from './connection.js';
import { sendKeys, sendTap } from './device-actions.js';
import { postCloseSession } from './device-api.js';
import { displayElementDetails, elementFromNode, resetDetailPanes, setupDetailsView } from './details-view.js';
import { dom } from './dom.js';
import { computeCoordinateScale, findElementAtPoint } from './geometry.js';
import { showNotification } from './notify.js';
import { commitTypingStep, renderRecordTab, setupRecorder } from './recorder.js';
import {
    cancelAutoRefresh, captureSnapshot, clearElementHighlight, drawElementHighlight,
    eventToDevicePoint, hideStaleIndicator, resetFpsCounter, updateScreenshot
} from './screen-view.js';
import { state, type SessionInfo } from './state.js';
import {
    clearLocatorMatchHighlights, clearSearchHighlights, clearTreeSelection, highlightInTree,
    renderSourceTree, searchTree, selectHeader
} from './tree-view.js';

const PAGE_SOURCE_WAIT_MS = 1000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

document.addEventListener('DOMContentLoaded', async () => {
    const port = backendPortOf(await loadSettings());
    state.backendUrl = backendHttpUrl(port);
    state.wsUrl = backendWsUrl(port);

    applyTheme(await loadTheme());
    if (!(await loadSession())) return;
    setupEventListeners();
    onStreamRestart(resetFpsCounter);
    connect({
        onScreenshot: updateScreenshot,
        onPageSource: updatePageSource,
        onStreamStarted: () => requestPageSource()
    });
});

/* ── Theme ─────────────────────────────────────────── */
function applyTheme(theme: Theme): void {
    const isDark = theme === 'dark';
    setDocumentTheme(theme);
    document.body.classList.toggle('dark-theme', isDark);
    document.body.classList.toggle('light-theme', !isDark);
    // Show the icon for the theme you'll switch TO.
    dom.moonIcon.style.display = isDark ? 'none' : 'block';
    dom.sunIcon.style.display = isDark ? 'block' : 'none';
}

function toggleTheme(): void {
    const theme: Theme = currentDocumentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    saveTheme(theme);
}

/* ── Session ───────────────────────────────────────── */
async function loadSession(): Promise<boolean> {
    const { activeSession } = (await chrome.storage.local.get('activeSession')) as { activeSession?: SessionInfo };
    if (!activeSession?.device) {
        alert('No active session found. Please connect from the extension popup.');
        window.close();
        return false;
    }
    state.session = activeSession;
    dom.deviceName.textContent = `${activeSession.device.name} (${activeSession.device.platform})`;
    applyDeviceFrame(activeSession.device);
    return true;
}

/** Family-adaptive device body: iOS vs Android look (no per-model assets). */
function applyDeviceFrame(device: DeviceInfo): void {
    const frame = document.getElementById('device-frame');
    if (!frame) return;
    const name = String(device.name || '').toLowerCase();
    const isIOS = String(device.platform || '').toLowerCase().includes('ios') || /iphone|ipad|ios/.test(name);
    frame.dataset.device = isIOS ? 'ios' : 'android';
}

async function disconnect(): Promise<void> {
    try {
        closeIntentionally();
        await postCloseSession();
        await chrome.storage.local.remove('activeSession');
        window.close();
    } catch (error) {
        console.error('Error disconnecting:', error);
    }
}

/* ── Events ────────────────────────────────────────── */
function setupEventListeners(): void {
    dom.modeToggleBtn.addEventListener('click', toggleMode);
    dom.themeToggleBtn.addEventListener('click', toggleTheme);
    dom.refreshBtn.addEventListener('click', () => {
        if (state.isLoadingPageSource) {
            showNotification('Already refreshing...', 'info');
            return;
        }
        dom.refreshBtn.classList.add('spinning');
        requestPageSource();
    });
    dom.disconnectBtn.addEventListener('click', () => void disconnect());
    dom.searchInput.addEventListener('input', () => searchTree(dom.searchInput.value));
    chrome.storage.onChanged.addListener(handleSettingsChange);

    dom.screenImage.addEventListener('click', (e) => void handleScreenClick(e));
    setupDetailsView();
    setupRecorder();
    document.addEventListener('keydown', handleKeyboardInput);

    // Clicking the empty canvas around the device deselects.
    document.querySelector('.device-stage')?.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).closest('#screen-container')) deselectElement();
    });
    dom.screenImage.addEventListener('mousemove', handleScreenHover);
    // Re-entering the screen unlocks hovering; leaving keeps the selection for copying.
    dom.screenImage.addEventListener('mouseenter', () => { state.isElementLocked = false; });

    // The first screenshot may arrive after the page source: recompute the scale then.
    let imageInitialized = false;
    dom.screenImage.onload = () => {
        if (!imageInitialized && state.xmlDoc && state.pageSource !== null) {
            imageInitialized = true;
            updatePageSource(state.pageSource);
        }
    };
    dom.screenImage.style.cursor = 'crosshair';

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && state.isElementLocked) {
            state.isElementLocked = false;
            clearElementHighlight();
        }
    });
}

function handleSettingsChange(changes: Record<string, chrome.storage.StorageChange>, areaName: string): void {
    if (areaName !== 'sync') return;
    if (changes.theme) applyTheme(normalizeTheme(changes.theme.newValue));
    if (!changes.fpsLimit) return;
    const nextFps = normalizeFpsLimit(changes.fpsLimit.newValue, state.currentStreamFps || DEFAULT_SCREEN_FPS);
    if (nextFps !== state.currentStreamFps) void startStreaming(nextFps);
}

function toggleMode(): void {
    state.isInteractMode = !state.isInteractMode;
    const interact = state.isInteractMode;
    dom.modeToggleBtn.classList.toggle('active', interact);
    const inspectIcon = document.getElementById('inspect-icon');
    const interactIcon = document.getElementById('interact-icon');
    if (inspectIcon) inspectIcon.style.display = interact ? 'none' : 'block';
    if (interactIcon) interactIcon.style.display = interact ? 'block' : 'none';
    const label = document.getElementById('mode-label');
    if (label) label.textContent = interact ? 'Interact' : 'Inspect';
    dom.screenImage.style.cursor = interact ? 'pointer' : 'crosshair';
    if (interact) {
        clearElementHighlight();
        state.isElementLocked = false;
        showNotification('Interact Mode: Click to tap, Drag to scroll', 'info');
    } else {
        showNotification('Inspect Mode: Click to select elements', 'info');
    }
}

/** Interact mode forwards keystrokes to the device (recording uses the Type button). */
function handleKeyboardInput(e: KeyboardEvent): void {
    if (!state.isInteractMode || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;

    if (e.key === 'Backspace') {
        e.preventDefault();
        state.typingBuffer = state.typingBuffer.slice(0, -1);
        void sendKeys(''); // W3C backspace
    } else if (e.key === 'Enter') {
        e.preventDefault();
        commitTypingStep();
        void sendKeys('\n');
    } else if (e.key.length === 1) {
        e.preventDefault();
        state.typingBuffer += e.key;
        void sendKeys(e.key);
    }
}

async function ensurePageSource(): Promise<void> {
    if (state.pageSource && state.xmlDoc) return;
    requestPageSource();
    await wait(PAGE_SOURCE_WAIT_MS);
}

async function handleScreenClick(event: MouseEvent): Promise<void> {
    const { x, y } = eventToDevicePoint(event);

    if (state.isRecording) {
        // Recording: a tap selects; the Record panel buttons choose the action.
        await ensurePageSource();
        const node = findElementAtPoint(state.xmlDoc, x, y);
        if (node) {
            drawElementHighlight(node, true);
            state.recordSelected = { element: elementFromNode(node), x, y };
            renderRecordTab();
        }
        return;
    }

    if (state.isInteractMode) {
        await sendTap(x, y);
        return;
    }

    if (!state.pageSource || !state.xmlDoc) {
        showNotification('Fetching page source...', 'info');
        await ensurePageSource();
        if (!state.pageSource || !state.xmlDoc) {
            showNotification('Please wait for page source to load, then try again', 'warning');
            return;
        }
    }
    state.isElementLocked = true;
    inspectAt(x, y, true);
}

function handleScreenHover(event: MouseEvent): void {
    if (state.isElementLocked || !state.pageSource || !state.xmlDoc) return;
    const { x, y } = eventToDevicePoint(event);
    inspectAt(x, y, false);
}

function inspectAt(x: number, y: number, isClick: boolean): void {
    if (!state.xmlDoc) {
        showNotification('Page source not loaded', 'error');
        return;
    }
    const node = findElementAtPoint(state.xmlDoc, x, y);
    if (node) {
        drawElementHighlight(node, isClick);
        highlightInTree(node);
        state.selectedElement = elementFromNode(node);
        displayElementDetails(state.selectedElement, isClick);
        if (isClick) showNotification(`Element found: ${node.tagName}`, 'success');
    } else if (isClick) {
        deselectElement();
    } else {
        clearElementHighlight();
    }
}

function selectFromTree(node: Element, header: HTMLElement): void {
    selectHeader(header);
    drawElementHighlight(node, true);
    state.selectedElement = elementFromNode(node);
    displayElementDetails(state.selectedElement, true);
}

/** Clear highlight, tree selection and details. */
function deselectElement(): void {
    clearElementHighlight();
    clearLocatorMatchHighlights();
    state.selectedElement = null;
    state.isElementLocked = false;
    clearTreeSelection();
    resetDetailPanes();
}

function updatePageSource(xml: string): void {
    state.pageSource = xml;
    finishPageSourceLoad();
    cancelAutoRefresh();
    hideStaleIndicator();
    captureSnapshot();

    // The old selection belongs to the previous screen.
    clearElementHighlight();
    state.selectedElement = null;
    state.isElementLocked = false;
    clearTreeSelection();
    clearSearchHighlights();
    clearLocatorMatchHighlights();
    resetDetailPanes();

    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    state.xmlDoc = doc;
    if (dom.screenImage.naturalWidth > 0) {
        state.coordinateScale = computeCoordinateScale(doc, dom.screenImage.naturalWidth);
    }
    dom.elementCount.textContent = `${doc.getElementsByTagName('*').length} elements`;
    renderSourceTree(doc, {
        onSelect: selectFromTree,
        onHover: (node) => drawElementHighlight(node, false)
    });
}
