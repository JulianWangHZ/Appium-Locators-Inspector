/** Build dist/extension (Chrome) and dist/npm (the companion published to npm). */
import { build, type BuildOptions } from 'esbuild';
import { chmodSync, copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { DIST, DIST_EXTENSION, DIST_NPM, ROOT, SRC } from './paths.js';

const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    version: string;
    description: string;
    author?: string;
    license?: string;
    repository?: unknown;
    homepage?: string;
};

const EXTENSION_ENTRIES: Record<string, string> = {
    'background': 'background/index.ts',
    'popup/popup': 'popup/popup.ts',
    'options': 'options/options.ts',
    'logs': 'logs/logs.ts',
    'inspector/inspector': 'inspector/index.ts',
    'theme-init': 'theme-init.ts'
};

const common: BuildOptions = { bundle: true, sourcemap: false, legalComments: 'none', charset: 'ascii', logLevel: 'warning' };
const node: BuildOptions = { ...common, format: 'cjs', platform: 'node', target: 'node18' };

async function buildExtension(): Promise<void> {
    const extSrc = join(SRC, 'extension');
    // Static assets only (HTML, CSS, icons); TypeScript is bundled below.
    for (const entry of readdirSync(extSrc, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || entry.name.endsWith('.ts') || entry.name === '.DS_Store') continue;
        const from = join(entry.parentPath, entry.name);
        const to = join(DIST_EXTENSION, relative(extSrc, from));
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
    }
    await build({
        ...common,
        entryPoints: Object.fromEntries(Object.entries(EXTENSION_ENTRIES).map(([out, entry]) => [out, join(extSrc, entry)])),
        outdir: DIST_EXTENSION,
        format: 'iife',
        platform: 'browser',
        target: 'chrome110'
    });
}

/** Self-contained companion: every dependency is bundled, so npx needs no install step. */
async function buildNpmPackage(): Promise<void> {
    await Promise.all([
        build({ ...node, entryPoints: [join(SRC, 'cli', 'index.ts')], outfile: join(DIST_NPM, 'cli.js'), banner: { js: '#!/usr/bin/env node' } }),
        build({
            ...node,
            entryPoints: [join(SRC, 'backend', 'server.ts')],
            outfile: join(DIST_NPM, 'backend', 'server.js'),
            // Optional native speed-ups of `ws`; it falls back to JS without them.
            external: ['bufferutil', 'utf-8-validate']
        }),
        build({ ...node, entryPoints: [join(SRC, 'native-host', 'launcher.ts')], outfile: join(DIST_NPM, 'native-host', 'launcher.js'), banner: { js: '#!/usr/bin/env node' } })
    ]);
    chmodSync(join(DIST_NPM, 'cli.js'), 0o755);
    chmodSync(join(DIST_NPM, 'native-host', 'launcher.js'), 0o755);

    const meta = { version: rootPackage.version, author: rootPackage.author, license: rootPackage.license };
    writeFileSync(join(DIST_NPM, 'backend', 'package.json'), `${JSON.stringify({ name: 'appium-locators-inspector-backend', private: true, ...meta }, null, 2)}\n`);
    const pkg = {
        name: 'appium-locators-inspector',
        ...meta,
        description: 'Local companion for the Appium Locators Inspector Chrome extension: run `npx appium-locators-inspector`.',
        keywords: ['appium', 'inspector', 'locator', 'chrome-extension', 'mobile-testing'],
        repository: rootPackage.repository,
        homepage: rootPackage.homepage,
        bin: { 'appium-locators-inspector': 'cli.js' },
        files: ['cli.js', 'backend/', 'native-host/', 'README.md', 'LICENSE'],
        engines: { node: '>=18' }
    };
    writeFileSync(join(DIST_NPM, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    copyFileSync(join(SRC, 'cli', 'README.md'), join(DIST_NPM, 'README.md'));
    copyFileSync(join(ROOT, 'LICENSE'), join(DIST_NPM, 'LICENSE'));
}

async function main(): Promise<void> {
    rmSync(DIST, { recursive: true, force: true });
    await Promise.all([buildExtension(), buildNpmPackage()]);
    console.log(`Built ${relative(ROOT, DIST_EXTENSION)}/ and ${relative(ROOT, DIST_NPM)}/ (v${rootPackage.version})`);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
