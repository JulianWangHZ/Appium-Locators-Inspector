import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const LEGACY_DIR = join(import.meta.dirname, 'legacy');

/** Evaluate a legacy browser script with a fake `window`; return what it assigned. */
export function loadLegacyGlobals(file: string): Record<string, any> {
    const window: Record<string, any> = {};
    const context = vm.createContext({ window, module: undefined, console });
    vm.runInContext(readFileSync(join(LEGACY_DIR, file), 'utf8'), context);
    return window;
}

export function fixture(name: string): string {
    return readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
}
