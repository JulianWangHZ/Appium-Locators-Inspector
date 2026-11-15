import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = join(ROOT, 'src');
export const DIST = join(ROOT, 'dist');
export const DIST_EXTENSION = join(DIST, 'extension');
export const DIST_BACKEND = join(DIST, 'backend');
export const DIST_NATIVE_HOST = join(DIST, 'native-host');
