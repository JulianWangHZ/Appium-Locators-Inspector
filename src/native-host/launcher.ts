import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { LogLevel, NativeMessage } from '../shared/protocol.js';
import { diagnoseSetup } from './diagnose.js';
import { buildSpawnEnv } from './environment.js';
import { decodeMessages, encodeMessage } from './messaging.js';
import { ServerProcesses } from './server-processes.js';

// Bundled to <installBase>/native-host/launcher.js; the backend lives in <installBase>/backend.
const INSTALL_BASE = resolve(__dirname, '..');
const LOG_FILE = join(INSTALL_BASE, 'native-host.log');

function send(message: NativeMessage): void {
    try {
        if (process.stdout.writable) process.stdout.write(encodeMessage(message));
    } catch {
        // Chrome disconnected.
    }
}

function log(message: string, level: LogLevel = 'info'): void {
    const entry = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
    try {
        appendFileSync(LOG_FILE, `${entry}\n`);
    } catch {
        // Log file not writable; still forward to the extension.
    }
    send({ type: 'log', message: entry, level });
}

const servers = new ServerProcesses({
    installBase: INSTALL_BASE,
    env: buildSpawnEnv(),
    nodePath: process.execPath,
    log,
    send
});

function isExternalAppiumRunning(): boolean {
    if (process.platform === 'win32') return false;
    try {
        execFileSync('pgrep', ['-x', 'appium'], { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

function handleCommand(msg: Record<string, unknown>): void {
    log(`Received message: ${String(msg.command)}`);
    switch (msg.command) {
        case 'start': {
            const backend = servers.startBackend(msg.backendPort, msg.appiumPort, msg.fpsLimit);
            const appium = servers.startAppium(msg.appiumPort);
            send({ type: 'start-result', backend, appium });
            return;
        }
        case 'stop':
            send({ type: 'stop-result', data: servers.stopAll() });
            return;
        case 'status':
            send({ type: 'status', backend: servers.backendRunning, appium: servers.appiumRunning || isExternalAppiumRunning() });
            return;
        case 'diagnose':
            send({ type: 'diagnose-result', requestId: Number(msg.requestId), data: diagnoseSetup(INSTALL_BASE, msg.extensionId) });
            return;
    }
}

let pending: Buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk: Buffer) => {
    const { messages, rest, error } = decodeMessages(Buffer.concat([pending, chunk]));
    pending = rest;
    if (error) log(error, 'error');
    for (const message of messages) {
        try {
            if (message && typeof message === 'object') handleCommand(message as Record<string, unknown>);
        } catch (err) {
            log(`Error processing message: ${(err as Error).message}`, 'error');
        }
    }
});
// Chrome closes stdin when the extension disconnects.
process.stdin.on('end', () => process.exit(0));

process.on('exit', () => servers.stopAll());
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.stdout.on('error', () => process.exit(0));
process.on('uncaughtException', (error) => log(`Uncaught exception: ${error.message}`, 'error'));
process.on('unhandledRejection', (reason) => log(`Unhandled rejection: ${String(reason)}`, 'error'));

log('Native host launcher started');
