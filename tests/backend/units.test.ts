import { describe, expect, it } from 'vitest';
import { isDeadSessionError } from '../../src/backend/appium-client.js';
import { buildCapabilities } from '../../src/backend/capabilities.js';
import { extractIOSVersion, parseAdbDevices, parseBootedSimulators } from '../../src/backend/device-manager.js';
import { keyActions, mobileGestureCommand, toW3CLocator } from '../../src/backend/gestures.js';
import { isAllowedOrigin, isLoopbackHost } from '../../src/backend/request-guard.js';
import { normalizeScreenFps } from '../../src/shared/fps.js';
import { isValidDeviceId, parsePort } from '../../src/shared/validation.js';

describe('shared validation', () => {
    it.each([
        ['emulator-5554', true], ['192.168.0.2:5555', true], ['4BD3330C-1544-46F5-ACC5-8A96A59297DD', true],
        ['a;rm -rf /', false], ['$(id)', false], ['', false], [42, false]
    ])('isValidDeviceId(%j) = %s', (id, ok) => expect(isValidDeviceId(id)).toBe(ok));

    it('parses ports and falls back on garbage', () => {
        expect(parsePort('8765', 1)).toBe(8765);
        expect(parsePort('1; kill', 1)).toBe(1);
        expect(parsePort(70000, 1)).toBe(1);
    });

    it.each([[undefined, 3], ['', 3], ['12.6', 13], [0, 1], [99, 30], ['abc', 3]])('normalizeScreenFps(%j) = %d', (v, want) => {
        expect(normalizeScreenFps(v)).toBe(want);
    });
});

describe('request guard', () => {
    it('allows extension pages and local tools, blocks web pages', () => {
        expect(isAllowedOrigin(undefined)).toBe(true);
        expect(isAllowedOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).toBe(true);
        expect(isAllowedOrigin('https://evil.example')).toBe(false);
        expect(isAllowedOrigin('null')).toBe(false);
    });
    it('accepts loopback hosts only', () => {
        expect(isLoopbackHost('localhost:8765')).toBe(true);
        expect(isLoopbackHost('127.0.0.1:8765')).toBe(true);
        expect(isLoopbackHost('[::1]:8765')).toBe(true);
        expect(isLoopbackHost('attacker.example:8765')).toBe(false);
        expect(isLoopbackHost(undefined)).toBe(false);
    });
});

describe('device parsing', () => {
    it('parses adb devices output', () => {
        const out = 'List of devices attached\nemulator-5554          device product:sdk model:Pixel\nZY22 unauthorized\n\n';
        expect(parseAdbDevices(out)).toEqual(['emulator-5554']);
    });
    it('parses booted simulators', () => {
        const json = JSON.stringify({ devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-17-5': [{ udid: 'AAA-1', name: 'iPhone 15', state: 'Booted' }, { udid: 'BBB', name: 'x', state: 'Shutdown' }]
        } });
        expect(parseBootedSimulators(json)).toEqual([{ id: 'AAA-1', platform: 'ios', name: 'iPhone 15', version: '17.5', status: 'connected' }]);
        expect(extractIOSVersion('iOS 17.5')).toBe('17.5');
    });
});

describe('capabilities', () => {
    it('does not sign WDA when no Team ID is configured', () => {
        const caps = buildCapabilities({ id: 'U1', platform: 'ios', name: 'iPhone', version: '17.5' }, '');
        expect(caps['appium:xcodeOrgId']).toBeUndefined();
        expect(caps['appium:platformVersion']).toBe('17.5');
        expect(caps['appium:autoLaunch']).toBe(false);
    });
    it('signs WDA with the configured Team ID', () => {
        const caps = buildCapabilities({ id: 'U1', platform: 'ios', name: 'iPhone', version: '' }, 'TEAM123');
        expect(caps['appium:updatedWDABundleId']).toBe('com.TEAM123.WebDriverAgentRunner');
        expect(caps['appium:platformVersion']).toBe('17.5');
    });
    it('builds android capabilities', () => {
        const caps = buildCapabilities({ id: 'emu', platform: 'android', name: 'Pixel', version: '14', appPackage: 'com.x' });
        expect(caps).toMatchObject({ platformName: 'Android', 'appium:automationName': 'UiAutomator2', 'appium:appPackage': 'com.x', 'appium:appActivity': '' });
    });
});

describe('gestures', () => {
    it('maps gestures per platform', () => {
        expect(mobileGestureCommand('ios', 'longPress', { x: 1, y: 2 })).toEqual({ script: 'mobile: touchAndHold', params: { x: 1, y: 2, duration: 1.0 } });
        expect(mobileGestureCommand('android', 'swipe', { rect: { left: 0, top: 0, width: 10, height: 20 }, direction: 'up' }))
            .toEqual({ script: 'mobile: swipeGesture', params: { left: 0, top: 0, width: 10, height: 20, direction: 'up', percent: 0.75 } });
    });
    it('maps resource-id to a UiSelector like the old WebdriverIO selector', () => {
        expect(toW3CLocator('id', 'com.x:id/a"b')).toEqual({ using: '-android uiautomator', value: 'new UiSelector().resourceId("com.x:id/a\\"b")' });
    });
    it('builds key actions including the W3C backspace', () => {
        expect(keyActions('')[0]?.actions).toEqual([{ type: 'keyDown', value: '' }, { type: 'keyUp', value: '' }]);
    });
    it('detects dead sessions', () => {
        expect(isDeadSessionError(new Error('invalid session id: x'))).toBe(true);
        expect(isDeadSessionError(new Error('no such element'))).toBe(false);
    });
});
