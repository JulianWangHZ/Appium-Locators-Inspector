import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { NATIVE_HOST_NAME } from '../shared/defaults.js';
import type { SetupDiagnostics } from '../shared/protocol.js';

function readJson(path: string): Record<string, unknown> | null {
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
        return null;
    }
}

/** What the options page "Environment" check shows about the companion install. */
export function diagnoseSetup(installBase: string, extensionId: unknown): SetupDiagnostics {
    const manifestPath = join(installBase, 'native-host', `${NATIVE_HOST_NAME}.json`);
    const backendPath = join(installBase, 'backend');
    const packageJsonPath = join(backendPath, 'package.json');
    const manifest = readJson(manifestPath);
    const allowedOrigins = manifest?.allowed_origins;
    const origin = typeof extensionId === 'string' && extensionId ? `chrome-extension://${extensionId}/` : null;
    const version = readJson(packageJsonPath)?.version;

    return {
        backendInstalled: existsSync(join(backendPath, 'server.js')) && existsSync(packageJsonPath),
        dependenciesInstalled: existsSync(join(backendPath, 'node_modules')),
        launcherInstalled: existsSync(join(installBase, 'native-host', 'launcher.js')),
        manifestInstalled: !!manifest,
        extensionAllowed: !!origin && Array.isArray(allowedOrigins) && allowedOrigins.includes(origin),
        manifestPath,
        hostName: basename(manifestPath, '.json'),
        backendPath,
        installBase,
        companionVersion: typeof version === 'string' ? version : null
    };
}
