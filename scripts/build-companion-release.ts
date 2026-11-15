/** Zip dist/backend + dist/native-host into the companion archive bundled with the extension. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DIST, DIST_BACKEND, DIST_EXTENSION, DIST_NATIVE_HOST, ROOT } from './paths.js';

const BUNDLED_DOCS = ['README.md', 'PRIVACY.md', 'LICENSE'];

export interface CompanionRelease {
    version: string;
    filename: string;
    url: string;
    extensionPath: string;
    sha256: string;
}

function zipDirectory(sourceDir: string, zipPath: string): void {
    rmSync(zipPath, { force: true });
    if (process.platform === 'win32') {
        execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
            `Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${zipPath}' -Force`], { stdio: 'inherit' });
        return;
    }
    execFileSync('zip', ['-qrX', zipPath, '.'], { cwd: sourceDir, stdio: 'inherit' });
}

export function buildCompanionRelease(version: string): CompanionRelease {
    if (!existsSync(join(DIST_BACKEND, 'server.js')) || !existsSync(join(DIST_NATIVE_HOST, 'launcher.js'))) {
        throw new Error('Run the build first: dist/backend and dist/native-host are missing.');
    }
    const filename = `appium-locators-inspector-companion-v${version}.zip`;
    const staging = mkdtempSync(join(tmpdir(), 'ali-companion-'));
    const stagingRoot = join(staging, `appium-locators-inspector-companion-v${version}`);
    try {
        cpSync(DIST_BACKEND, join(stagingRoot, 'backend'), { recursive: true });
        cpSync(DIST_NATIVE_HOST, join(stagingRoot, 'native-host'), { recursive: true });
        for (const doc of BUNDLED_DOCS) {
            if (existsSync(join(ROOT, doc))) copyFileSync(join(ROOT, doc), join(stagingRoot, doc));
        }
        const outputPath = join(DIST, filename);
        zipDirectory(stagingRoot, outputPath);

        const sha256 = createHash('sha256').update(readFileSync(outputPath)).digest('hex');
        const installersDir = join(DIST_EXTENSION, 'installers');
        mkdirSync(installersDir, { recursive: true });
        copyFileSync(outputPath, join(installersDir, filename));

        const release: CompanionRelease = {
            version,
            filename,
            url: process.env.COMPANION_DOWNLOAD_URL || '',
            extensionPath: `installers/${filename}`,
            sha256
        };
        writeFileSync(join(installersDir, 'companion-release.json'), `${JSON.stringify(release, null, 4)}\n`);
        return release;
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }
}
