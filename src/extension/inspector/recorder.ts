import type { GestureName } from '../../shared/protocol.js';
import { escapeHtml } from '../lib/html.js';
import { SnippetGenerator } from '../lib/snippet-generator.js';
import type { RecordedStep } from '../lib/types.js';
import { copyToClipboard } from './clipboard.js';
import { sendGesture, sendTap, sendTextToElement } from './device-actions.js';
import { activateDetailTab, getRecommendedLocator } from './details-view.js';
import { dom } from './dom.js';
import { deviceRectOf } from './geometry.js';
import { showNotification } from './notify.js';
import { platform, setSnippetLang, state } from './state.js';

const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>`;

export function stepLabel(step: RecordedStep): string {
    switch (step.action) {
        case 'assert': return `assert ${step.matcher}`;
        case 'tap': return 'tap';
        case 'input': return `type "${step.text || ''}"`;
        case 'swipe': return `swipe ${step.direction || ''}`;
        default: return step.action; // doubleTap, longPress, pinchOpen, pinchClose, clear
    }
}

function stepRowsHtml(): string {
    return state.recordedSteps.map((s, i) => `
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

function actionsPaneHtml(dis: string): string {
    return `
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
}

function assertPaneHtml(dis: string): string {
    return `
        <div class="rec-grid2">
            <button class="rec-act" data-assert="visible" ${dis}>Visible</button>
            <button class="rec-act" data-assert="hidden" ${dis}>Hidden</button>
            <button class="rec-act" data-assert="enabled" ${dis}>Enabled</button>
            <button class="rec-act" data-assert="disabled" ${dis}>Disabled</button>
            <button class="rec-act" data-assert="checked" ${dis}>Checked</button>
            <button class="rec-act" data-assert="unchecked" ${dis}>Unchecked</button>
            <button class="rec-act" data-assert="empty" ${dis}>Empty</button>
        </div>`;
}

export function renderRecordTab(): void {
    const pane = document.getElementById('dpane-record');
    if (!pane) return;
    const n = state.recordedSteps.length;
    const sel = state.recordSelected;
    const dis = sel ? '' : 'disabled';
    const recommended = sel ? getRecommendedLocator(sel.element) : null;
    const selTitle = sel ? escapeHtml(sel.element.tagName) : 'No element selected';
    const selSub = sel
        ? escapeHtml(`${recommended?.strategy || ''} ${recommended?.value || ''}`)
        : (state.isRecording ? 'Tap an element on the screen to select it.' : 'Press Start, then tap an element.');

    pane.innerHTML = `
        <div class="record-panel">
            <button id="record-toggle" class="btn ${state.isRecording ? 'btn-quiet' : 'btn-primary'} record-toggle" type="button">
                ${state.isRecording ? '■ Stop recording' : '● Start recording'}
            </button>

            <div class="rec-selected ${sel ? 'has-sel' : ''}">
                <div class="rec-sel-title">${selTitle}</div>
                <div class="rec-sel-sub">${selSub}</div>
            </div>

            <div class="rec-subtabs">
                <button class="rec-subtab ${state.recSubtab === 'actions' ? 'active' : ''}" data-recsub="actions" type="button">Actions</button>
                <button class="rec-subtab ${state.recSubtab === 'assert' ? 'active' : ''}" data-recsub="assert" type="button">Assertions</button>
            </div>
            <div class="rec-subpane">${state.recSubtab === 'actions' ? actionsPaneHtml(dis) : assertPaneHtml(dis)}</div>

            ${n
                ? `<div class="record-live-head">${n} step${n === 1 ? '' : 's'} · <a href="#" id="goto-recorded">view &amp; export</a></div>
                   <div class="step-list">${stepRowsHtml()}</div>`
                : ''}
        </div>
    `;
}

function exportedScript(): string {
    return state.exportFullFile
        ? SnippetGenerator.generateTestFile(state.recordedSteps, platform(), state.snippetLang)
        : SnippetGenerator.generateScript(state.recordedSteps, platform(), state.snippetLang);
}

export function renderRecordedTab(): void {
    const pane = document.getElementById('dpane-recorded');
    if (!pane) return;
    if (!state.recordedSteps.length) {
        pane.innerHTML = '<div class="pane-empty">No steps yet. Switch to Record and tap elements to capture a flow.</div>';
        return;
    }
    pane.innerHTML = `
        <div class="recorded-toolbar">
            <div class="snippet-lang">
                <label for="script-lang-select">Export as</label>
                <select id="script-lang-select" class="method-select">
                    ${SnippetGenerator.TARGETS.map((t) => `<option value="${t.id}" ${t.id === state.snippetLang ? 'selected' : ''}>${t.label}</option>`).join('')}
                </select>
            </div>
            <div class="recorded-actions">
                <button id="export-script" class="btn btn-primary btn-sm" type="button">Copy ${state.exportFullFile ? 'test file' : 'steps'}</button>
                <button id="clear-steps" class="btn btn-quiet btn-sm" type="button">Clear</button>
            </div>
        </div>
        <label class="full-file-toggle"><input type="checkbox" id="full-file-check" ${state.exportFullFile ? 'checked' : ''}> Full test file (imports &amp; test wrapper)</label>
        <div class="step-list">${stepRowsHtml()}</div>
        <div class="script-block">
            <button class="copy-script-icon" id="copy-script-icon" type="button" title="Copy code">
                ${COPY_ICON}
            </button>
            <pre class="script-preview"><code>${escapeHtml(exportedScript())}</code></pre>
        </div>
    `;
}

function rerender(): void {
    renderRecordTab();
    renderRecordedTab();
}

function addStep(step: RecordedStep, notice: string): void {
    state.recordedSteps = [...state.recordedSteps, step];
    rerender();
    showNotification(notice, 'success');
}

/** Interact-mode typing: flush the buffered text as one input step. */
export function commitTypingStep(): void {
    const target = state.typingTargetElement;
    if (state.isRecording && state.typingBuffer && target) {
        const locator = getRecommendedLocator(target);
        if (locator) addStep({ locator, action: 'input', text: state.typingBuffer, label: target.tagName }, 'Input step recorded');
    }
    state.typingBuffer = '';
}

function toggleRecording(): void {
    state.isRecording = !state.isRecording;
    state.recordSelected = null;
    showNotification(
        state.isRecording ? 'Recording started — tap an element, then pick an action' : 'Recording stopped',
        state.isRecording ? 'success' : 'info'
    );
    renderRecordTab();
    activateDetailTab('record');
}

/** Record an action on the selected element, then drive the device so the app advances. */
async function performRecordAction(act: string, dir: string | undefined): Promise<void> {
    const sel = state.recordSelected;
    if (!sel) return;
    const locator = getRecommendedLocator(sel.element);
    if (!locator) {
        showNotification('Could not build a locator for that element', 'warning');
        return;
    }
    const step: RecordedStep = {
        locator,
        action: act,
        label: sel.element.tagName,
        ...(act === 'input' ? { text: (document.getElementById('rec-type-input') as HTMLInputElement | null)?.value || '' } : {}),
        ...(act === 'swipe' ? { direction: dir || 'up' } : {})
    };
    addStep(step, 'Step recorded');

    const { x, y } = sel;
    const rect = deviceRectOf(sel.element.attributes) ?? {};
    if (act === 'tap') await sendTap(x, y);
    else if (act === 'input') await sendTextToElement(locator, step.text ?? '');
    else if (act === 'doubleTap' || act === 'longPress') await sendGesture(act, { x, y });
    else if (act === 'swipe') await sendGesture('swipe', { direction: step.direction, ...rect });
    else if (act === 'pinchOpen' || act === 'pinchClose') await sendGesture(act as GestureName, { ...rect });
    // 'clear' is recorded only (no destructive device action).
}

function recordAssertion(matcher: string): void {
    const sel = state.recordSelected;
    if (!sel) return;
    const locator = getRecommendedLocator(sel.element);
    if (!locator) {
        showNotification('Could not build a locator for that element', 'warning');
        return;
    }
    addStep({ locator, action: 'assert', matcher, label: sel.element.tagName }, `Assertion recorded: ${matcher}`);
}

async function exportScript(): Promise<void> {
    const script = exportedScript();
    if (!script) {
        showNotification('No steps to export yet', 'warning');
        return;
    }
    await copyToClipboard(script, document.getElementById('export-script'));
}

function handleRecordClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const closest = <T extends HTMLElement = HTMLElement>(selector: string) => target.closest<T>(selector);
    if (closest('#record-toggle')) return toggleRecording();
    if (closest('#goto-recorded')) {
        e.preventDefault();
        return activateDetailTab('recorded');
    }
    if (closest('#export-script') || closest('#copy-script-icon')) return void exportScript();
    if (closest('#clear-steps')) {
        state.recordedSteps = [];
        state.recordSelected = null;
        return rerender();
    }
    const sub = closest('.rec-subtab[data-recsub]');
    if (sub) {
        state.recSubtab = sub.dataset.recsub === 'assert' ? 'assert' : 'actions';
        return renderRecordTab();
    }
    const actBtn = closest('.rec-act[data-act]');
    if (actBtn) return void performRecordAction(actBtn.dataset.act ?? '', actBtn.dataset.dir);
    const assertBtn = closest('.rec-act[data-assert]');
    if (assertBtn) return recordAssertion(assertBtn.dataset.assert ?? '');
    const del = closest('.step-delete');
    if (del) {
        const index = Number(del.dataset.stepIndex);
        state.recordedSteps = state.recordedSteps.filter((_, i) => i !== index);
        rerender();
    }
}

export function setupRecorder(): void {
    dom.elementDetails.addEventListener('click', handleRecordClick);
    dom.elementDetails.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement | null;
        if (target?.id === 'script-lang-select') {
            setSnippetLang(target.value);
            renderRecordedTab();
        } else if (target?.id === 'full-file-check') {
            state.exportFullFile = target.checked;
            renderRecordedTab();
        }
    });
    rerender();
}
