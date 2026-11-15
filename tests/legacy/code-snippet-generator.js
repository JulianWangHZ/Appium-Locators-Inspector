/**
 * Code Snippet Generator
 * Turns a raw Appium locator ({ strategy, value }) into a runnable
 * findElement snippet for a chosen client library.
 *
 * Targets: Appium Java client, Appium Python client, WebdriverIO (JS).
 * Pure string templating — CSP-safe (no eval). Also exported for Node tests.
 */

class SnippetGenerator {
    static get TARGETS() {
        return [
            { id: 'java', label: 'Java (Appium)' },
            { id: 'python', label: 'Python (Appium)' },
            { id: 'webdriverio', label: 'TypeScript (WebdriverIO)' }
        ];
    }

    /**
     * @param {{strategy:string, value:string}} locator
     * @param {string} platform 'android' | 'ios'
     * @param {string} target 'java' | 'python' | 'webdriverio'
     * @returns {string} runnable snippet
     */
    static generate(locator, platform, target) {
        if (!locator || !locator.strategy) return '';
        const strategy = locator.strategy;
        const value = locator.value == null ? '' : String(locator.value);

        switch (target) {
            case 'java': return this.java(strategy, value);
            case 'python': return this.python(strategy, value);
            case 'webdriverio': return this.webdriverio(strategy, value, platform);
            default: return '';
        }
    }

    // ── Java (Appium Java client, AppiumBy) ──────────────
    static javaBy(strategy, value) {
        const v = this.escapeDoubleQuoted(value);
        const map = {
            'id': `AppiumBy.id("${v}")`,
            'resource-id': `AppiumBy.id("${v}")`,
            'accessibility id': `AppiumBy.accessibilityId("${v}")`,
            'class name': `AppiumBy.className("${v}")`,
            'xpath': `AppiumBy.xpath("${v}")`,
            '-android uiautomator': `AppiumBy.androidUIAutomator("${v}")`,
            '-ios predicate string': `AppiumBy.iOSNsPredicateString("${v}")`,
            '-ios class chain': `AppiumBy.iOSClassChain("${v}")`
        };
        return map[strategy] || '';
    }

    static java(strategy, value) {
        const by = this.javaBy(strategy, value);
        return by ? `WebElement element = driver.findElement(${by});` : '';
    }

    // ── Python (Appium Python client, AppiumBy) ──────────
    static pyConst(strategy) {
        const map = {
            'id': 'AppiumBy.ID',
            'resource-id': 'AppiumBy.ID',
            'accessibility id': 'AppiumBy.ACCESSIBILITY_ID',
            'class name': 'AppiumBy.CLASS_NAME',
            'xpath': 'AppiumBy.XPATH',
            '-android uiautomator': 'AppiumBy.ANDROID_UIAUTOMATOR',
            '-ios predicate string': 'AppiumBy.IOS_PREDICATE',
            '-ios class chain': 'AppiumBy.IOS_CLASS_CHAIN'
        };
        return map[strategy] || '';
    }

    static python(strategy, value) {
        const by = this.pyConst(strategy);
        return by ? `element = driver.find_element(${by}, "${this.escapeDoubleQuoted(value)}")` : '';
    }

    // ── WebdriverIO (JS) selector strings ────────────────
    static webdriverio(strategy, value, platform) {
        const selector = this.webdriverioSelector(strategy, value, platform);
        if (selector == null) return '';
        return `const element = await $('${this.escapeSingleQuoted(selector)}');`;
    }

    static webdriverioSelector(strategy, value, platform) {
        switch (strategy) {
            case 'accessibility id':
                return `~${value}`;
            case 'id':
            case 'resource-id':
                // WDIO removed the `id=` strategy (v6+); use UiSelector for Android resource-id.
                return `android=new UiSelector().resourceId("${this.escapeDoubleQuoted(value)}")`;
            case 'xpath':
                return value;
            case '-android uiautomator':
                return `android=${value}`;
            case '-ios predicate string':
                return `-ios predicate string:${value}`;
            case '-ios class chain':
                return `-ios class chain:${value}`;
            case 'class name':
                // No dedicated WDIO short prefix — express the same intent per platform.
                return platform === 'ios'
                    ? `-ios class chain:**/${value}`
                    : `android=new UiSelector().className("${this.escapeDoubleQuoted(value)}")`;
            default:
                return null;
        }
    }

    // ── Recorded script (multiple steps: find + action) ─────
    /**
     * @param {Array<{locator:{strategy,value}, action:string, text?:string}>} steps
     * @param {string} platform
     * @param {string} target
     * @returns {string} full script body
     */
    static generateScript(steps, platform, target) {
        if (!steps || !steps.length) return '';
        return steps
            .map(step => this.step(step, platform, target))
            .filter(Boolean)
            .join('\n');
    }

    // Platform-specific `mobile:` gesture command + params for an action.
    static gesture(platform, action, step) {
        const ios = platform === 'ios';
        const dir = String(step.direction || 'up');
        switch (action) {
            case 'doubleTap': return { cmd: ios ? 'mobile: doubleTap' : 'mobile: doubleClickGesture', params: {} };
            case 'longPress': return { cmd: ios ? 'mobile: touchAndHold' : 'mobile: longClickGesture', params: ios ? { duration: 1 } : { duration: 1000 } };
            case 'swipe': return { cmd: ios ? 'mobile: swipe' : 'mobile: swipeGesture', params: ios ? { direction: dir } : { direction: dir, percent: 0.75 } };
            case 'pinchOpen': return { cmd: ios ? 'mobile: pinch' : 'mobile: pinchOpenGesture', params: ios ? { scale: 2.0, velocity: 1.0 } : { percent: 0.75 } };
            case 'pinchClose': return { cmd: ios ? 'mobile: pinch' : 'mobile: pinchCloseGesture', params: ios ? { scale: 0.5, velocity: 1.0 } : { percent: 0.75 } };
            default: return null;
        }
    }

    // One inline statement per step (Playwright-codegen style), delegated per target.
    static step(step, platform, target) {
        const loc = step.locator;
        if (!loc || !loc.strategy) return '';
        switch (target) {
            case 'java': return this.stepJava(step, platform);
            case 'python': return this.stepPython(step, platform);
            case 'webdriverio': return this.stepWdio(step, platform);
            default: return '';
        }
    }

    static stepWdio(step, platform) {
        const loc = step.locator;
        const sel = this.webdriverioSelector(loc.strategy, loc.value, platform);
        if (sel == null) return '';
        const q = this.escapeSingleQuoted(sel);
        const el = `$('${q}')`;
        const text = this.escapeSingleQuoted(step.text == null ? '' : String(step.text));

        switch (step.action) {
            case 'tap': return `await ${el}.click();`;
            case 'input': return `await ${el}.setValue('${text}');`;
            case 'clear': return `await ${el}.clearValue();`;
            case 'assert': return this.assertWdio(step.matcher, el);
            case 'doubleTap':
            case 'longPress':
            case 'swipe':
            case 'pinchOpen':
            case 'pinchClose': {
                const g = this.gesture(platform, step.action, step);
                const params = { elementId: `(await ${el}).elementId`, ...this.jsParams(g.params) };
                return `await driver.execute('${g.cmd}', ${this.jsObject(params)});`;
            }
            default: return `await ${el}.click();`;
        }
    }

    static stepPython(step, platform) {
        const loc = step.locator;
        const by = this.pyConst(loc.strategy);
        if (!by) return '';
        const finder = `driver.find_element(${by}, "${this.escapeDoubleQuoted(loc.value)}")`;
        const text = this.escapeDoubleQuoted(step.text == null ? '' : String(step.text));

        switch (step.action) {
            case 'tap': return `${finder}.click()`;
            case 'input': return `${finder}.send_keys("${text}")`;
            case 'clear': return `${finder}.clear()`;
            case 'assert': return this.assertPython(step.matcher, finder);
            case 'doubleTap':
            case 'longPress':
            case 'swipe':
            case 'pinchOpen':
            case 'pinchClose': {
                const g = this.gesture(platform, step.action, step);
                const params = { '"elementId"': `${finder}.id`, ...this.pyParams(g.params) };
                return `driver.execute_script("${g.cmd}", ${this.pyDict(params)})`;
            }
            default: return `${finder}.click()`;
        }
    }

    static stepJava(step, platform) {
        const loc = step.locator;
        const by = this.javaBy(loc.strategy, loc.value);
        if (!by) return '';
        const finder = `driver.findElement(${by})`;
        const text = this.escapeDoubleQuoted(step.text == null ? '' : String(step.text));

        switch (step.action) {
            case 'tap': return `${finder}.click();`;
            case 'input': return `${finder}.sendKeys("${text}");`;
            case 'clear': return `${finder}.clear();`;
            case 'assert': return this.assertJava(step.matcher, finder);
            case 'doubleTap':
            case 'longPress':
            case 'swipe':
            case 'pinchOpen':
            case 'pinchClose': {
                const g = this.gesture(platform, step.action, step);
                const entries = [`"elementId", ((RemoteWebElement) ${finder}).getId()`, ...this.javaParams(g.params)];
                return `((JavascriptExecutor) driver).executeScript("${g.cmd}", java.util.Map.of(${entries.join(', ')}));`;
            }
            default: return `${finder}.click();`;
        }
    }

    // Assertions
    static assertWdio(m, el) {
        switch (m) {
            case 'visible': return `await expect(${el}).toBeDisplayed();`;
            case 'hidden': return `await expect(${el}).not.toBeDisplayed();`;
            case 'enabled': return `await expect(${el}).toBeEnabled();`;
            case 'disabled': return `await expect(${el}).toBeDisabled();`;
            case 'checked': return `await expect(${el}).toBeSelected();`;
            case 'unchecked': return `await expect(${el}).not.toBeSelected();`;
            case 'empty': return `await expect(${el}).toHaveText('');`;
            default: return '';
        }
    }

    static assertPython(m, f) {
        switch (m) {
            case 'visible': return `assert ${f}.is_displayed()`;
            case 'hidden': return `assert not ${f}.is_displayed()`;
            case 'enabled': return `assert ${f}.is_enabled()`;
            case 'disabled': return `assert not ${f}.is_enabled()`;
            case 'checked': return `assert ${f}.is_selected()`;
            case 'unchecked': return `assert not ${f}.is_selected()`;
            case 'empty': return `assert ${f}.text == ""`;
            default: return '';
        }
    }

    static assertJava(m, f) {
        switch (m) {
            case 'visible': return `assertTrue(${f}.isDisplayed());`;
            case 'hidden': return `assertFalse(${f}.isDisplayed());`;
            case 'enabled': return `assertTrue(${f}.isEnabled());`;
            case 'disabled': return `assertFalse(${f}.isEnabled());`;
            case 'checked': return `assertTrue(${f}.isSelected());`;
            case 'unchecked': return `assertFalse(${f}.isSelected());`;
            case 'empty': return `assertEquals("", ${f}.getText());`;
            default: return '';
        }
    }

    // Param formatting helpers (string values quoted per language, numbers raw)
    static jsParams(params) {
        const out = {};
        for (const [k, v] of Object.entries(params)) out[k] = typeof v === 'string' ? `'${this.escapeSingleQuoted(v)}'` : String(v);
        return out;
    }
    static jsObject(obj) {
        return `{ ${Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(', ')} }`;
    }
    static pyParams(params) {
        const out = {};
        for (const [k, v] of Object.entries(params)) out[`"${k}"`] = typeof v === 'string' ? `"${this.escapeDoubleQuoted(v)}"` : String(v);
        return out;
    }
    static pyDict(obj) {
        return `{${Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(', ')}}`;
    }
    static javaParams(params) {
        return Object.entries(params).map(([k, v]) => `"${k}", ${typeof v === 'string' ? `"${this.escapeDoubleQuoted(v)}"` : v}`);
    }

    static indent(text, prefix) {
        return text.split('\n').map(l => (l ? prefix + l : l)).join('\n');
    }

    // A full, runnable test file wrapping the recorded steps.
    static generateTestFile(steps, platform, target) {
        const body = this.generateScript(steps, platform, target);
        if (!body) return '';

        switch (target) {
            case 'webdriverio':
                return `import { $, expect } from '@wdio/globals';\n\n`
                    + `describe('test', () => {\n`
                    + `  it('test', async () => {\n`
                    + `${this.indent(body, '    ')}\n`
                    + `  });\n`
                    + `});\n`;
            case 'java':
                return `import io.appium.java_client.AppiumBy;\n`
                    + `import io.appium.java_client.AppiumDriver;\n`
                    + `import org.openqa.selenium.JavascriptExecutor;\n`
                    + `import org.openqa.selenium.remote.RemoteWebElement;\n`
                    + `import org.junit.jupiter.api.Test;\n`
                    + `import static org.junit.jupiter.api.Assertions.*;\n\n`
                    + `public class RecordedTest {\n`
                    + `    // Assumes an initialized AppiumDriver `+"`driver`"+`.\n`
                    + `    @Test\n`
                    + `    public void test() {\n`
                    + `${this.indent(body, '        ')}\n`
                    + `    }\n`
                    + `}\n`;
            case 'python':
                return `from appium.webdriver.common.appiumby import AppiumBy\n\n\n`
                    + `def test(driver):\n`
                    + `${this.indent(body, '    ')}\n`;
            default:
                return body;
        }
    }

    // ── Escaping ─────────────────────────────────────────
    static escapeDoubleQuoted(value) {
        return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    static escapeSingleQuoted(value) {
        return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }
}

if (typeof window !== 'undefined') {
    window.SnippetGenerator = SnippetGenerator;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SnippetGenerator;
}
