import type { DeviceInfo } from '../shared/protocol.js';

const FALLBACK_IOS_PLATFORM_VERSION = '17.5';

/** Appium capabilities for the selected device (attach to whatever app is running). */
export function buildCapabilities(device: DeviceInfo, appleTeamId = process.env.APPLE_TEAM_ID): Record<string, unknown> {
    const isAndroid = device.platform === 'android';
    const base: Record<string, unknown> = {
        platformName: isAndroid ? 'Android' : 'iOS',
        'appium:deviceName': device.name,
        'appium:udid': device.id,
        'appium:automationName': isAndroid ? 'UiAutomator2' : 'XCUITest',
        'appium:noReset': true,
        'appium:autoGrantPermissions': true
    };
    return isAndroid ? { ...base, ...androidCapabilities(device) } : { ...base, ...iosCapabilities(device, appleTeamId) };
}

function androidCapabilities(device: DeviceInfo): Record<string, unknown> {
    if (!device.appPackage) return {};
    return {
        'appium:appPackage': device.appPackage,
        'appium:appActivity': device.appActivity || ''
    };
}

function iosCapabilities(device: DeviceInfo, appleTeamId: string | undefined): Record<string, unknown> {
    const teamId = appleTeamId || device.teamId;
    const caps: Record<string, unknown> = {
        'appium:autoLaunch': false,
        'appium:showXcodeLog': true
    };

    if (teamId) {
        caps['appium:xcodeOrgId'] = teamId;
        caps['appium:xcodeSigningId'] = 'Apple Development';
        caps['appium:updatedWDABundleId'] = `com.${teamId}.WebDriverAgentRunner`;
        console.log(`Using Apple Team ID ${teamId} for WebDriverAgent signing`);
    } else {
        console.warn('No Apple Team ID set. Simulators work; real-device WebDriverAgent signing may fail.');
        console.warn('Set the APPLE_TEAM_ID environment variable to sign for a real device.');
    }

    // Don't let Appium derive the iOS deployment target from the macOS version.
    if (device.version) {
        caps['appium:platformVersion'] = device.version;
    } else if (!device.platformVersion) {
        caps['appium:platformVersion'] = FALLBACK_IOS_PLATFORM_VERSION;
        console.log(`Setting fallback platformVersion to ${FALLBACK_IOS_PLATFORM_VERSION}`);
    }

    if (device.bundleId) {
        caps['appium:bundleId'] = device.bundleId;
        caps['appium:autoLaunch'] = true;
    }
    return caps;
}
