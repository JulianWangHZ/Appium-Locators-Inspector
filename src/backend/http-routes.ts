import express, { type Request, type Response, type Router } from 'express';
import type { DeviceInfo, GestureName, LocatorStrategy, SwipeDirection } from '../shared/protocol.js';
import { isFiniteNumber, isValidDeviceId } from '../shared/validation.js';
import type { AppiumSessions } from './appium-client.js';
import * as devices from './device-manager.js';
import { gatherDiagnostics } from './diagnostics.js';
import { errorMessage } from './exec.js';
import { GESTURE_NAMES, LOCATOR_STRATEGIES, SWIPE_DIRECTIONS } from './gestures.js';
import type { ScreenMirror } from './screen-mirror.js';

export interface RouteDeps {
    sessions: AppiumSessions;
    mirror: ScreenMirror;
    port: number;
}

type Handler = (req: Request, res: Response) => Promise<unknown>;

class BadRequest extends Error {}

function route(handler: Handler) {
    return async (req: Request, res: Response) => {
        try {
            await handler(req, res);
        } catch (error) {
            const status = error instanceof BadRequest ? 400 : 500;
            res.status(status).json({ success: false, error: errorMessage(error) });
        }
    };
}

function requireDeviceId(value: unknown, missingMessage: string): string {
    if (value == null || value === '') throw new BadRequest(missingMessage);
    if (!isValidDeviceId(value)) throw new BadRequest('Invalid deviceId');
    return value;
}

function requireCoordinate(value: unknown, name: string): number {
    if (!isFiniteNumber(value)) throw new BadRequest(`${name} must be a number`);
    return value;
}

function optionalNumber(value: unknown, name: string): number | undefined {
    if (value == null) return undefined;
    return requireCoordinate(value, name);
}

export function parseDeviceInfo(value: unknown): DeviceInfo {
    if (!value || typeof value !== 'object') throw new BadRequest('Device info required');
    const info = value as Partial<DeviceInfo>;
    if (!isValidDeviceId(info.id) || (info.platform !== 'android' && info.platform !== 'ios')) {
        throw new BadRequest('Invalid device info: id and platform are required');
    }
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    return {
        id: info.id,
        platform: info.platform,
        name: str(info.name) ?? info.id,
        version: str(info.version) ?? '',
        appPackage: str(info.appPackage),
        appActivity: str(info.appActivity),
        bundleId: str(info.bundleId),
        teamId: str(info.teamId),
        platformVersion: str(info.platformVersion)
    };
}

export function createRoutes({ sessions, mirror, port }: RouteDeps): Router {
    const router = express.Router();

    router.get('/health', route(async (_req, res) => {
        const [adbAvailable, iosToolsAvailable] = await Promise.all([devices.isAdbAvailable(), devices.isIOSToolsAvailable()]);
        res.json({ status: 'ok', timestamp: new Date().toISOString(), adbAvailable, iosToolsAvailable });
    }));

    router.get('/api/devices', route(async (_req, res) => {
        res.json({ success: true, devices: await devices.listAllDevices() });
    }));

    router.get('/api/devices/:platform', route(async (req, res) => {
        const { platform } = req.params;
        if (platform === 'android') return res.json({ success: true, devices: await devices.listAndroidDevices() });
        if (platform === 'ios') return res.json({ success: true, devices: await devices.listIOSSimulators() });
        throw new BadRequest('Invalid platform');
    }));

    router.post('/api/session/create', route(async (req, res) => {
        res.json(await sessions.createSession(parseDeviceInfo(req.body?.deviceInfo)));
    }));

    router.post('/api/session/close', route(async (req, res) => {
        const raw = req.body?.deviceId;
        if (raw == null || raw === '') {
            await sessions.closeAllSessions();
            mirror.stopAll();
            return res.json({ success: true, deviceId: 'all' });
        }
        const deviceId = requireDeviceId(raw, 'deviceId required');
        await sessions.closeSession(deviceId);
        mirror.stopStreamingForDevice(deviceId);
        res.json({ success: true, deviceId });
    }));

    router.get('/api/page-source', route(async (req, res) => {
        const deviceId = requireDeviceId(req.query.deviceId, 'deviceId query parameter required');
        res.json({ success: true, source: await sessions.getPageSource(deviceId), deviceId });
    }));

    router.get('/api/screenshot', route(async (req, res) => {
        const deviceId = requireDeviceId(req.query.deviceId, 'deviceId query parameter required');
        res.json({ success: true, screenshot: await sessions.getScreenshot(deviceId), deviceId });
    }));

    router.post('/api/tap', route(async (req, res) => {
        const deviceId = requireDeviceId(req.body?.deviceId, 'deviceId required in request body');
        await sessions.tap(deviceId, requireCoordinate(req.body.x, 'x'), requireCoordinate(req.body.y, 'y'));
        res.json({ success: true, deviceId });
    }));

    router.post('/api/type', route(async (req, res) => {
        const { strategy, value, text } = req.body ?? {};
        const deviceId = requireDeviceId(req.body?.deviceId, 'deviceId required in request body');
        if (typeof text !== 'string' || text.length === 0) throw new BadRequest('text required in request body');
        // Prefer element-scoped setValue when a locator is given; else type into the focused element.
        if (strategy && value != null) {
            if (!LOCATOR_STRATEGIES.includes(strategy)) throw new BadRequest('Unsupported locator strategy');
            await sessions.setElementText(deviceId, strategy as LocatorStrategy, String(value), text);
        } else {
            await sessions.sendKeys(deviceId, text);
        }
        res.json({ success: true, deviceId });
    }));

    router.post('/api/gesture', route(async (req, res) => {
        const body = req.body ?? {};
        if (!body.deviceId || !body.gesture) throw new BadRequest('deviceId and gesture required');
        const deviceId = requireDeviceId(body.deviceId, 'deviceId and gesture required');
        if (!GESTURE_NAMES.includes(body.gesture)) throw new BadRequest(`Unsupported gesture: ${body.gesture}`);
        if (body.direction != null && !SWIPE_DIRECTIONS.includes(body.direction)) throw new BadRequest('Invalid swipe direction');

        const left = optionalNumber(body.left, 'left');
        const width = optionalNumber(body.width, 'width');
        const rect = left != null && width != null
            ? { left, top: optionalNumber(body.top, 'top') ?? 0, width, height: optionalNumber(body.height, 'height') ?? 0 }
            : undefined;
        await sessions.gesture(deviceId, body.platform === 'ios' ? 'ios' : 'android', body.gesture as GestureName, {
            x: optionalNumber(body.x, 'x'),
            y: optionalNumber(body.y, 'y'),
            rect,
            direction: body.direction as SwipeDirection | undefined
        });
        res.json({ success: true, deviceId });
    }));

    router.get('/api/diagnostics', route(async (_req, res) => {
        res.json({ success: true, checks: await gatherDiagnostics(port) });
    }));

    return router;
}
