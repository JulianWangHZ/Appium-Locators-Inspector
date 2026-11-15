import type { Platform } from '../shared/protocol.js';
import { DEFAULT_SCREEN_FPS, normalizeScreenFps } from '../shared/fps.js';
import { errorMessage } from './exec.js';
import { captureScreenBase64 } from './screen-capture.js';

const MAX_CONSECUTIVE_ERRORS = 10;

export type StreamUpdate =
    | { type: 'screenshot'; data: string }
    | { type: 'error'; message: string };

type Capture = (platform: Platform, deviceId: string) => Promise<string>;

interface StreamState {
    timer: NodeJS.Timeout;
    capturing: boolean;
    errorCount: number;
}

/** One screenshot loop per device; a slow frame skips ticks instead of piling up. */
export class ScreenMirror {
    private readonly streams = new Map<string, StreamState>();

    constructor(private readonly capture: Capture = captureScreenBase64) {}

    startStreaming(platform: Platform, deviceId: string, onUpdate: (update: StreamUpdate) => void, fps: number = DEFAULT_SCREEN_FPS): number {
        this.stopStreamingForDevice(deviceId);
        const streamFps = normalizeScreenFps(fps);
        const intervalMs = Math.max(1, Math.round(1000 / streamFps));

        const state: StreamState = {
            capturing: false,
            errorCount: 0,
            timer: setInterval(() => void this.tick(platform, deviceId, state, onUpdate), intervalMs)
        };
        this.streams.set(deviceId, state);
        console.log(`Started screen streaming for ${deviceId} at ${streamFps} FPS (Total active: ${this.streams.size})`);
        return streamFps;
    }

    stopStreamingForDevice(deviceId: string): void {
        const state = this.streams.get(deviceId);
        if (!state) return;
        clearInterval(state.timer);
        this.streams.delete(deviceId);
        console.log(`Stopped screen streaming for ${deviceId} (Remaining active: ${this.streams.size})`);
    }

    stopAll(): void {
        for (const state of this.streams.values()) clearInterval(state.timer);
        this.streams.clear();
        console.log('Stopped all screen streaming');
    }

    isStreaming(deviceId: string): boolean {
        return this.streams.has(deviceId);
    }

    private async tick(platform: Platform, deviceId: string, state: StreamState, onUpdate: (update: StreamUpdate) => void): Promise<void> {
        if (state.capturing) return;
        state.capturing = true;
        try {
            const data = await this.capture(platform, deviceId);
            if (this.streams.get(deviceId) === state) {
                onUpdate({ type: 'screenshot', data });
                state.errorCount = 0;
            }
        } catch (error) {
            this.handleCaptureError(deviceId, state, error, onUpdate);
        } finally {
            state.capturing = false;
        }
    }

    private handleCaptureError(deviceId: string, state: StreamState, error: unknown, onUpdate: (update: StreamUpdate) => void): void {
        state.errorCount += 1;
        if (state.errorCount <= 3 || state.errorCount % 10 === 0) {
            console.error(`Streaming error for ${deviceId} (${state.errorCount}/${MAX_CONSECUTIVE_ERRORS}):`, errorMessage(error));
        }
        if (state.errorCount >= MAX_CONSECUTIVE_ERRORS && this.streams.get(deviceId) === state) {
            console.error(`Stopping stream for ${deviceId} after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`);
            onUpdate({ type: 'error', message: 'Screen capture failed repeatedly. Device may be disconnected.' });
            this.stopStreamingForDevice(deviceId);
        }
    }
}
