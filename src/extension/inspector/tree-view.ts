import { dom } from './dom.js';
import { escapeHtml } from '../lib/html.js';
import { state } from './state.js';

const KEY_ATTRIBUTES = ['resource-id', 'content-desc', 'text', 'name', 'label', 'value', 'class', 'id', 'type', 'enabled', 'clickable'];
const MAX_KEY_ATTRIBUTES = 3;

export interface TreeHandlers {
    onSelect: (node: Element, header: HTMLElement) => void;
    onHover: (node: Element) => void;
}

let nodeToHeader = new WeakMap<Element, HTMLElement>();
let nodeIdCounter = 0;

export function headerFor(node: Element): HTMLElement | undefined {
    return nodeToHeader.get(node);
}

export function keyAttributes(node: Element): Array<{ name: string; value: string }> {
    return Array.from(node.attributes)
        .filter((attr) => KEY_ATTRIBUTES.includes(attr.name) && attr.value)
        .map((attr) => ({ name: attr.name, value: attr.value }))
        .slice(0, MAX_KEY_ATTRIBUTES);
}

export function renderSourceTree(doc: Document, handlers: TreeHandlers): void {
    nodeToHeader = new WeakMap();
    nodeIdCounter = 0;
    dom.sourceTree.innerHTML = '';
    if (doc.documentElement) renderNode(doc.documentElement, dom.sourceTree, 0, handlers);
}

function renderNode(node: Element, container: HTMLElement, level: number, handlers: TreeHandlers): void {
    if (!node.tagName) return;
    const treeDiv = document.createElement('div');
    treeDiv.className = 'tree-node';

    const header = document.createElement('div');
    header.className = 'tree-node-header';
    header.dataset.level = String(level);
    header.dataset.elementId = String(nodeIdCounter++);
    nodeToHeader.set(node, header);

    const hasChildren = node.children.length > 0;
    if (hasChildren) {
        const toggle = document.createElement('span');
        toggle.className = 'tree-toggle';
        toggle.textContent = '▶';
        header.appendChild(toggle);
    } else {
        const spacer = document.createElement('span');
        spacer.style.width = '14px';
        header.appendChild(spacer);
    }

    const openTag = document.createElement('span');
    openTag.className = 'tree-tag';
    openTag.textContent = `<${node.tagName}`;
    header.appendChild(openTag);

    const attrs = keyAttributes(node);
    if (attrs.length > 0) {
        const attrSpan = document.createElement('span');
        attrSpan.innerHTML = ` ${attrs.map((a) =>
            `<span class="tree-attr-name">${escapeHtml(a.name)}</span>=<span class="tree-attr-value">"${escapeHtml(a.value)}"</span>`
        ).join(' ')}`;
        header.appendChild(attrSpan);
    }

    const closeTag = document.createElement('span');
    closeTag.className = 'tree-tag';
    closeTag.textContent = hasChildren ? '>' : '/>';
    header.appendChild(closeTag);

    let childrenDiv: HTMLElement | null = null;
    header.addEventListener('click', (e) => {
        e.stopPropagation();
        if (hasChildren && (e.target as HTMLElement).classList.contains('tree-toggle')) {
            if (childrenDiv) toggleNode(header, childrenDiv);
        } else {
            handlers.onSelect(node, header);
        }
    });
    header.addEventListener('mouseenter', () => {
        if (!state.isElementLocked) handlers.onHover(node);
    });
    treeDiv.appendChild(header);

    if (hasChildren) {
        childrenDiv = document.createElement('div');
        childrenDiv.className = 'tree-children';
        for (const child of Array.from(node.children)) {
            if (child.nodeType === 1) renderNode(child, childrenDiv, level + 1, handlers);
        }
        treeDiv.appendChild(childrenDiv);
    }
    container.appendChild(treeDiv);
}

function toggleNode(header: HTMLElement, childrenDiv: HTMLElement): void {
    const expand = !childrenDiv.classList.contains('expanded');
    childrenDiv.classList.toggle('expanded', expand);
    header.querySelector('.tree-toggle')?.classList.toggle('expanded', expand);
}

function allHeaders(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.tree-node-header'));
}

function removeClassEverywhere(className: string): void {
    document.querySelectorAll(`.tree-node-header.${className}`).forEach((el) => el.classList.remove(className));
}

export const clearTreeSelection = () => removeClassEverywhere('selected');
export const clearLocatorMatchHighlights = () => removeClassEverywhere('locator-match');
export const clearSearchHighlights = () => removeClassEverywhere('search-match');

export function selectHeader(header: HTMLElement): void {
    clearTreeSelection();
    header.classList.add('selected');
}

/** Expand every collapsed ancestor of a tree header. */
export function revealTreeHeader(header: HTMLElement): void {
    for (let parent = header.parentElement; parent; parent = parent.parentElement) {
        if (!parent.classList.contains('tree-children')) continue;
        parent.classList.add('expanded');
        parent.parentElement?.querySelector(':scope > .tree-node-header')?.querySelector('.tree-toggle')?.classList.add('expanded');
    }
}

export function highlightInTree(node: Element): void {
    const header = nodeToHeader.get(node);
    if (!header) {
        console.warn('Element not found in tree map');
        return;
    }
    selectHeader(header);
    revealTreeHeader(header);
    header.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function markLocatorMatch(node: Element, scroll: boolean): void {
    const header = nodeToHeader.get(node);
    if (!header) return;
    header.classList.add('locator-match');
    revealTreeHeader(header);
    if (scroll) header.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** Filter the tree to headers containing the term (and their ancestors). */
export function searchTree(rawTerm: string): void {
    const term = rawTerm.toLowerCase();
    clearSearchHighlights();
    const headers = allHeaders();
    if (!term) {
        headers.forEach((el) => { el.style.display = ''; });
        return;
    }
    headers.forEach((el) => { el.style.display = 'none'; });

    let firstMatch: HTMLElement | null = null;
    for (const el of headers) {
        if (!(el.textContent ?? '').toLowerCase().includes(term)) continue;
        el.style.display = '';
        el.classList.add('search-match');
        firstMatch ??= el;
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
            if (parent.classList.contains('tree-children')) parent.classList.add('expanded');
            if (parent.classList.contains('tree-node')) {
                const ancestorHeader = parent.querySelector<HTMLElement>('.tree-node-header');
                if (ancestorHeader) {
                    ancestorHeader.style.display = '';
                    ancestorHeader.querySelector('.tree-toggle')?.classList.add('expanded');
                }
            }
        }
    }
    if (firstMatch) {
        selectHeader(firstMatch);
        firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}
