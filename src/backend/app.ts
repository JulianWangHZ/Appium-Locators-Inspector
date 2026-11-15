import { createServer, type Server } from 'node:http';
import express from 'express';
import type { AppiumSessions } from './appium-client.js';
import { createRoutes } from './http-routes.js';
import { isAllowedOrigin, isLoopbackHost } from './request-guard.js';
import type { ScreenMirror } from './screen-mirror.js';
import { attachWebSocketServer } from './ws-server.js';

export interface AppDeps {
    sessions: AppiumSessions;
    mirror: ScreenMirror;
    port: number;
    defaultFps: number;
    heartbeatMs: number;
}

/** Express app + WebSocket server on one HTTP server (not yet listening). */
export function createBackendServer(deps: AppDeps): Server {
    const app = express();
    app.disable('x-powered-by');

    app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (!isLoopbackHost(req.headers.host) || !isAllowedOrigin(origin)) {
            res.status(403).json({ success: false, error: 'Forbidden origin' });
            return;
        }
        if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        }
        if (req.method === 'OPTIONS') {
            res.sendStatus(204);
            return;
        }
        next();
    });
    app.use(express.json({ limit: '1mb' }));
    app.use(createRoutes(deps));

    const server = createServer(app);
    attachWebSocketServer(server, deps);
    return server;
}
