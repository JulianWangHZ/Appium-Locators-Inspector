/** Pure locator evaluation against the current page source XML. */
import type { Locator, LocatorLike } from '../lib/types.js';
import { LocatorGenerator } from '../lib/locator-generator.js';

export interface LocatorItem {
    locator: Locator;
    matchCount: number;
}

function byAttribute(doc: Document, attribute: string, value: string): Element[] {
    return Array.from(doc.getElementsByTagName('*')).filter((el) => el.getAttribute(attribute) === value);
}

function evaluateXPath(doc: Document, xpath: string): Element[] {
    try {
        const result = doc.evaluate(xpath, doc, null, 7 /* ORDERED_NODE_SNAPSHOT_TYPE */, null);
        const matches: Element[] = [];
        for (let i = 0; i < result.snapshotLength; i++) matches.push(result.snapshotItem(i) as Element);
        return matches;
    } catch (error) {
        console.warn('XPath evaluation error:', error);
        return [];
    }
}

function unescapeLocatorString(value: string): string {
    return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function quotedSelectorValue(selector: string, method: string): string {
    const match = selector.match(new RegExp(`${method}\\("((?:\\\\.|[^"])*)"\\)`));
    return match?.[1] != null ? unescapeLocatorString(match[1]) : '';
}

export function parseSimplePredicate(predicate: string): { attribute: string; value: string } | null {
    const match = predicate.match(/\b(name|label|value)\s*==\s*"((?:\\.|[^"])*)"/);
    return match?.[1] && match[2] != null ? { attribute: match[1], value: unescapeLocatorString(match[2]) } : null;
}

function iosClassName(classChain: string): string {
    return classChain.match(/(?:^|\/)(XCUIElementType[A-Za-z0-9_]+)/)?.[1] ?? '';
}

export function getMatchingElements(doc: Document | null, locator: LocatorLike | null | undefined): Element[] {
    if (!doc || !locator) return [];
    const { strategy, value } = locator;
    try {
        switch (strategy) {
            case 'id':
            case 'resource-id':
                return byAttribute(doc, 'resource-id', value);
            case 'accessibility id':
                return [...byAttribute(doc, 'name', value), ...byAttribute(doc, 'content-desc', value)];
            case 'class name':
                return byAttribute(doc, 'class', value);
            case 'xpath':
                return evaluateXPath(doc, value);
            case '-android uiautomator': {
                const resourceId = quotedSelectorValue(value, 'resourceId');
                if (resourceId) return byAttribute(doc, 'resource-id', resourceId);
                const text = quotedSelectorValue(value, 'text');
                return text ? byAttribute(doc, 'text', text) : [];
            }
            case '-ios predicate string': {
                const predicate = parseSimplePredicate(value);
                return predicate ? byAttribute(doc, predicate.attribute, predicate.value) : [];
            }
            case '-ios class chain': {
                const className = iosClassName(value);
                const byClass = className ? Array.from(doc.getElementsByTagName(className)) : [];
                const predicate = parseSimplePredicate(value);
                if (!predicate) return byClass;
                const byPredicate = byAttribute(doc, predicate.attribute, predicate.value);
                return byClass.length > 0 ? byPredicate.filter((el) => byClass.includes(el)) : byPredicate;
            }
        }
    } catch (error) {
        console.error('Error matching elements:', error);
    }
    return [];
}

function keyOf(locator: LocatorLike): string {
    return `${locator.strategy}::${locator.value}`;
}

function coordinateXPathLocator(node: Element): Locator | null {
    const tagName = node.tagName;
    if (!tagName) return null;
    const pairs: Array<[string, string]> = node.getAttribute('x') && node.getAttribute('y')
        ? [['x', node.getAttribute('x') ?? ''], ['y', node.getAttribute('y') ?? '']]
        : node.getAttribute('bounds')
            ? [['bounds', node.getAttribute('bounds') ?? '']]
            : [];
    if (pairs.length === 0) return null;
    const predicates = pairs.map(([name, value]) => `@${name}=${LocatorGenerator.toXPathLiteral(value)}`).join(' and ');
    return { type: 'XPATH', strategy: 'xpath', value: `//${tagName}[${predicates}]`, priority: 90, confidence: 'fallback' };
}

function indexedXPathLocator(doc: Document, node: Element): Locator | null {
    const tagName = node.tagName;
    if (!tagName) return null;
    const index = Array.from(doc.getElementsByTagName(tagName)).indexOf(node);
    if (index < 0) return null;
    return { type: 'XPATH', strategy: 'xpath', value: `(//${tagName})[${index + 1}]`, priority: 95, confidence: 'fallback' };
}

function uniqueFallbackLocators(doc: Document, node: Element, existing: Locator[]): Locator[] {
    const seen = new Set(existing.map(keyOf));
    return [indexedXPathLocator(doc, node), coordinateXPathLocator(node)]
        .filter((l): l is Locator => l !== null)
        .filter((l) => {
            if (seen.has(keyOf(l))) return false;
            seen.add(keyOf(l));
            return true;
        });
}

/** Locators that match something, unique ones first; adds XPath fallbacks when none is unique. */
export function buildLocatorItems(doc: Document | null, locators: Locator[], node: Element | undefined): LocatorItem[] {
    const withCounts = (list: Locator[]) => list.map((locator) => ({ locator, matchCount: getMatchingElements(doc, locator).length }));
    let items = withCounts(locators).filter((it) => it.matchCount > 0);

    if (doc && node && !items.some((it) => it.matchCount === 1)) {
        const fallbacks = withCounts(uniqueFallbackLocators(doc, node, locators)).filter((it) => it.matchCount === 1);
        items = [...fallbacks, ...items];
    }

    return [...items].sort((a, b) => {
        const uniqueDelta = Number(b.matchCount === 1) - Number(a.matchCount === 1);
        return uniqueDelta !== 0 ? uniqueDelta : b.locator.priority - a.locator.priority;
    });
}

/** Structurally fragile: index/coordinate fallback, positional XPath, or class name only. */
export function isBrittleLocator(locator: Locator | null | undefined): boolean {
    if (!locator) return false;
    if (locator.confidence === 'fallback') return true;
    if (locator.strategy === 'class name') return true;
    return locator.strategy === 'xpath' && /\[\d+\]/.test(locator.value);
}

/** First unique & non-brittle item, else first unique, else -1. */
export function recommendedIndex(items: LocatorItem[]): number {
    const stable = items.findIndex((it) => it.matchCount === 1 && !isBrittleLocator(it.locator));
    return stable !== -1 ? stable : items.findIndex((it) => it.matchCount === 1);
}

export function recommendedReason(locator: Locator): string {
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

export function matchCountClass(count: number): string {
    if (count === 1) return 'count-unique';
    return count === 0 ? 'count-none' : 'count-multiple';
}

export function formatMatchCount(count: number): string {
    return `${count} ${count === 1 ? 'match' : 'matches'}`;
}
