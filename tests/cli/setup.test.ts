import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    allowedExtensionIds, browserTargets, installCompanion, packageVersion, uninstallCompanion, unixHostScript, windowsHostScript
} from '../../src/cli/setup.js';

const STORE = 'chrome-extension://annejeomdlkidljonmpmhcdnekkadjfb/';
const DEV_ID = 'abcdefghijklmnopabcdefghijklmnop';
let home = '';
let pkg = '';

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ali-home-'));
    pkg = mkdtempSync(join(tmpdir(), 'ali-pkg-'));
    mkdirSync(join(pkg, 'backend'));
    mkdirSync(join(pkg, 'native-host'));
    writeFileSync(join(pkg, 'backend', 'server.js'), '// server');
    writeFileSync(join(pkg, 'backend', 'package.json'), '{"version":"1.2.0"}');
    writeFileSync(join(pkg, 'native-host', 'launcher.js'), '// launcher');
    writeFileSync(join(pkg, 'package.json'), '{"version":"1.2.0"}');
});
afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(pkg, { recursive: true, force: true });
});

describe('setup on macOS', () => {
    it('installs the companion and registers only installed browsers', () => {
        mkdirSync(join(home, 'Library', 'Application Support', 'Google', 'Chrome'), { recursive: true });
        // A leftover from the old installer.
        mkdirSync(join(home, '.appium_locators_inspector', 'backend', 'node_modules'), { recursive: true });

        const result = installCompanion({ home, platform: 'darwin', packageDir: pkg, nodePath: '/opt/node/bin/node', extraExtensionIds: [DEV_ID] });
        const base = join(home, '.appium_locators_inspector');
        expect(result.installedFor).toEqual(['Google Chrome']);
        expect(result.skipped).toEqual(['Chromium', 'Microsoft Edge', 'Brave Browser']);
        expect(existsSync(join(base, 'backend', 'node_modules'))).toBe(false);
        expect(readFileSync(join(base, 'backend', 'server.js'), 'utf8')).toBe('// server');

        const chromeManifest = join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', 'com.appium_locators_inspector.host.json');
        const manifest = JSON.parse(readFileSync(chromeManifest, 'utf8'));
        expect(manifest).toEqual({
            name: 'com.appium_locators_inspector.host',
            description: 'Appium Locators Inspector Native Messaging Host',
            path: join(base, 'native-host', 'host.sh'),
            type: 'stdio',
            allowed_origins: [STORE, `chrome-extension://${DEV_ID}/`]
        });
        const host = join(base, 'native-host', 'host.sh');
        expect(statSync(host).mode & 0o111).not.toBe(0);
        expect(readFileSync(host, 'utf8')).toContain(`NODE='/opt/node/bin/node'`);

        expect(uninstallCompanion({ home, platform: 'darwin' })).toEqual(['Google Chrome']);
        expect(existsSync(chromeManifest)).toBe(false);
        expect(existsSync(base)).toBe(false);
    });
});

describe('setup on Linux', () => {
    it('uses ~/.config browser folders', () => {
        mkdirSync(join(home, '.config', 'chromium'), { recursive: true });
        const result = installCompanion({ home, platform: 'linux', packageDir: pkg, nodePath: '/usr/bin/node', extraExtensionIds: [] });
        expect(result.installedFor).toEqual(['Chromium']);
        expect(existsSync(join(home, '.config', 'chromium', 'NativeMessagingHosts', 'com.appium_locators_inspector.host.json'))).toBe(true);
    });
});

describe('setup on Windows', () => {
    it('writes host.bat and registry keys, and removes them on uninstall', () => {
        const calls: string[][] = [];
        const runRegistry = (args: string[]) => {
            calls.push(args);
            if (args[1]?.includes('Chromium')) throw new Error('access denied');
        };
        const result = installCompanion({ home, platform: 'win32', packageDir: pkg, nodePath: 'C:\\node\\node.exe', extraExtensionIds: [], runRegistry });
        expect(result.installedFor).toEqual(['Google Chrome', 'Microsoft Edge', 'Brave Browser']);
        expect(result.skipped).toEqual(['Chromium']);
        expect(calls[0]).toEqual(['add', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.appium_locators_inspector.host', '/ve', '/t', 'REG_SZ', '/d', result.manifestPath, '/f']);
        const bat = readFileSync(join(home, '.appium_locators_inspector', 'native-host', 'host.bat'), 'utf8');
        expect(bat).toBe(`@echo off\r\n"C:\\node\\node.exe" "${join(home, '.appium_locators_inspector', 'native-host', 'launcher.js')}" %*\r\n`);

        calls.length = 0;
        expect(uninstallCompanion({ home, platform: 'win32', runRegistry })).toEqual(['Google Chrome', 'Microsoft Edge', 'Brave Browser']);
        expect(calls.every((c) => c[0] === 'delete')).toBe(true);
    });
});

describe('setup helpers', () => {
    it('rejects malformed extension IDs and de-duplicates the store ID', () => {
        expect(() => allowedExtensionIds(['nope'])).toThrow('Invalid Chrome extension ID: nope');
        expect(allowedExtensionIds(['annejeomdlkidljonmpmhcdnekkadjfb'])).toEqual(['annejeomdlkidljonmpmhcdnekkadjfb']);
    });

    it('quotes paths in the unix host script', () => {
        const script = unixHostScript("/Users/o'neil/node", '/a b/launcher.js', '/a b/err.log');
        expect(script).toContain(`NODE='/Users/o'\\''neil/node'`);
        expect(script).toContain(`exec "$NODE" '/a b/launcher.js' 2>> '/a b/err.log'`);
        expect(windowsHostScript('n', 'l')).toBe('@echo off\r\n"n" "l" %*\r\n');
    });

    it('lists four browsers per platform', () => {
        for (const platform of ['darwin', 'linux', 'win32'] as const) expect(browserTargets('/h', platform)).toHaveLength(4);
    });

    it('reads the package version', () => {
        expect(packageVersion(pkg)).toBe('1.2.0');
        expect(packageVersion(join(pkg, 'missing'))).toBe('unknown');
    });
});
