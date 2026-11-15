import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const isWindows = process.platform === 'win32';

export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
    return env.HOME || env.USERPROFILE || '';
}

export function findAndroidSdk(env: NodeJS.ProcessEnv = process.env): string | null {
    const home = homeDir(env);
    const candidates = [
        env.ANDROID_SDK_ROOT,
        env.ANDROID_HOME,
        join(home, 'Library/Android/sdk'),
        join(home, 'Android/Sdk'),
        join(home, 'AppData/Local/Android/sdk')
    ];
    return candidates.find((p): p is string => !!p && existsSync(p)) ?? null;
}

/** Chrome launches native hosts with a minimal PATH; add the usual tool locations. */
export function buildSpawnEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const sdk = findAndroidSdk(env);
    const extra = [
        '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin',
        ...(sdk ? [join(sdk, 'platform-tools'), join(sdk, 'tools'), join(sdk, 'tools/bin')] : []),
        '/Applications/Xcode.app/Contents/Developer/usr/bin'
    ].filter((p) => existsSync(p));

    const currentPath = env.PATH || '';
    const PATH = extra.length ? `${extra.join(delimiter)}${delimiter}${currentPath}` : currentPath;
    return sdk ? { ...env, PATH, ANDROID_SDK_ROOT: sdk, ANDROID_HOME: sdk } : { ...env, PATH };
}

function which(command: string, env: NodeJS.ProcessEnv): string | null {
    try {
        const out = execFileSync(isWindows ? 'where' : 'which', [command], { encoding: 'utf8', timeout: 5000, env });
        const first = out.trim().split(/\r?\n/)[0]?.trim();
        return first && existsSync(first) ? first : null;
    } catch {
        return null;
    }
}

export function findAppium(env: NodeJS.ProcessEnv): string | null {
    const home = homeDir(env);
    const appData = env.APPDATA || '';
    const candidates = [
        '/usr/local/bin/appium',
        '/opt/homebrew/bin/appium',
        join(home, '.npm-global/bin/appium'),
        join(home, 'npm/bin/appium'),
        ...(isWindows ? [join(appData, 'npm', 'appium.cmd'), join(appData, 'npm', 'appium'), 'C:\\Program Files\\nodejs\\appium.cmd'] : [])
    ];
    return which('appium', env) ?? candidates.find((p) => existsSync(p)) ?? null;
}
