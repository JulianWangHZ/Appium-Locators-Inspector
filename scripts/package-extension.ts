/** Zip dist/extension for the Chrome Web Store. Run `npm run build` first. */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DIST_EXTENSION, ROOT } from './paths.js';

const output = join(ROOT, 'appium-locators-inspector-extension.zip');
if (!existsSync(join(DIST_EXTENSION, 'manifest.json'))) {
    console.error('dist/extension is missing. Run `npm run build` first.');
    process.exit(1);
}
rmSync(output, { force: true });
execFileSync('zip', ['-qrX', output, '.', '-x', '*.DS_Store', '-x', '__MACOSX/*'], { cwd: DIST_EXTENSION, stdio: 'inherit' });
console.log(`Created ${output}`);
