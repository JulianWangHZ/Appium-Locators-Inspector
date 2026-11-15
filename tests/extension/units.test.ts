import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../../src/extension/lib/html.js';
import { appiumPortOf, backendPortOf } from '../../src/extension/lib/settings.js';
import { computeCoordinateScale, deviceRectOf, findElementAtPoint, parseAndroidBounds } from '../../src/extension/inspector/geometry.js';
import { buildLocatorItems, getMatchingElements, isBrittleLocator, parseSimplePredicate, recommendedIndex } from '../../src/extension/inspector/locator-matching.js';
import { stepStates } from '../../src/extension/popup/steps.js';
import { applyInstallerTemplate, buildInstaller, embedLauncherForShell, splitBase64 } from '../../src/extension/options/installer-builder.js';
import { renderChecks, companionChecks } from '../../src/extension/options/environment-check.js';
import { LocatorGenerator } from '../../src/extension/lib/locator-generator.js';
import { fixture } from '../legacy.js';

const { DOMParser } = new JSDOM('').window;
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;

describe('escapeHtml', () => {
    it('escapes markup and both quote styles', () => {
        expect(escapeHtml(`<a href="x">it's & </a>`)).toBe('&lt;a href=&quot;x&quot;&gt;it&#39;s &amp; &lt;/a&gt;');
        expect(escapeHtml(null)).toBe('');
    });
});

describe('settings helpers', () => {
    it('derives ports with safe fallbacks', () => {
        expect(backendPortOf({ backendPort: '9000' })).toBe(9000);
        expect(backendPortOf({ backendPort: 'x' })).toBe(8765);
        expect(appiumPortOf('http://localhost:4800')).toBe(4800);
        expect(appiumPortOf('not a url')).toBe(4723);
        expect(appiumPortOf('http://localhost')).toBe(4723);
    });
});

describe('geometry', () => {
    const ios = parse(fixture('ios.xml'));
    const android = parse(fixture('android.xml'));

    it('parses Android bounds', () => {
        expect(parseAndroidBounds('[1,2][30,40]')).toEqual({ x1: 1, y1: 2, x2: 30, y2: 40 });
        expect(parseAndroidBounds('garbage')).toBeNull();
    });

    it('hit-tests the smallest element, preferring named ones on ties', () => {
        expect(findElementAtPoint(ios, 100, 160)?.getAttribute('name')).toBe('email');
        expect(findElementAtPoint(android, 100, 600)?.getAttribute('resource-id')).toBe('com.example:id/login');
        expect(findElementAtPoint(ios, 9999, 9999)).toBeNull();
        expect(findElementAtPoint(null, 1, 1)).toBeNull();
    });

    it('computes the retina scale from the Application width', () => {
        expect(computeCoordinateScale(ios, 1206)).toBe(3);
        expect(computeCoordinateScale(ios, 402)).toBe(1);
        expect(computeCoordinateScale(ios, 500)).toBe(1);
        expect(computeCoordinateScale(android, 1080)).toBe(1);
    });

    it('builds device rects for gestures', () => {
        expect(deviceRectOf({ bounds: '[10,20][110,220]' })).toEqual({ left: 10, top: 20, width: 100, height: 200 });
        expect(deviceRectOf({ x: '1', y: '2', width: '3', height: '4' })).toEqual({ left: 1, top: 2, width: 3, height: 4 });
        expect(deviceRectOf({})).toBeNull();
    });
});

describe('locator matching', () => {
    const ios = parse(fixture('ios.xml'));
    const android = parse(fixture('android.xml'));

    it('evaluates every strategy against the page source', () => {
        expect(getMatchingElements(android, { strategy: 'id', value: 'com.example:id/login' })).toHaveLength(1);
        expect(getMatchingElements(android, { strategy: 'class name', value: 'android.widget.Button' })).toHaveLength(2);
        expect(getMatchingElements(android, { strategy: '-android uiautomator', value: 'new UiSelector().text("Log in")' })).toHaveLength(2);
        expect(getMatchingElements(android, { strategy: 'xpath', value: '//*[@text="Log in"]' })).toHaveLength(2);
        expect(getMatchingElements(android, { strategy: 'xpath', value: '//*[' })).toEqual([]);
        expect(getMatchingElements(ios, { strategy: 'accessibility id', value: 'Continue' })).toHaveLength(2);
        expect(getMatchingElements(ios, { strategy: '-ios predicate string', value: 'name == "Say \\"hi\\""' })).toHaveLength(1);
        expect(getMatchingElements(ios, { strategy: '-ios class chain', value: '**/XCUIElementTypeButton[`name == "Continue"`]' })).toHaveLength(2);
        expect(getMatchingElements(ios, { strategy: '-ios class chain', value: '**/XCUIElementTypeOther' })).toHaveLength(2);
        expect(getMatchingElements(null, { strategy: 'id', value: 'x' })).toEqual([]);
    });

    it('parses simple predicates with escapes', () => {
        expect(parseSimplePredicate('label == "a\\"b"')).toEqual({ attribute: 'label', value: 'a"b' });
        expect(parseSimplePredicate('visible == 1')).toBeNull();
    });

    it('adds a unique XPath fallback when nothing else is unique', () => {
        const node = ios.querySelectorAll('XCUIElementTypeButton')[1]!;
        const element = { tagName: node.tagName, attributes: LocatorGenerator.extractAttributes(node), xmlNode: node };
        const items = buildLocatorItems(ios, LocatorGenerator.generateLocators(element, 'ios'), node);
        expect(items[0]?.locator).toMatchObject({ confidence: 'fallback', value: '(//XCUIElementTypeButton)[2]' });
        expect(items[0]?.matchCount).toBe(1);
        expect(isBrittleLocator(items[0]?.locator)).toBe(true);
        expect(recommendedIndex(items)).toBe(0);
    });

    it('recommends the stable unique locator over brittle ones', () => {
        const node = ios.querySelector('[name="email"]')!;
        const element = { tagName: node.tagName, attributes: LocatorGenerator.extractAttributes(node), xmlNode: node };
        const items = buildLocatorItems(ios, LocatorGenerator.generateLocators(element, 'ios'), node);
        expect(items[recommendedIndex(items)]?.locator).toMatchObject({ strategy: 'accessibility id', value: 'email' });
    });
});

describe('popup steps', () => {
    it.each([
        [{ serversReady: false, platformChosen: true, deviceChosen: true }, ['active', 'locked', 'locked']],
        [{ serversReady: true, platformChosen: false, deviceChosen: false }, ['done', 'active', 'locked']],
        [{ serversReady: true, platformChosen: true, deviceChosen: false }, ['done', 'done', 'active']],
        [{ serversReady: true, platformChosen: true, deviceChosen: true }, ['done', 'done', 'done']]
    ])('%j → %j', (flow, want) => expect(stepStates(flow)).toEqual(want));
});

describe('installer builder', () => {
    const release = { version: '1.1.0', filename: 'c.zip', url: '', sha256: 'abc' };

    it('fills template values', () => {
        const out = applyInstallerTemplate('EXTENSION_ID="old"\nCOMPANION_EMBEDDED="0"\nV=__COMPANION_VERSION__ S=__COMPANION_SHA256__', 'newid', release, true);
        expect(out).toBe('EXTENSION_ID="newid"\nCOMPANION_EMBEDDED="1"\nV=1.1.0 S=abc');
    });

    it('embeds code containing $ replacement patterns verbatim', () => {
        const launcher = "const a = s.replace(/x/, \"$&$'$1\");\n";
        expect(embedLauncherForShell('# __EMBEDDED_LAUNCHER_JS__', launcher)).toContain(launcher);
    });

    it('splits base64 into fixed-width lines', () => {
        expect(splitBase64('a'.repeat(160))).toEqual(['a'.repeat(76), 'a'.repeat(76), 'a'.repeat(8)]);
    });

    it('converts batch installers to CRLF', () => {
        const out = buildInstaller({ filename: 'x.bat', template: 'a\n:: __EMBEDDED_LAUNCHER_JS__\n:: __EMBEDDED_COMPANION_ZIP__\n', launcherJs: 'x', companionB64: 'QUJD', release, extensionId: 'id' });
        expect(out).not.toMatch(/[^\r]\n/);
        expect(out).toContain('echo.QUJD');
    });
});

describe('environment check', () => {
    it('summarises failures and escapes details', () => {
        const html = renderChecks([{ name: '<x>', ok: false, detail: 'a & b' }, { name: 'ok', ok: true, detail: '' }]);
        expect(html).toContain('1 item needs attention.');
        expect(html).toContain('&lt;x&gt;');
        expect(html).toContain('a &amp; b');
    });

    it('reports a missing companion', () => {
        expect(companionChecks({ success: false, nativeHost: false }, 'id')).toEqual([
            { name: 'Companion (native host)', ok: false, detail: 'run the auto-setup installer, then reload' }
        ]);
    });
});
