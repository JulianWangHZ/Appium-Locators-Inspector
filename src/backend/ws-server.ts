import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { ServerMessage } from '../shared/protocol.js';
import { normalizeScreenFps } from '../shared/fps.js';
import { isValidDeviceId } from '../shared/validation.js';
import type { AppiumSessions } from './appium-client.js';
import { errorMessage } from './exec.js';
import { isTrustedRequest } from './request-guard.js';
import type { ScreenMirror } from './screen-mirror.js';

export interface WsDeps {
    sessions: AppiumSessions;
    mirror: ScreenMirror;
    defaultFps: number;
    heartbeatMs: number;
}

interface Client {
    readonly id: number;
    readonly ws: WebSocket;
    alive: boolean;
    /** Device this connection streams; set by start-streaming. */
    deviceId: string | null;
}

function send(client: Client, message: ServerMessage): void {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    try {
        client.ws.send(JSON.stringify(message));
    } catch (error) {
        console.error(`Failed to send to client ${client.id}:`, errorMessage(error));
    }
}

function parseMessage(raw: RawData): Record<string, unknown> {
    const data: unknown = JSON.parse(raw.toString());
    if (!data || typeof data !== 'object') throw new Error('Invalid message');
    return data as Record<string, unknown>;
}

export function attachWebSocketServer(server: HttpServer, deps: WsDeps): WebSocketServer {
    const wss = new WebSocketServer({
        server,
        verifyClient: ({ req }: { req: { headers: import('node:http').IncomingHttpHeaders } }) => isTrustedRequest(req.headers)
    });
    const clients = new Set<Client>();
    let nextId = Date.now();

    function startStreaming(client: Client, data: Record<string, unknown>): void {
        const { platform, deviceId, fps } = data;
        if (!platform || !deviceId) {
            send(client, { type: 'error', message: 'Platform and deviceId required' });
            return;
        }
        if ((platform !== 'android' && platform !== 'ios') || !isValidDeviceId(deviceId)) {
            send(client, { type: 'error', message: 'Invalid platform or deviceId' });
            return;
        }
        client.deviceId = deviceId;
        try {
            const streamFps = deps.mirror.startStreaming(
                platform,
                deviceId,
                (update) => send(client, { ...update, deviceId }),
                normalizeScreenFps(fps, deps.defaultFps)
            );
            send(client, { type: 'streaming-started', fps: streamFps, deviceId });
        } catch (error) {
            send(client, { type: 'error', message: `Failed to start streaming: ${errorMessage(error)}` });
        }
    }

    function stopStreaming(client: Client): void {
        if (client.deviceId) deps.mirror.stopStreamingForDevice(client.deviceId);
        else deps.mirror.stopAll();
        send(client, { type: 'streaming-stopped' });
    }

    async function pageSourceWithRecovery(client: Client, deviceId: string): Promise<string> {
        try {
            return await deps.sessions.getPageSource(deviceId);
        } catch (firstError) {
            if (deps.sessions.isSessionActive(deviceId)) throw firstError;
            console.log(`Session dead for ${deviceId}, attempting auto-recovery...`);
            send(client, { type: 'info', message: 'Session lost — reconnecting automatically...' });
            const result = await deps.sessions.recreateSession(deviceId);
            if (!result.success) throw new Error(`Auto-recovery failed: ${result.error}`);
            console.log(`Session recovered for ${deviceId}, retrying page source...`);
            return deps.sessions.getPageSource(deviceId);
        }
    }

    async function sendPageSource(client: Client): Promise<void> {
        try {
            const deviceId = client.deviceId;
            if (!deviceId) throw new Error('No deviceId associated with this connection. Start streaming first.');
            const source = await pageSourceWithRecovery(client, deviceId);
            send(client, { type: 'page-source', data: source, deviceId });
        } catch (error) {
            send(client, { type: 'error', message: `Failed to get page source: ${errorMessage(error)}` });
        }
    }

    function handleMessage(client: Client, raw: RawData): void {
        let data: Record<string, unknown>;
        try {
            data = parseMessage(raw);
        } catch (error) {
            send(client, { type: 'error', message: errorMessage(error) });
            return;
        }
        switch (data.type) {
            case 'start-streaming': return startStreaming(client, data);
            case 'stop-streaming': return stopStreaming(client);
            case 'get-page-source': return void sendPageSource(client);
            default: return send(client, { type: 'error', message: 'Unknown message type' });
        }
    }

    wss.on('connection', (ws) => {
        const client: Client = { id: nextId++, ws, alive: true, deviceId: null };
        clients.add(client);
        console.log(`Client ${client.id} connected`);

        ws.on('pong', () => { client.alive = true; });
        ws.on('message', (raw) => handleMessage(client, raw));
        ws.on('error', (error) => console.error(`WebSocket error for client ${client.id}:`, error.message));
        ws.on('close', () => {
            console.log(`Client ${client.id} disconnected`);
            clients.delete(client);
            if (client.deviceId) deps.mirror.stopStreamingForDevice(client.deviceId);
        });

        send(client, { type: 'connected', message: 'Connected to Appium Locators Inspector backend', clientId: client.id });
    });

    const heartbeat = setInterval(() => {
        for (const client of clients) {
            if (!client.alive) {
                client.ws.terminate();
                clients.delete(client);
                continue;
            }
            client.alive = false;
            try {
                client.ws.ping();
            } catch (error) {
                console.error(`Ping failed for client ${client.id}:`, errorMessage(error));
                clients.delete(client);
            }
        }
    }, deps.heartbeatMs);
    wss.on('close', () => clearInterval(heartbeat));

    return wss;
}
