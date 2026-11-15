import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { buildSpawnEnv, findAppium } from '../native-host/environment.js';
import { killProcessTree } from '../native-host/ports.js';
import { SETUP_COMMAND } from '../shared/defaults.js';
import { isPortInUse } from './ports.js';

export interface StartOptions {
    port: number;
    appiumPort: number;
    fps: number;
    /** Start Appium too (unless one already listens on appiumPort). */
    appium: boolean;
    /** Print Appium's own log here instead of writing it to appiumLogFile. */
    verbose: boolean;
    appiumLogFile: string;
    /** Suggest `setup` (not yet done) so the user needs no terminal next time. */
    showSetupTip?: boolean;
}

export interface Output {
    log: (line: string) => void;
    error: (line: string) => void;
}

function pipeLines(child: ChildProcess, prefix: string, out: Output): void {
    const forward = (write: (line: string) => void) => (data: Buffer) => {
        for (const line of data.toString().split(/\r?\n/)) if (line.trim()) write(`${prefix} ${line}`);
    };
    child.stdout?.on('data', forward(out.log));
    child.stderr?.on('data', forward(out.error));
}

async function startAppium(opts: StartOptions, env: NodeJS.ProcessEnv, out: Output): Promise<ChildProcess | null> {
    if (!opts.appium) return null;
    if (await isPortInUse(opts.appiumPort)) {
        out.log(`Using the Appium server already running on port ${opts.appiumPort}.`);
        return null;
    }
    const appiumPath = findAppium(env);
    if (!appiumPath) {
        out.error('Appium not found. Install it with: npm install -g appium');
        out.error('The companion still starts; device sessions need Appium.');
        return null;
    }
    const args = ['--port', String(opts.appiumPort)];
    const child = process.platform === 'win32'
        ? spawn(`"${appiumPath}"`, args, { shell: true, env })
        : spawn(appiumPath, args, { env });
    if (opts.verbose) {
        pipeLines(child, '[appium]', out);
    } else {
        mkdirSync(dirname(opts.appiumLogFile), { recursive: true });
        const log = createWriteStream(opts.appiumLogFile, { flags: 'w' });
        child.stdout?.pipe(log);
        child.stderr?.pipe(log);
    }
    out.log(`Starting Appium on port ${opts.appiumPort} (${appiumPath})`);
    if (!opts.verbose) out.log(`Appium log: ${opts.appiumLogFile} (use --verbose to show it here)`);
    child.once('exit', (code) => {
        if (code) out.error(`Appium exited with code ${code}. See ${opts.verbose ? 'the output above' : opts.appiumLogFile}.`);
    });
    return child;
}

/**
 * Run the backend (and Appium) in the foreground until Ctrl+C or until the
 * extension asks the backend to shut down. Resolves with the exit code.
 */
export async function runCompanion(packageDir: string, opts: StartOptions, out: Output): Promise<number> {
    if (await isPortInUse(opts.port)) {
        out.error(`Port ${opts.port} is already in use. Is the companion already running?`);
        out.error('Stop it first, or pick another port with --port (and set the same port in the extension settings).');
        return 1;
    }

    const env = buildSpawnEnv();
    const appium = await startAppium(opts, env, out);
    const backend = spawn(process.execPath, [join(packageDir, 'backend', 'server.js')], {
        env: { ...env, PORT: String(opts.port), APPIUM_PORT: String(opts.appiumPort), APPIUM_HOST: 'localhost', SCREEN_FPS: String(opts.fps) }
    });
    pipeLines(backend, '[backend]', out);

    const stopAppium = () => killProcessTree(appium?.pid);
    const onSignal = () => {
        out.log('Stopping…');
        stopAppium();
        killProcessTree(backend.pid);
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    out.log('');
    out.log('Appium Locators Inspector companion is running.');
    out.log('Open the extension popup and pick your device. Press Ctrl+C here to stop.');
    if (opts.showSetupTip) {
        out.log('');
        out.log(`Tip: run "${SETUP_COMMAND}" once, and the popup's Start servers`);
        out.log('button will start the companion for you, with no terminal to keep open.');
    }
    out.log('');

    return new Promise((resolve) => {
        backend.once('exit', (code) => {
            process.off('SIGINT', onSignal);
            process.off('SIGTERM', onSignal);
            stopAppium();
            resolve(code ?? 0);
        });
        backend.once('error', (error) => {
            out.error(`Could not start the backend: ${error.message}`);
            stopAppium();
            resolve(1);
        });
    });
}
