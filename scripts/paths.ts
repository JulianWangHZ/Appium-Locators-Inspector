import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = join(ROOT, 'src');
export const DIST = join(ROOT, 'dist');
export const DIST_EXTENSION = join(DIST, 'extension');
/** The companion, published to npm as `appium-locators-inspector`. */
export const DIST_NPM = join(DIST, 'npm');
