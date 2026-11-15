import { requestPageSource } from './connection.js';
import { dom } from './dom.js';
import { drawBox } from './geometry.js';
import { state } from './state.js';

const CHANGE_PIXEL_THRESHOLD = 30;
const CHANGE_RATIO = 0.01;
const AUTO_REFRESH_DEBOUNCE_MS = 2000;
const FULL_SCREEN_RATIO = 0.98;

export interface DisplayRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

let fpsCounter = 0;
let lastFpsUpdate = Date.now();
let snapshotCtx: CanvasRenderingContext2D | null = null;
let snapshotSize = { width: 0, height: 0 };
let diffCanvas: HTMLCanvasElement | null = null;
let diffCtx: CanvasRenderingContext2D | null = null;
let autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;

export function resetFpsCounter(): void {
    fpsCounter = 0;
    lastFpsUpdate = Date.now();
}

export function updateScreenshot(base64: string): void {
    const img = dom.screenImage;
    img.src = `data:image/png;base64,${base64}`;
    img.classList.add('loaded');
    dom.screenLoading.classList.add('hidden');

    fpsCounter++;
    const now = Date.now();
    if (now - lastFpsUpdate >= 1000) {
        dom.fpsIndicator.textContent = `${Math.round((fpsCounter * 1000) / (now - lastFpsUpdate))} FPS`;
        fpsCounter = 0;
        lastFpsUpdate = now;
    }
    detectScreenChange();
}

function imageReady(): boolean {
    const img = dom.screenImage;
    return img.classList.contains('loaded') && img.complete && !!img.naturalWidth && !!img.naturalHeight;
}

/** Compare the live frame with the frame captured at the last page-source refresh. */
function detectScreenChange(): void {
    if (!snapshotCtx || !imageReady()) return;
    const img = dom.screenImage;
    const { naturalWidth: width, naturalHeight: height } = img;
    try {
        if (snapshotSize.width !== width || snapshotSize.height !== height) {
            if (state.isLoadingPageSource) showStaleIndicator();
            else requestPageSource(true);
            return;
        }
        if (!diffCanvas || diffCanvas.width !== width || diffCanvas.height !== height) {
            diffCanvas = document.createElement('canvas');
            diffCanvas.width = width;
            diffCanvas.height = height;
            diffCtx = diffCanvas.getContext('2d', { willReadFrequently: true });
        }
        if (!diffCtx) return;
        diffCtx.drawImage(img, 0, 0);
        const current = diffCtx.getImageData(0, 0, width, height).data;
        const snapshot = snapshotCtx.getImageData(0, 0, width, height).data;

        let diffPixels = 0;
        const sampledPixels = Math.floor((width * height) / 10); // every 10th pixel
        for (let i = 0; i < current.length; i += 40) {
            const delta = Math.abs(current[i]! - snapshot[i]!) + Math.abs(current[i + 1]! - snapshot[i + 1]!) + Math.abs(current[i + 2]! - snapshot[i + 2]!);
            if (delta > CHANGE_PIXEL_THRESHOLD) diffPixels++;
        }
        if (diffPixels > sampledPixels * CHANGE_RATIO) onScreenChanged();
    } catch (error) {
        console.warn('Screen diff error:', error);
    }
}

function onScreenChanged(): void {
    showStaleIndicator();
    // Debounce so an animating screen does not hammer the backend.
    if (autoRefreshTimer) return;
    autoRefreshTimer = setTimeout(() => {
        autoRefreshTimer = null;
        if (!state.isLoadingPageSource) requestPageSource(true);
    }, AUTO_REFRESH_DEBOUNCE_MS);
}

export function cancelAutoRefresh(): void {
    if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
}

/** Remember the frame the current page source belongs to. */
export function captureSnapshot(): void {
    if (!imageReady()) return;
    const img = dom.screenImage;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    snapshotCtx = canvas.getContext('2d', { willReadFrequently: true });
    snapshotCtx?.drawImage(img, 0, 0);
    snapshotSize = { width: canvas.width, height: canvas.height };
}

export function showStaleIndicator(): void {
    dom.refreshBtn.classList.add('stale');
    dom.refreshBtn.title = '⚠️ Screen changed - Click to refresh page source';
}

export function hideStaleIndicator(): void {
    dom.refreshBtn.classList.remove('stale');
    dom.refreshBtn.title = 'Refresh Page Source';
}

/** Mouse position → device coordinates (XML points on iOS, pixels on Android). */
export function eventToDevicePoint(event: MouseEvent): { x: number; y: number } {
    const img = dom.screenImage;
    const rect = img.getBoundingClientRect();
    const imageX = Math.round((event.clientX - rect.left) * (img.naturalWidth / rect.width));
    const imageY = Math.round((event.clientY - rect.top) * (img.naturalHeight / rect.height));
    return { x: imageX / state.coordinateScale, y: imageY / state.coordinateScale };
}

export function displayRectFor(el: Element): DisplayRect | null {
    const box = drawBox(el);
    if (!box) return null;
    const k = box.inPoints ? state.coordinateScale : 1;
    const img = dom.screenImage;
    const rect = img.getBoundingClientRect();
    const scaleX = rect.width / img.naturalWidth;
    const scaleY = rect.height / img.naturalHeight;
    return {
        x: box.x1 * k * scaleX,
        y: box.y1 * k * scaleY,
        width: (box.x2 - box.x1) * k * scaleX,
        height: (box.y2 - box.y1) * k * scaleY
    };
}

function overlay(): HTMLElement | null {
    return document.getElementById('screen-overlay');
}

function positionOverlay(): void {
    const el = overlay();
    const container = document.getElementById('screen-container');
    if (!el || !container) return;
    const imageRect = dom.screenImage.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    el.style.position = 'absolute';
    el.style.left = `${imageRect.left - containerRect.left}px`;
    el.style.top = `${imageRect.top - containerRect.top}px`;
    el.style.width = `${imageRect.width}px`;
    el.style.height = `${imageRect.height}px`;
}

export function clearElementHighlight(): void {
    const el = overlay();
    if (el) el.innerHTML = '';
}

function highlightBox(rect: DisplayRect, className: string): HTMLDivElement {
    const box = document.createElement('div');
    box.className = className;
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    return box;
}

export function drawElementHighlight(el: Element, isClick = false): void {
    const rect = displayRectFor(el);
    if (!rect) return;
    clearElementHighlight();
    positionOverlay();

    const box = highlightBox(rect, `element-highlight ${isClick ? '' : 'hover'}`);
    // A full-screen element (e.g. the root Application) gets the screen's rounded corners.
    const imgRect = dom.screenImage.getBoundingClientRect();
    if (rect.width >= imgRect.width * FULL_SCREEN_RATIO && rect.height >= imgRect.height * FULL_SCREEN_RATIO) {
        const container = document.getElementById('screen-container');
        if (container) box.style.borderRadius = getComputedStyle(container).borderTopLeftRadius;
    }
    overlay()?.appendChild(box);
}

/** Numbered boxes for every element a locator matches. */
export function drawMatchHighlights(elements: Element[]): void {
    positionOverlay();
    const el = overlay();
    elements.forEach((xmlElement, index) => {
        const rect = displayRectFor(xmlElement);
        if (!rect || !el) return;
        const box = highlightBox(rect, 'element-highlight locator-match-highlight');
        const badge = document.createElement('span');
        badge.className = 'locator-match-number';
        badge.textContent = String(index + 1);
        box.appendChild(badge);
        el.appendChild(box);
    });
}
