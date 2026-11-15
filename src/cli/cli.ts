import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_APPIUM_PORT, DEFAULT_BACKEND_PORT, NPM_PACKAGE_NAME } from '../shared/defaults.js';
import { DEFAULT_SCREEN_FPS, normalizeScreenFps } from '../shared/fps.js';
import { parsePort } from '../shared/validation.js';
import { installBaseOf, installCompanion, isCompanionInstalled, packageVersion, uninstallCompanion } from './setup.js';
import { runCompanion, type Output } from './start.js';

const HELP = `Appium Locators Inspector companion

Usage:
  npx ${NPM_PACKAGE_NAME} setup      Recommended, once: the popup's "Start servers" then starts
                                           the companion in the background (no terminal needed).
  npx ${NPM_PACKAGE_NAME}            Or run it in this terminal (backend + Appium). Ctrl+C stops it.
  npx ${NPM_PACKAGE_NAME} uninstall  Remove what "setup" installed.

Options:
  --port <n>           Backend port (default ${DEFAULT_BACKEND_PORT}; must match the extension settings)
  --appium-port <n>    Appium port (default ${DEFAULT_APPIUM_PORT})
  --fps <n>            Screen mirror frames per second, 1-30 (default ${DEFAULT_SCREEN_FPS})
  --no-appium          Do not start Appium (use one you run yourself)
  --verbose            Show Appium's log here (default: ~/.appium_locators_inspector/appium.log)
  --extension-id <id>  setup: also allow this extension ID (an unpacked dev build). Repeatable.
  -v, --version        Print the version
  -h, --help           Print this help

Environment: APPLE_TEAM_ID signs WebDriverAgent for iOS real devices;
APPIUM_PATH points to an Appium binary outside your PATH.`;

const out: Output = { log: (l) => console.log(l), error: (l) => console.error(l) };

export async function main(argv: string[], packageDir: string): Promise<number> {
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            allowPositionals: true,
            options: {
                port: { type: 'string' },
                'appium-port': { type: 'string' },
                fps: { type: 'string' },
                'no-appium': { type: 'boolean', default: false },
                verbose: { type: 'boolean', default: false },
                'extension-id': { type: 'string', multiple: true, default: [] },
                version: { type: 'boolean', short: 'v', default: false },
                help: { type: 'boolean', short: 'h', default: false }
            }
        });
    } catch (error) {
        out.error((error as Error).message);
        out.error(`Run "npx ${NPM_PACKAGE_NAME} --help" for usage.`);
        return 2;
    }
    const { values, positionals } = parsed;
    const command = positionals[0] ?? 'start';

    if (values.help) {
        out.log(HELP);
        return 0;
    }
    if (values.version) {
        out.log(packageVersion(packageDir));
        return 0;
    }

    switch (command) {
        case 'start':
            return runCompanion(packageDir, {
                port: parsePort(values.port, DEFAULT_BACKEND_PORT),
                appiumPort: parsePort(values['appium-port'], DEFAULT_APPIUM_PORT),
                fps: normalizeScreenFps(values.fps),
                appium: !values['no-appium'],
                verbose: !!values.verbose,
                appiumLogFile: join(installBaseOf(homedir()), 'appium.log'),
                showSetupTip: !isCompanionInstalled(homedir())
            }, out);
        case 'setup': {
            const result = installCompanion({
                home: homedir(),
                platform: process.platform,
                packageDir,
                nodePath: process.execPath,
                extraExtensionIds: values['extension-id'] ?? []
            });
            out.log(`Installed to ${result.installBase}`);
            out.log(result.installedFor.length ? `Registered for: ${result.installedFor.join(', ')}` : 'No supported browser found.');
            out.log('Reload the extension in chrome://extensions, then use "Start servers" in the popup.');
            return result.installedFor.length ? 0 : 1;
        }
        case 'uninstall': {
            const removed = uninstallCompanion({ home: homedir(), platform: process.platform });
            out.log(removed.length ? `Removed from: ${removed.join(', ')}` : 'Nothing was registered.');
            return 0;
        }
        default:
            out.error(`Unknown command: ${command}`);
            out.log(HELP);
            return 2;
    }
}
