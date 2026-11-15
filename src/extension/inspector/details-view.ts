import { escapeHtml } from '../lib/html.js';
import { LocatorGenerator } from '../lib/locator-generator.js';
import { SnippetGenerator } from '../lib/snippet-generator.js';
import type { ElementInfo, Locator } from '../lib/types.js';
import { copyToClipboard } from './clipboard.js';
import { dom } from './dom.js';
import {
    buildLocatorItems, formatMatchCount, getMatchingElements, isBrittleLocator,
    matchCountClass, recommendedIndex, recommendedReason, type LocatorItem
} from './locator-matching.js';
import { showNotification } from './notify.js';
import { clearElementHighlight, drawMatchHighlights } from './screen-view.js';
import { platform, setSnippetLang, state } from './state.js';
import { clearLocatorMatchHighlights, markLocatorMatch } from './tree-view.js';

const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>`;

/** Build an inspector element from a page-source node. */
export function elementFromNode(node: Element): ElementInfo {
    return {
        tagName: node.tagName,
        attributes: LocatorGenerator.extractAttributes(node),
        xpath: LocatorGenerator.generateXPath(node),
        xmlNode: node
    };
}

function locatorItemsFor(element: ElementInfo): LocatorItem[] {
    const locators = LocatorGenerator.generateLocators(element, platform());
    return buildLocatorItems(state.xmlDoc, locators, element.xmlNode);
}

/** Best locator: unique & non-brittle, else unique, else the first candidate. */
export function getRecommendedLocator(element: ElementInfo): Locator | null {
    if (!state.session?.device) return null;
    const items = locatorItemsFor(element);
    if (!items.length) return null;
    const idx = recommendedIndex(items);
    return items[idx === -1 ? 0 : idx]?.locator ?? null;
}

export function activateDetailTab(name: string): void {
    document.querySelectorAll<HTMLElement>('.detail-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll<HTMLElement>('.detail-pane').forEach((p) => p.classList.toggle('active', p.id === `dpane-${name}`));
}

export function resetDetailPanes(): void {
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

function snippetLangOptions(): string {
    return SnippetGenerator.TARGETS
        .map((t) => `<option value="${t.id}" ${t.id === state.snippetLang ? 'selected' : ''}>${t.label}</option>`)
        .join('');
}

function attributesHtml(element: ElementInfo): string {
    const entries = Object.entries(element.attributes);
    const rows = entries.length === 0
        ? '<p>No attributes available</p>'
        : entries.filter(([, value]) => value).map(([key, value]) => `
                <div class="detail-row">
                  <div class="detail-label">${escapeHtml(key)}</div>
                  <div class="detail-value">${escapeHtml(value)}</div>
                </div>
              `).join('');
    return `<div class="detail-section"><h3>Attributes</h3>${rows}</div>`;
}

function locatorItemHtml({ locator, matchCount }: LocatorItem, index: number, isRecommended: boolean): string {
    const matchText = formatMatchCount(matchCount);
    const reason = escapeHtml(recommendedReason(locator));
    const badges = [
        isRecommended ? `<span class="locator-badge recommended" title="${reason}">★ Recommended</span>` : '',
        isBrittleLocator(locator) ? '<span class="locator-badge brittle" title="Structurally fragile — prefer a stable id or accessibility id">Brittle</span>' : ''
    ].join('');
    return `
              <div class="locator-item ${isRecommended ? 'is-recommended' : ''} ${locator.confidence === 'fallback' ? 'locator-fallback' : ''}">
                <div class="locator-header">
                  <div class="locator-title">
                    <span class="locator-type">${escapeHtml(locator.type)}</span>
                    ${badges}
                  </div>
                  <div class="locator-actions">
                    <button class="match-count ${matchCountClass(matchCount)}" type="button" data-locator-index="${index}" title="Show ${matchText} on the screen mirror">${matchText}</button>
                    <button class="copy-code-btn" type="button" data-locator-index="${index}" title="Copy as code snippet">&lt;/&gt;</button>
                    <button class="copy-btn" data-copy-text="${escapeHtml(locator.value)}" data-locator-index="${index}">
                      Copy
                    </button>
                  </div>
                </div>
                <div class="locator-meta">
                    <span>${escapeHtml(locator.strategy)}</span>
                    ${isRecommended ? `<span class="locator-reason">${reason}</span>` : ''}
                </div>
                <div class="locator-value">${escapeHtml(locator.value)}</div>
              </div>
            `;
}

function locatorsHtml(items: LocatorItem[]): string {
    const header = `
            <div class="locator-section-header">
                <h3>Locator Strategies</h3>
                <div class="snippet-lang">
                    <label for="snippet-lang-select">Copy as</label>
                    <select id="snippet-lang-select" class="method-select">
                        ${snippetLangOptions()}
                    </select>
                </div>
            </div>
        `;
    let body: string;
    if (items.length === 0) {
        body = '<p class="empty-state">We couldn\'t build a locator for this element — try picking a nearby one with an id or label.</p>';
    } else {
        const guidance = items.some((it) => it.locator.confidence === 'fallback' && it.matchCount === 1)
            ? `
                    <div class="locator-guidance">
                        Heads up — there's no stable unique ID or accessibility locator here, so we added a unique relative XPath as a fallback. For something more durable, ask the developers to add an accessibility id.
                    </div>
                `
            : '';
        const recommended = recommendedIndex(items);
        body = guidance + items.map((item, i) => locatorItemHtml(item, i, i === recommended)).join('');
    }
    return `<div class="detail-section locator-strategies-section" id="locator-strategies-section">${header}${body}</div>`;
}

function methodsHtml(element: ElementInfo): { html: string; values: string[] } {
    const methods = LocatorGenerator.generateAppiumMethods(element, platform());
    if (!methods.length) return { html: '', values: [] };
    const html = `<div class="detail-section"><h3>Appium Methods Preview</h3>
            <div class="method-preview-container">
                <div class="method-control">
                    <label for="appium-method-select">Method:</label>
                    <select id="appium-method-select" class="method-select">
                        ${methods.map((m, i) => `<option value="${i}">${escapeHtml(m.name)}</option>`).join('')}
                    </select>
                </div>
                <div class="method-result">
                    <div class="result-label">Return Value:</div>
                    <div class="result-value-box">
                        <code id="method-result-value">${escapeHtml(methods[0]?.value)}</code>
                        <button class="copy-icon-btn" title="Copy Value" data-copy-source="method-result-value">
                            ${COPY_ICON}
                        </button>
                    </div>
                </div>
            </div></div>`;
    return { html, values: methods.map((m) => m.value) };
}

function setPane(id: string, html: string): void {
    const pane = document.getElementById(id);
    if (pane) pane.innerHTML = html;
}

export function displayElementDetails(element: ElementInfo, focusLocators = true): void {
    clearLocatorMatchHighlights();
    try {
        if (!state.session?.device) {
            setPane('dpane-locators', '<div class="error-state">Session info missing</div>');
            return;
        }
        const items = locatorItemsFor(element);
        state.displayedLocators = items.map((it) => it.locator);
        const methods = methodsHtml(element);

        setPane('dpane-locators', locatorsHtml(items));
        setPane('dpane-attributes', attributesHtml(element) + methods.html);

        if (focusLocators) {
            activateDetailTab('locators');
            dom.elementDetails.closest('.panel-body')?.scrollTo({ top: 0, behavior: 'auto' });
        }
        document.getElementById('appium-method-select')?.addEventListener('change', (e) => {
            const value = methods.values[Number((e.target as HTMLSelectElement).value)];
            const out = document.getElementById('method-result-value');
            if (out && value != null) out.textContent = value;
        });
    } catch (error) {
        console.error('Error displaying details:', error);
        setPane('dpane-locators', `<div class="error-state">Error generating locators: ${escapeHtml((error as Error).message)}</div>`);
    }
}

function showLocatorMatches(index: number): void {
    const locator = state.displayedLocators[index];
    if (!locator) return;
    const matches = getMatchingElements(state.xmlDoc, locator);
    clearElementHighlight();
    clearLocatorMatchHighlights();
    if (matches.length === 0) {
        showNotification('Nothing on screen matches this locator right now', 'warning');
        return;
    }
    drawMatchHighlights(matches);
    matches.forEach((node, i) => markLocatorMatch(node, i === 0));
    showNotification(`Showing ${formatMatchCount(matches.length)} for ${locator.strategy}`, matches.length === 1 ? 'success' : 'warning');
}

async function handleDetailsClick(e: MouseEvent): Promise<void> {
    const target = e.target as HTMLElement;
    const matchBtn = target.closest<HTMLElement>('.match-count');
    if (matchBtn) {
        e.preventDefault();
        e.stopPropagation();
        showLocatorMatches(Number.parseInt(matchBtn.dataset.locatorIndex ?? '', 10));
        return;
    }

    const codeBtn = target.closest<HTMLElement>('.copy-code-btn');
    if (codeBtn) {
        e.preventDefault();
        e.stopPropagation();
        const locator = state.displayedLocators[Number(codeBtn.dataset.locatorIndex)];
        if (locator) await copyToClipboard(SnippetGenerator.generate(locator, platform(), state.snippetLang) || locator.value, codeBtn);
        return;
    }

    const copyBtn = target.closest<HTMLElement>('.copy-btn, .copy-icon-btn');
    if (!copyBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const text = copyBtn.hasAttribute('data-copy-text')
        ? copyBtn.getAttribute('data-copy-text')
        : document.getElementById(copyBtn.getAttribute('data-copy-source') ?? '')?.textContent;
    if (text) await copyToClipboard(text, copyBtn);
}

export function setupDetailsView(): void {
    document.querySelectorAll<HTMLElement>('.detail-tab').forEach((tab) => {
        tab.addEventListener('click', () => activateDetailTab(tab.dataset.tab ?? ''));
    });
    dom.elementDetails.addEventListener('click', (e) => void handleDetailsClick(e));
    dom.elementDetails.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement | null;
        if (target?.id === 'snippet-lang-select') setSnippetLang(target.value);
    });
}
