import { AppiumSessions } from './appium-client.js';
import { createBackendServer } from './app.js';
import { SCREEN_CAPTURE_FPS, SERVER_HOST, SERVER_PORT, WS_HEARTBEAT_INTERVAL_MS } from './config.js';
import { isAdbAvailable, isIOSToolsAvailable } from './device-manager.js';
import { errorMessage } from './exec.js';
import { ScreenMirror } from './screen-mirror.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const sessions = new AppiumSessions();
const mirror = new ScreenMirror();
const server = createBackendServer({
    sessions,
    mirror,
    port: SERVER_PORT,
    defaultFps: SCREEN_CAPTURE_FPS,
    heartbeatMs: WS_HEARTBEAT_INTERVAL_MS
});

server.listen(SERVER_PORT, SERVER_HOST, async () => {
    const [adb, ios] = await Promise.all([isAdbAvailable(), isIOSToolsAvailable()]);
    console.log([
        'Appium Locators Inspector backend',
        `  HTTP:      http://localhost:${SERVER_PORT}`,
        `  WebSocket: ws://localhost:${SERVER_PORT}`,
        `  ADB available: ${adb ? 'yes' : 'no'}`,
        `  iOS tools:     ${ios ? 'yes' : 'no'}`
    ].join('\n'));
});

async function shutdown(signal: string): Promise<void> {
    console.log(`${signal} received, closing server...`);
    setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    try {
        await sessions.closeAllSessions();
    } catch (error) {
        console.error('Error closing sessions:', errorMessage(error));
    }
    mirror.stopAll();
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('uncaughtException', (error) => console.error('Uncaught exception:', error));
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));
