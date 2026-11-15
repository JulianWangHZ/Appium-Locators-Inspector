import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { DEFAULT_APPIUM_PORT, DEFAULT_BACKEND_PORT } from '../shared/defaults.js';
import { normalizeScreenFps } from '../shared/fps.js';
import type { LogLevel, NativeMessage, ProcessStartResult } from '../shared/protocol.js';
import { parsePort } from '../shared/validation.js';
import { findAppium } from './environment.js';
import { killPortProcess, killProcessTree } from './ports.js';

export interface ProcessDeps {
    installBase: string;
    env: NodeJS.ProcessEnv;
    nodePath: string;
    log: (message: string, level?: LogLevel) => void;
    send: (message: NativeMessage) => void;
}

function forwardOutput(child: ChildProcess, prefix: string, deps: ProcessDeps, onStderr?: (text: string) => void): void {
    child.stdout?.on('data', (data: Buffer) => deps.log(`[${prefix}] ${data.toString().trim()}`, 'info'));
    child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        deps.log(`[${prefix}] ${text}`, 'error');
        onStderr?.(text);
    });
}

/** Owns the backend and Appium child processes started for the extension. */
export class ServerProcesses {
    private backend: ChildProcess | null = null;
    private appium: ChildProcess | null = null;
    private backendPort = DEFAULT_BACKEND_PORT;
    private appiumPort = DEFAULT_APPIUM_PORT;
    private screenFps = normalizeScreenFps(undefined);

    constructor(private readonly deps: ProcessDeps) {}

    get backendRunning(): boolean {
        return this.backend !== null;
    }

    get appiumRunning(): boolean {
        return this.appium !== null;
    }

    startBackend(backendPort: unknown, appiumPort: unknown, fpsLimit: unknown): ProcessStartResult {
        if (this.backend) {
            return { success: true, message: 'Backend already running', pid: this.backend.pid, fps: this.screenFps };
        }
        const port = parsePort(backendPort, DEFAULT_BACKEND_PORT);
        const aPort = parsePort(appiumPort, DEFAULT_APPIUM_PORT);
        this.backendPort = port;
        this.screenFps = normalizeScreenFps(fpsLimit);
        const { log } = this.deps;

        try {
            killPortProcess(port, (m) => log(m, 'warning'));
            log(`Starting Backend Server on port ${port} (Appium port: ${aPort}, screen FPS: ${this.screenFps})...`);
            const child = spawn(this.deps.nodePath, [join(this.deps.installBase, 'backend', 'server.js')], {
                cwd: this.deps.installBase,
                env: { ...this.deps.env, PORT: String(port), APPIUM_PORT: String(aPort), APPIUM_HOST: 'localhost', SCREEN_FPS: String(this.screenFps) }
            });
            this.backend = child;
            forwardOutput(child, 'Backend', this.deps, (text) => {
                if (text.includes('Cannot find module') || text.includes('MODULE_NOT_FOUND')) {
                    log("ACTION REQUIRED: Backend dependencies missing. Please run 'npm install' in the 'backend' directory.", 'error');
                }
            });
            this.onExit(child, 'Backend', () => { this.backend = null; });
            log(`Backend started with PID ${child.pid}`);
            return { success: true, pid: child.pid };
        } catch (error) {
            const message = (error as Error).message;
            log(`Error starting backend: ${message}`, 'error');
            return { success: false, error: message };
        }
    }

    startAppium(appiumPort: unknown): ProcessStartResult {
        if (this.appium) return { success: true, message: 'Appium already running', pid: this.appium.pid };
        const port = parsePort(appiumPort, DEFAULT_APPIUM_PORT);
        this.appiumPort = port;
        const { log } = this.deps;

        const appiumPath = findAppium(this.deps.env);
        if (!appiumPath) {
            const error = 'Appium is not installed or not found in PATH. Please install it using: npm install -g appium';
            log(error, 'error');
            return { success: false, error, code: 'APPIUM_NOT_FOUND' };
        }

        try {
            killPortProcess(port, (m) => log(m, 'warning'));
            log(`Starting Appium Server on port ${port} from: ${appiumPath}`);
            const args = port !== DEFAULT_APPIUM_PORT ? ['--port', String(port)] : [];
            // .cmd shims need a shell on Windows; elsewhere spawn directly so paths with spaces work.
            const isWindows = process.platform === 'win32';
            const child = isWindows
                ? spawn(`"${appiumPath}"`, args, { shell: true, env: this.deps.env })
                : spawn(appiumPath, args, { env: this.deps.env });
            this.appium = child;
            forwardOutput(child, 'Appium', this.deps, (text) => {
                if (text.includes('EADDRINUSE') || text.includes('address already in use')) {
                    log(`Port ${port} is already in use. Please stop other Appium instances.`, 'error');
                }
            });
            this.onExit(child, 'Appium', () => { this.appium = null; });
            log(`Appium started with PID ${child.pid}`);
            return { success: true, pid: child.pid };
        } catch (error) {
            const message = `Error starting Appium: ${(error as Error).message}`;
            log(message, 'error');
            return { success: false, error: message, code: 'APPIUM_START_ERROR' };
        }
    }

    stopAll(): { success: true; backendStopped: boolean; appiumStopped: boolean } {
        const backendStopped = this.backend !== null;
        const appiumStopped = this.appium !== null;
        killProcessTree(this.backend?.pid);
        killProcessTree(this.appium?.pid);
        this.backend = null;
        this.appium = null;
        killPortProcess(this.backendPort, () => {});
        killPortProcess(this.appiumPort, () => {});
        return { success: true, backendStopped, appiumStopped };
    }

    private onExit(child: ChildProcess, name: string, clear: () => void): void {
        const report = () => this.deps.send({ type: 'status', backend: this.backendRunning, appium: this.appiumRunning });
        child.on('close', (code) => {
            this.deps.log(`${name} process exited with code ${code}`, code === 0 ? 'info' : 'warning');
            if (this.isCurrent(child)) clear();
            report();
        });
        child.on('error', (error) => {
            this.deps.log(`${name} process error: ${error.message}`, 'error');
            if (this.isCurrent(child)) clear();
            report();
        });
    }

    private isCurrent(child: ChildProcess): boolean {
        return child === this.backend || child === this.appium;
    }
}
