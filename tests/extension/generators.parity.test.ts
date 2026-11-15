import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { LocatorGenerator } from '../../src/extension/lib/locator-generator.js';
import { SnippetGenerator } from '../../src/extension/lib/snippet-generator.js';
import type { RecordedStep } from '../../src/extension/lib/types.js';
import { fixture, loadLegacyGlobals } from '../legacy.js';

const legacyLocator = loadLegacyGlobals('locator-generator.js').LocatorGenerator;
const legacySnippet = loadLegacyGlobals('code-snippet-generator.js').SnippetGenerator;
const { DOMParser } = new JSDOM('').window;

function elementsOf(xml: string): Element[] {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    return Array.from(doc.getElementsByTagName('*'));
}

function asInspectorElement(node: Element) {
    return { tagName: node.tagName, attributes: LocatorGenerator.extractAttributes(node), xpath: LocatorGenerator.generateXPath(node), xmlNode: node };
}

const CASES = [
    { platform: 'android', xml: fixture('android.xml') },
    { platform: 'ios', xml: fixture('ios.xml') }
] as const;

describe.each(CASES)('LocatorGenerator parity ($platform)', ({ platform, xml }) => {
    const nodes = elementsOf(xml);

    it('extracts the same attributes and absolute XPaths', () => {
        for (const node of nodes) {
            expect(LocatorGenerator.extractAttributes(node)).toEqual(legacyLocator.extractAttributes(node));
            expect(LocatorGenerator.generateXPath(node)).toBe(legacyLocator.generateXPath(node));
        }
    });

    it('generates the same ranked locators and method previews', () => {
        for (const node of nodes) {
            const element = asInspectorElement(node);
            for (const p of [platform, 'android', 'ios']) {
                expect(LocatorGenerator.generateLocators(element, p)).toEqual(legacyLocator.generateLocators(element, p));
                expect(LocatorGenerator.generateAppiumMethods(element, p)).toEqual(legacyLocator.generateAppiumMethods(element, p));
            }
        }
    });

    it('produces snippets identical to the legacy generator for every locator and language', () => {
        for (const node of nodes) {
            for (const locator of LocatorGenerator.generateLocators(asInspectorElement(node), platform)) {
                for (const lang of ['java', 'python', 'webdriverio', 'unknown']) {
                    expect(SnippetGenerator.generate(locator, platform, lang)).toBe(legacySnippet.generate(locator, platform, lang));
                }
            }
        }
    });
});

describe('SnippetGenerator script parity', () => {
    const locators = [
        { strategy: 'accessibility id', value: 'Say "hi" it\'s' },
        { strategy: 'id', value: 'com.example:id/login' },
        { strategy: 'xpath', value: '//*[@text="Log in"]' },
        { strategy: 'class name', value: 'android.widget.Button' },
        { strategy: '-ios class chain', value: '**/XCUIElementTypeButton[`name == "Continue"`]' },
        { strategy: '-ios predicate string', value: 'label == "a\\\\b"' },
        { strategy: '-android uiautomator', value: 'new UiSelector().text("x")' }
    ] as const;
    const actions: RecordedStep[] = [
        { locator: locators[0], action: 'tap' },
        { locator: locators[1], action: 'input', text: 'it\'s "quoted" \\ ok' },
        { locator: locators[2], action: 'clear' },
        { locator: locators[3], action: 'doubleTap' },
        { locator: locators[4], action: 'longPress' },
        { locator: locators[5], action: 'swipe', direction: 'left' },
        { locator: locators[6], action: 'pinchOpen' },
        { locator: locators[0], action: 'pinchClose' },
        { locator: locators[1], action: 'swipe' },
        ...(['visible', 'hidden', 'enabled', 'disabled', 'checked', 'unchecked', 'empty', 'bogus'] as const)
            .map((matcher) => ({ locator: locators[2], action: 'assert', matcher })),
        { locator: { strategy: 'nonsense' as any, value: 'x' }, action: 'tap' },
        { locator: locators[0], action: 'mystery' }
    ];

    it.each(['android', 'ios'])('matches legacy output on %s', (platform) => {
        for (const lang of ['java', 'python', 'webdriverio']) {
            expect(SnippetGenerator.generateScript(actions, platform, lang)).toBe(legacySnippet.generateScript(actions, platform, lang));
            expect(SnippetGenerator.generateTestFile(actions, platform, lang)).toBe(legacySnippet.generateTestFile(actions, platform, lang));
        }
        expect(SnippetGenerator.generateTestFile([], platform, 'java')).toBe('');
        expect(SnippetGenerator.TARGETS).toEqual(legacySnippet.TARGETS);
    });
});
