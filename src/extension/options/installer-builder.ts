/** Builds the self-contained setup installer the user downloads from the options page. Pure. */

export interface CompanionRelease {
    version: string;
    filename: string;
    url: string;
    extensionPath?: string;
    sha256: string;
}

export type InstallerKind = 'sh' | 'bat';

export function installerKindOf(filename: string): InstallerKind {
    return filename.endsWith('.bat') ? 'bat' : 'sh';
}

export function applyInstallerTemplate(content: string, extensionId: string, release: CompanionRelease, companionEmbedded: boolean): string {
    const embeddedFlag = companionEmbedded ? '1' : '0';
    return content
        .replace(/set "EXTENSION_ID=[^"]*"/, `set "EXTENSION_ID=${extensionId}"`)
        .replace(/^EXTENSION_ID="[^"]*"/m, `EXTENSION_ID="${extensionId}"`)
        .replace(/set "COMPANION_EMBEDDED=[^"]*"/, `set "COMPANION_EMBEDDED=${embeddedFlag}"`)
        .replace(/^COMPANION_EMBEDDED="[^"]*"/m, `COMPANION_EMBEDDED="${embeddedFlag}"`)
        .replaceAll('__EXTENSION_ID__', extensionId)
        .replaceAll('__COMPANION_VERSION__', release.version)
        .replaceAll('__COMPANION_URL__', release.url)
        .replaceAll('__COMPANION_SHA256__', release.sha256);
}

export function splitBase64(value: string, width = 76): string[] {
    return value.match(new RegExp(`.{1,${width}}`, 'g')) || [];
}

export function bytesToBase64(bytes: Uint8Array): string {
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

export function textToBase64(text: string): string {
    return bytesToBase64(new TextEncoder().encode(text));
}

export function embedCompanionForShell(content: string, companionB64: string): string {
    const embed = [
        'write_embedded_companion() {',
        '    local DEST="$1"',
        '    local B64_PATH="$DEST.b64"',
        "    cat > \"$B64_PATH\" << 'COMPANION_ZIP_B64_EOF'",
        ...splitBase64(companionB64),
        'COMPANION_ZIP_B64_EOF',
        '    if base64 --decode < "$B64_PATH" > "$DEST" 2>/dev/null; then',
        '        rm -f "$B64_PATH"',
        '        return 0',
        '    fi',
        '    if base64 -D < "$B64_PATH" > "$DEST" 2>/dev/null; then',
        '        rm -f "$B64_PATH"',
        '        return 0',
        '    fi',
        '    rm -f "$B64_PATH"',
        '    echo "  ERROR: Could not decode bundled companion archive."',
        '    exit 1',
        '}'
    ].join('\n');
    return content.replace(/write_embedded_companion\(\) \{[\s\S]*?\n\}\n\n# __EMBEDDED_COMPANION_ZIP__/, () => `${embed}\n`);
}

export function embedCompanionForBatch(content: string, companionB64: string): string {
    return content.replace(':: __EMBEDDED_COMPANION_ZIP__', () => splitBase64(companionB64).map((line) => `echo.${line}`).join('\r\n'));
}

export function embedLauncherForShell(content: string, launcherJs: string): string {
    const body = launcherJs.endsWith('\n') ? launcherJs : `${launcherJs}\n`;
    const embed = `cat > "$NATIVE_HOST_DIR/launcher.js" << 'LAUNCHER_EMBEDDED_EOF'\n${body}LAUNCHER_EMBEDDED_EOF\n`
        + 'chmod +x "$NATIVE_HOST_DIR/launcher.js"\n'
        + 'echo "  OK Embedded launcher.js"';
    return content.replace('# __EMBEDDED_LAUNCHER_JS__', () => embed);
}

export function embedLauncherForBatch(content: string, launcherJs: string): string {
    const lines = splitBase64(textToBase64(launcherJs));
    let embed = '> "%TEMP%\\ll_launcher_b64.txt" (\r\n';
    for (const line of lines) embed += `echo.${line}\r\n`;
    embed += ')\r\n';
    embed += 'node -e "var fs=require(\'fs\');var b=fs.readFileSync(process.env.TEMP+\'/ll_launcher_b64.txt\',\'utf8\').replace(/\\s/g,\'\');fs.writeFileSync(process.argv[1],Buffer.from(b,\'base64\'))" "%NATIVE_HOST_DIR%\\launcher.js"\r\n';
    embed += 'del "%TEMP%\\ll_launcher_b64.txt" >nul 2>&1\r\n';
    embed += 'echo   OK Embedded launcher.js';
    return content.replace(':: __EMBEDDED_LAUNCHER_JS__', () => embed);
}

export interface InstallerInputs {
    filename: string;
    template: string;
    launcherJs: string;
    companionB64: string;
    release: CompanionRelease;
    extensionId: string;
}

/** One self-contained installer: template values, launcher.js and the companion zip embedded. */
export function buildInstaller({ filename, template, launcherJs, companionB64, release, extensionId }: InstallerInputs): string {
    const content = applyInstallerTemplate(template, extensionId, release, true);
    if (installerKindOf(filename) === 'bat') {
        const withLauncher = embedLauncherForBatch(content, launcherJs);
        return embedCompanionForBatch(withLauncher, companionB64).replace(/\r?\n/g, '\r\n');
    }
    return embedCompanionForShell(embedLauncherForShell(content, launcherJs), companionB64);
}
