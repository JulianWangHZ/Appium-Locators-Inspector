/** Compile the extension, backend and native host into dist/, then package the companion. */
import { build, type BuildOptions } from 'esbuild';
import { chmodSync, copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildCompanionRelease } from './build-companion-release.js';
import { DIST, DIST_BACKEND, DIST_EXTENSION, DIST_NATIVE_HOST, ROOT, SRC } from './paths.js';

const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    version: string;
    dependencies: Record<string, string>;
    author?: string;
    license?: string;
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

async function buildExtension(): Promise<void> {
    const extSrc = join(SRC, 'extension');
    cpSync(extSrc, DIST_EXTENSION, { recursive: true, filter: (src) => !src.endsWith('.ts') && !src.endsWith('.DS_Store') });
    await build({
        ...common,
        entryPoints: Object.fromEntries(Object.entries(EXTENSION_ENTRIES).map(([out, entry]) => [out, join(extSrc, entry)])),
        outdir: DIST_EXTENSION,
        format: 'iife',
        platform: 'browser',
        target: 'chrome110'
    });
}

async function buildBackend(): Promise<void> {
    await build({
        ...common,
        entryPoints: [join(SRC, 'backend', 'server.ts')],
        outfile: join(DIST_BACKEND, 'server.js'),
        format: 'cjs',
        platform: 'node',
        target: 'node18',
        packages: 'external'
    });
    const pkg = {
        name: 'appium-locators-inspector-backend',
        version: rootPackage.version,
        private: true,
        description: 'Backend service for Appium Locators Inspector Chrome Extension',
        main: 'server.js',
        scripts: { start: 'node server.js' },
        engines: { node: '>=18' },
        author: rootPackage.author,
        license: rootPackage.license,
        dependencies: rootPackage.dependencies
    };
    writeFileSync(join(DIST_BACKEND, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
}

async function buildNativeHost(): Promise<void> {
    const launcher = join(DIST_NATIVE_HOST, 'launcher.js');
    await build({
        ...common,
        entryPoints: [join(SRC, 'native-host', 'launcher.ts')],
        outfile: launcher,
        format: 'cjs',
        platform: 'node',
        target: 'node18',
        banner: { js: '#!/usr/bin/env node' }
    });
    chmodSync(launcher, 0o755);
    copyFileSync(join(SRC, 'native-host', 'host.sh'), join(DIST_NATIVE_HOST, 'host.sh'));
    chmodSync(join(DIST_NATIVE_HOST, 'host.sh'), 0o755);
    // The options page embeds this launcher into the downloadable installer.
    mkdirSync(join(DIST_EXTENSION, 'installers'), { recursive: true });
    copyFileSync(launcher, join(DIST_EXTENSION, 'installers', 'launcher.js'));
}

async function main(): Promise<void> {
    rmSync(DIST, { recursive: true, force: true });
    await buildExtension();
    await Promise.all([buildBackend(), buildNativeHost()]);
    const release = buildCompanionRelease(rootPackage.version);
    console.log(`Built ${relative(ROOT, DIST)}/ (extension, backend, native-host)`);
    console.log(`Companion ${release.filename} sha256 ${release.sha256}`);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
