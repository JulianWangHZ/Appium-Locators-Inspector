import { DEFAULT_APPIUM_PORT, DEFAULT_BACKEND_PORT } from '../shared/defaults.js';
import { DEFAULT_SCREEN_FPS, normalizeScreenFps } from '../shared/fps.js';
import { parsePort } from '../shared/validation.js';

export const SERVER_PORT = parsePort(process.env.PORT, DEFAULT_BACKEND_PORT);
/** Loopback only: the backend drives real devices and must not be reachable from the LAN. */
export const SERVER_HOST = '127.0.0.1';
export const APPIUM_HOST = process.env.APPIUM_HOST || 'localhost';
export const APPIUM_PORT = parsePort(process.env.APPIUM_PORT, DEFAULT_APPIUM_PORT);
export const APPIUM_URL = `http://${APPIUM_HOST}:${APPIUM_PORT}`;
export const SCREEN_CAPTURE_FPS = normalizeScreenFps(process.env.SCREEN_FPS, DEFAULT_SCREEN_FPS);
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;
