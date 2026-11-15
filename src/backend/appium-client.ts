import type { DeviceInfo, GestureName, LocatorStrategy, Platform } from '../shared/protocol.js';
import { APPIUM_URL } from './config.js';
import { buildCapabilities } from './capabilities.js';
import { errorMessage } from './exec.js';
import { keyActions, mobileGestureCommand, tapActions, toW3CLocator, type GestureOptions } from './gestures.js';
import { newSession, type WebDriverSession } from './webdriver-client.js';

const SESSION_CREATE_TIMEOUT_MS = 120_000; // WDA builds can be slow
const SESSION_CREATE_RETRIES = 3;
const COMMAND_TIMEOUT_MS = 120_000;

const DEAD_SESSION_MARKERS = [
    'invalid session id',
    'session not created',
    'Session not found',
    'session is either terminated or not started',
    'terminated or not started',
    'ECONNREFUSED',
    'ECONNRESET'
];

interface SessionEntry {
    readonly driver: WebDriverSession;
    readonly active: boolean;
    readonly device: DeviceInfo;
}

export type CreateSessionResult =
    | { success: true; sessionId: string; deviceId: string }
    | { success: false; error: string };

export function isDeadSessionError(error: unknown): boolean {
    const message = errorMessage(error);
    return DEAD_SESSION_MARKERS.some((marker) => message.includes(marker));
}

export class AppiumSessions {
    private readonly sessions = new Map<string, SessionEntry>();

    constructor(private readonly appiumUrl: string = APPIUM_URL) {}

    async createSession(device: DeviceInfo): Promise<CreateSessionResult> {
        try {
            if (this.sessions.has(device.id)) await this.closeSession(device.id);

            const driver = await newSession(this.appiumUrl, buildCapabilities(device), {
                timeoutMs: SESSION_CREATE_TIMEOUT_MS,
                retries: SESSION_CREATE_RETRIES,
                commandTimeoutMs: COMMAND_TIMEOUT_MS
            });
            this.sessions.set(device.id, { driver, active: true, device });
            console.log(`Appium session created for ${device.platform} device: ${device.name} (Total sessions: ${this.sessions.size})`);
            return { success: true, sessionId: driver.sessionId, deviceId: device.id };
        } catch (error) {
            console.error('Error creating Appium session:', errorMessage(error));
            return { success: false, error: errorMessage(error) };
        }
    }

    /** Drop a dead session and create a new one with the same device info. */
    async recreateSession(deviceId: string): Promise<CreateSessionResult> {
        const entry = this.sessions.get(deviceId);
        if (!entry) return { success: false, error: `No stored device info for ${deviceId}` };
        console.log(`Recreating session for ${entry.device.name} (${deviceId})...`);
        this.sessions.delete(deviceId);
        return this.createSession(entry.device);
    }

    isSessionActive(deviceId: string): boolean {
        return this.sessions.get(deviceId)?.active === true;
    }

    getPageSource(deviceId: string): Promise<string> {
        return this.run(deviceId, 'getting page source', (driver) => driver.getPageSource());
    }

    getScreenshot(deviceId: string): Promise<string> {
        return this.run(deviceId, 'taking screenshot', (driver) => driver.takeScreenshot());
    }

    tap(deviceId: string, x: number, y: number): Promise<void> {
        return this.run(deviceId, 'performing tap', async (driver) => {
            await driver.performActions(tapActions(x, y));
            await driver.releaseActions();
            console.log(`Tapped at (${x}, ${y}) on device ${deviceId}`);
        });
    }

    gesture(deviceId: string, platform: Platform, name: GestureName, opts: GestureOptions): Promise<void> {
        const { script, params } = mobileGestureCommand(platform, name, opts);
        return this.run(deviceId, `performing gesture ${name}`, async (driver) => {
            await driver.executeScript(script, [params]);
            console.log(`Gesture ${name} (${script}) on device ${deviceId}`);
        });
    }

    /** Type into the focused element with W3C key actions. */
    sendKeys(deviceId: string, text: string): Promise<void> {
        return this.run(deviceId, 'sending keys', async (driver) => {
            await driver.performActions(keyActions(text));
            console.log(`Sent ${text.length} key(s) to device ${deviceId}`);
        });
    }

    /** Find an element by locator, clear it, then type into it. */
    setElementText(deviceId: string, strategy: LocatorStrategy, value: string, text: string): Promise<void> {
        const locator = toW3CLocator(strategy, value);
        return this.run(deviceId, 'setting element text', async (driver) => {
            const elementId = await driver.findElement(locator.using, locator.value);
            await driver.elementClear(elementId).catch(() => { /* not every field supports clear */ });
            await driver.elementSendKeys(elementId, text);
            console.log(`Set text on ${strategy}=${value} (device ${deviceId})`);
        });
    }

    async closeSession(deviceId: string): Promise<void> {
        const entry = this.sessions.get(deviceId);
        if (!entry) return;
        this.sessions.delete(deviceId);
        try {
            await entry.driver.deleteSession();
            console.log(`Appium session closed for ${deviceId} (Remaining sessions: ${this.sessions.size})`);
        } catch (error) {
            console.error(`Error closing session for ${deviceId}:`, errorMessage(error));
        }
    }

    async closeAllSessions(): Promise<void> {
        const entries = [...this.sessions.entries()];
        this.sessions.clear();
        await Promise.all(entries.map(async ([deviceId, entry]) => {
            try {
                await entry.driver.deleteSession();
            } catch (error) {
                console.error(`Error closing session for ${deviceId}:`, errorMessage(error));
            }
        }));
        console.log('All Appium sessions closed');
    }

    private driverFor(deviceId: string): WebDriverSession {
        const entry = this.sessions.get(deviceId);
        if (!entry) throw new Error(`No active Appium session for device: ${deviceId}`);
        if (!entry.active) throw new Error(`Appium session for device ${deviceId} is no longer active`);
        return entry.driver;
    }

    private async run<T>(deviceId: string, what: string, fn: (driver: WebDriverSession) => Promise<T>): Promise<T> {
        const driver = this.driverFor(deviceId);
        try {
            return await fn(driver);
        } catch (error) {
            console.error(`Error ${what} on ${deviceId}:`, errorMessage(error));
            this.markDeadOnSessionError(deviceId, error);
            throw error;
        }
    }

    private markDeadOnSessionError(deviceId: string, error: unknown): void {
        const entry = this.sessions.get(deviceId);
        if (!entry || !isDeadSessionError(error)) return;
        console.warn(`Session for ${deviceId} appears dead, marking inactive`);
        this.sessions.set(deviceId, { ...entry, active: false });
    }
}
