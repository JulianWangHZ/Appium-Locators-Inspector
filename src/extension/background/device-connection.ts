import type { DeviceInfo } from '../../shared/protocol.js';
import { broadcast } from '../lib/messages.js';
import { loadBackendUrl } from '../lib/settings.js';

interface CreateSessionResponse {
    success: boolean;
    sessionId?: string;
    error?: string;
}

/** Create the Appium session here so it survives the popup closing, then open the inspector. */
export async function connectDevice(device: DeviceInfo): Promise<void> {
    console.log('Background: connecting to device', device.name);
    try {
        const response = await fetch(`${await loadBackendUrl()}/api/session/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceInfo: device })
        });
        const data = (await response.json()) as CreateSessionResponse;

        if (!data.success) {
            console.error('Background: session creation failed', data.error);
            broadcast({ type: 'device-connection-result', success: false, error: data.error || 'Session creation failed' });
            return;
        }

        await chrome.storage.local.set({ activeSession: { device, sessionId: data.sessionId, timestamp: Date.now() } });
        await chrome.tabs.create({ url: chrome.runtime.getURL('inspector/inspector.html') });
        broadcast({ type: 'device-connection-result', success: true, device: device.name });
    } catch (error) {
        console.error('Background: connection error', (error as Error).message);
        broadcast({ type: 'device-connection-result', success: false, error: (error as Error).message || 'Connection failed' });
    }
}
