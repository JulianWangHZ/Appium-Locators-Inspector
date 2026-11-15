import type { GestureName } from '../../shared/protocol.js';
import type { LocatorLike } from '../lib/types.js';
import { isConnected, requestPageSource } from './connection.js';
import { postElementText, postGesture, postKeys, postTap } from './device-api.js';
import { showNotification } from './notify.js';
import { state } from './state.js';

const TAP_SETTLE_MS = 1000;
const TYPE_SETTLE_MS = 800;

function canDrive(): boolean {
    return isConnected() && !!state.session?.device;
}

function refreshAfter(ms: number): void {
    setTimeout(() => requestPageSource(true), ms);
}

export async function sendTap(x: number, y: number): Promise<void> {
    if (!canDrive()) return;
    try {
        await postTap(x, y);
        refreshAfter(TAP_SETTLE_MS);
    } catch (error) {
        console.error('Tap failed:', error);
        showNotification(`Tap failed: ${(error as Error).message}`, 'error');
    }
}

export async function sendGesture(gesture: GestureName, opts: Record<string, unknown>): Promise<void> {
    if (!canDrive()) return;
    try {
        await postGesture(gesture, opts);
        refreshAfter(TAP_SETTLE_MS);
    } catch (error) {
        console.error('Gesture failed:', error);
    }
}

/** Element-scoped typing (backend finds the element by locator, then sets its value). */
export async function sendTextToElement(locator: LocatorLike, text: string): Promise<void> {
    if (!canDrive()) return;
    try {
        await postElementText(locator, text);
        refreshAfter(TYPE_SETTLE_MS);
    } catch (error) {
        console.error('Type (element) failed:', error);
    }
}

/** Type into whatever is focused on the device. */
export async function sendKeys(text: string): Promise<void> {
    if (!canDrive()) return;
    try {
        await postKeys(text);
    } catch (error) {
        console.error('Type failed:', error);
    }
}
