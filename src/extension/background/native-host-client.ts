import { NATIVE_HOST_NAME } from '../../shared/defaults.js';
import type { NativeCommand, NativeMessage } from '../../shared/protocol.js';

interface PendingRequest {
    resolve: (msg: NativeMessage) => void;
    timer: ReturnType<typeof setTimeout>;
}

export interface NativeHostEvents {
    onMessage: (msg: NativeMessage) => void;
    onDisconnect: (lastError: string | undefined) => void;
    onConnectFailed: (error: string) => void;
}

/** One long-lived port to the companion; request/response matched by requestId. */
export class NativeHostClient {
    private port: chrome.runtime.Port | null = null;
    private nextRequestId = 0;
    private readonly pending = new Map<number, PendingRequest>();

    constructor(private readonly events: NativeHostEvents) {}

    get connected(): boolean {
        return this.port !== null;
    }

    connect(): void {
        if (this.port) return;
        try {
            const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
            this.port = port;
            port.onMessage.addListener((msg: NativeMessage) => this.handleMessage(msg));
            port.onDisconnect.addListener(() => {
                const lastError = chrome.runtime.lastError?.message;
                console.log('Native host disconnected:', lastError);
                this.port = null;
                this.rejectPending();
                this.events.onDisconnect(lastError);
            });
            this.post({ command: 'status' });
        } catch (error) {
            console.error('Failed to connect to native host:', error);
            this.port = null;
            this.events.onConnectFailed((error as Error).message);
        }
    }

    post(command: NativeCommand): boolean {
        if (!this.port) return false;
        this.port.postMessage(command);
        return true;
    }

    request(command: Omit<Extract<NativeCommand, { requestId: number }>, 'requestId'>, timeoutMs = 3000): Promise<NativeMessage> {
        return new Promise((resolve, reject) => {
            if (!this.port) {
                reject(new Error('Native host is not connected'));
                return;
            }
            const requestId = ++this.nextRequestId;
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error('Native host did not respond'));
            }, timeoutMs);
            this.pending.set(requestId, { resolve, timer });
            this.port.postMessage({ ...command, requestId });
        });
    }

    private handleMessage(msg: NativeMessage): void {
        const requestId = 'requestId' in msg ? msg.requestId : undefined;
        const pending = requestId != null ? this.pending.get(requestId) : undefined;
        if (pending && requestId != null) {
            clearTimeout(pending.timer);
            this.pending.delete(requestId);
            pending.resolve(msg);
            return;
        }
        this.events.onMessage(msg);
    }

    /** Pending requests time out on their own; just stop waiting early. */
    private rejectPending(): void {
        for (const { timer } of this.pending.values()) clearTimeout(timer);
        this.pending.clear();
    }
}
