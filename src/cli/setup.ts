/** Register (or remove) the native messaging host so the popup's Start button works. */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NATIVE_HOST_NAME, STORE_EXTENSION_ID } from '../shared/defaults.js';

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

export interface SetupContext {
    home: string;
    platform: NodeJS.Platform;
    /** Folder holding backend/ and native-host/ from the npm package. */
    packageDir: string;
    nodePath: string;
    extraExtensionIds: string[];
    /** Runs `reg` on Windows; injectable for tests. */
    runRegistry?: (args: string[]) => void;
}

export interface BrowserTarget {
    name: string;
    /** macOS/Linux: NativeMessagingHosts folder. Windows: registry key. */
    location: string;
}

export interface SetupResult {
    installBase: string;
    manifestPath: string;
    installedFor: string[];
    skipped: string[];
}

export function installBaseOf(home: string): string {
    return join(home, '.appium_locators_inspector');
}

export function browserTargets(home: string, platform: NodeJS.Platform): BrowserTarget[] {
    if (platform === 'darwin') {
        const support = join(home, 'Library', 'Application Support');
        return [
            { name: 'Google Chrome', location: join(support, 'Google', 'Chrome', 'NativeMessagingHosts') },
            { name: 'Chromium', location: join(support, 'Chromium', 'NativeMessagingHosts') },
            { name: 'Microsoft Edge', location: join(support, 'Microsoft Edge', 'NativeMessagingHosts') },
            { name: 'Brave Browser', location: join(support, 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts') }
        ];
    }
    if (platform === 'win32') {
        const key = (vendor: string) => `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
        return [
            { name: 'Google Chrome', location: key('Google\\Chrome') },
            { name: 'Chromium', location: key('Chromium') },
            { name: 'Microsoft Edge', location: key('Microsoft\\Edge') },
            { name: 'Brave Browser', location: key('BraveSoftware\\Brave-Browser') }
        ];
    }
    const config = join(home, '.config');
    return [
        { name: 'Google Chrome', location: join(config, 'google-chrome', 'NativeMessagingHosts') },
        { name: 'Chromium', location: join(config, 'chromium', 'NativeMessagingHosts') },
        { name: 'Microsoft Edge', location: join(config, 'microsoft-edge', 'NativeMessagingHosts') },
        { name: 'Brave Browser', location: join(config, 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts') }
    ];
}

export function allowedExtensionIds(extra: string[]): string[] {
    const invalid = extra.filter((id) => !EXTENSION_ID_PATTERN.test(id));
    if (invalid.length) throw new Error(`Invalid Chrome extension ID: ${invalid.join(', ')} (expected 32 letters a-p)`);
    return [...new Set([STORE_EXTENSION_ID, ...extra])];
}

const shQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** Chrome starts native hosts with a minimal PATH; prefer the Node that ran setup. */
export function unixHostScript(nodePath: string, launcherPath: string, logPath: string): string {
    return [
        '#!/bin/bash',
        '# Appium Locators Inspector native messaging host (written by `npx appium-locators-inspector setup`).',
        'export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"',
        `NODE=${shQuote(nodePath)}`,
        'if [ ! -x "$NODE" ]; then NODE="$(command -v node 2>/dev/null)"; fi',
        'if [ -z "$NODE" ]; then',
        '    for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do',
        '        if [ -x "$candidate" ]; then NODE="$candidate"; break; fi',
        '    done',
        'fi',
        `if [ -z "$NODE" ]; then echo "$(date): Node.js not found" >> ${shQuote(logPath)}; exit 1; fi`,
        `exec "$NODE" ${shQuote(launcherPath)} 2>> ${shQuote(logPath)}`,
        ''
    ].join('\n');
}

export function windowsHostScript(nodePath: string, launcherPath: string): string {
    return `@echo off\r\n"${nodePath}" "${launcherPath}" %*\r\n`;
}

function defaultRunRegistry(args: string[]): void {
    execFileSync('reg', args, { stdio: 'ignore' });
}

/** Copy the companion into ~/.appium_locators_inspector and register it with each installed browser. */
export function installCompanion(ctx: SetupContext): SetupResult {
    const extensionIds = allowedExtensionIds(ctx.extraExtensionIds);
    const installBase = installBaseOf(ctx.home);
    const backendDir = join(installBase, 'backend');
    const hostDir = join(installBase, 'native-host');
    const isWindows = ctx.platform === 'win32';

    // A clean backend folder: older installers left node_modules here.
    rmSync(backendDir, { recursive: true, force: true });
    mkdirSync(backendDir, { recursive: true });
    mkdirSync(hostDir, { recursive: true });
    for (const file of ['server.js', 'package.json']) {
        copyFileSync(join(ctx.packageDir, 'backend', file), join(backendDir, file));
    }
    const launcherPath = join(hostDir, 'launcher.js');
    copyFileSync(join(ctx.packageDir, 'native-host', 'launcher.js'), launcherPath);

    const hostScript = join(hostDir, isWindows ? 'host.bat' : 'host.sh');
    writeFileSync(
        hostScript,
        isWindows ? windowsHostScript(ctx.nodePath, launcherPath) : unixHostScript(ctx.nodePath, launcherPath, join(installBase, 'native-host-stderr.log')),
        { mode: 0o755 }
    );

    const manifestPath = join(hostDir, `${NATIVE_HOST_NAME}.json`);
    const manifest = {
        name: NATIVE_HOST_NAME,
        description: 'Appium Locators Inspector Native Messaging Host',
        path: hostScript,
        type: 'stdio',
        allowed_origins: extensionIds.map((id) => `chrome-extension://${id}/`)
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const installedFor: string[] = [];
    const skipped: string[] = [];
    for (const target of browserTargets(ctx.home, ctx.platform)) {
        if (isWindows) {
            try {
                (ctx.runRegistry ?? defaultRunRegistry)(['add', target.location, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f']);
                installedFor.push(target.name);
            } catch {
                skipped.push(target.name);
            }
            continue;
        }
        // Only browsers that are installed (their profile folder exists).
        if (!existsSync(dirname(target.location))) {
            skipped.push(target.name);
            continue;
        }
        mkdirSync(target.location, { recursive: true });
        copyFileSync(manifestPath, join(target.location, `${NATIVE_HOST_NAME}.json`));
        installedFor.push(target.name);
    }
    return { installBase, manifestPath, installedFor, skipped };
}

/** Remove the browser registrations and ~/.appium_locators_inspector. */
export function uninstallCompanion(ctx: Pick<SetupContext, 'home' | 'platform' | 'runRegistry'>): string[] {
    const removed: string[] = [];
    for (const target of browserTargets(ctx.home, ctx.platform)) {
        if (ctx.platform === 'win32') {
            try {
                (ctx.runRegistry ?? defaultRunRegistry)(['delete', target.location, '/f']);
                removed.push(target.name);
            } catch { /* not registered */ }
            continue;
        }
        const file = join(target.location, `${NATIVE_HOST_NAME}.json`);
        if (existsSync(file)) {
            rmSync(file);
            removed.push(target.name);
        }
    }
    rmSync(installBaseOf(ctx.home), { recursive: true, force: true });
    return removed;
}

export function packageVersion(packageDir: string): string {
    try {
        return (JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { version?: string }).version ?? 'unknown';
    } catch {
        return 'unknown';
    }
}
