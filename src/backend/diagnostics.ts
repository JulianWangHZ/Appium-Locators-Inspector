import type { DiagnosticCheck } from '../shared/protocol.js';
import { runShell } from './exec.js';

const firstLine = (s: string | null): string | null => (s ? (s.split('\n')[0] ?? '').trim() : null);
const macOnly = (isMac: boolean, command: string) => (isMac ? runShell(command) : Promise.resolve(null));

/** Appium-doctor-style environment report (versions, paths, status). */
export async function gatherDiagnostics(port: number, env: NodeJS.ProcessEnv = process.env): Promise<DiagnosticCheck[]> {
    const isMac = process.platform === 'darwin';
    const [appiumPath, appiumVer, drivers, javaPath, javaVer, adbPath, xcrunPath, xcodeSel, xcodeVer, sims] = await Promise.all([
        runShell('command -v appium'),
        runShell('appium --version'),
        runShell('appium driver list --installed 2>&1'),
        runShell('command -v java'),
        runShell('java -version 2>&1'),
        runShell('command -v adb'),
        macOnly(isMac, 'command -v xcrun'),
        macOnly(isMac, 'xcode-select -p'),
        macOnly(isMac, 'xcodebuild -version 2>/dev/null'),
        macOnly(isMac, 'xcrun simctl list devices available 2>/dev/null | grep -c -E "iPhone|iPad"')
    ]);

    const hasUia = !!drivers && /uiautomator2/.test(drivers);
    const hasXcui = !!drivers && /xcuitest/.test(drivers);
    const driverList = [hasUia && 'uiautomator2', hasXcui && 'xcuitest'].filter(Boolean).join(', ');

    const checks: DiagnosticCheck[] = [
        { name: 'Node.js', ok: true, detail: process.version },
        { name: 'Appium (test server)', ok: !!appiumPath, detail: appiumPath ? `on PATH (v${firstLine(appiumVer)})` : 'not found — npm i -g appium' },
        { name: 'Appium drivers', ok: hasUia || hasXcui, warn: !(hasUia && hasXcui), detail: driverList || 'none installed' },
        { name: 'Java (UiAutomator2 JDK)', ok: !!javaPath, warn: !javaPath, detail: javaPath ? firstLine(javaVer) ?? '' : 'not found' },
        { name: 'JAVA_HOME', ok: !!env.JAVA_HOME, warn: !env.JAVA_HOME, detail: env.JAVA_HOME || 'not set' },
        { name: 'adb (Android SDK)', ok: !!adbPath, warn: !adbPath, detail: adbPath ? 'on PATH' : 'not found' },
        { name: 'ANDROID_HOME', ok: !!env.ANDROID_HOME, warn: !env.ANDROID_HOME, detail: env.ANDROID_HOME || 'not set' }
    ];

    if (isMac) {
        const simCount = sims ? Number.parseInt(sims, 10) : 0;
        const hasSims = simCount > 0;
        checks.push(
            { name: 'xcrun (Xcode CLT)', ok: !!xcrunPath, warn: !xcrunPath, detail: xcrunPath ? 'on PATH' : 'not found' },
            { name: 'Xcode (XCUITest)', ok: !!xcodeSel, warn: !xcodeSel, detail: xcodeSel ? `${firstLine(xcodeVer) || 'installed'} (${xcodeSel})` : 'not found' },
            { name: 'iOS simulators', ok: hasSims, warn: !hasSims, detail: hasSims ? `${simCount} available` : 'none booted/available' }
        );
    }

    checks.push({ name: 'Backend server', ok: true, detail: `running on ${port}` });
    return checks;
}
