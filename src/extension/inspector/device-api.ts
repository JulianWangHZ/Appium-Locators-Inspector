import type { GestureName } from '../../shared/protocol.js';
import type { LocatorLike } from '../lib/types.js';
import { state } from './state.js';

async function post(path: string, body: Record<string, unknown>): Promise<void> {
    await fetch(`${state.backendUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

function deviceId(): string | null {
    return state.session?.device?.id ?? null;
}

export async function postTap(x: number, y: number): Promise<void> {
    await post('/api/tap', { deviceId: deviceId(), x, y });
}

export async function postGesture(gesture: GestureName, opts: Record<string, unknown>): Promise<void> {
    await post('/api/gesture', { deviceId: deviceId(), platform: state.session?.device?.platform, gesture, ...opts });
}

export async function postElementText(locator: LocatorLike, text: string): Promise<void> {
    await post('/api/type', { deviceId: deviceId(), strategy: locator.strategy, value: locator.value, text });
}

export async function postKeys(text: string): Promise<void> {
    await post('/api/type', { deviceId: deviceId(), text });
}

export async function postCloseSession(): Promise<void> {
    await post('/api/session/close', { deviceId: deviceId() });
}
