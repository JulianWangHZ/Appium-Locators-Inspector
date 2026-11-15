const DEFAULT_FPS_LIMIT = 3;
const MIN_FPS_LIMIT = 1;
const MAX_FPS_LIMIT = 30;
const DEFAULT_THEME = 'light';

function normalizeFpsLimit(value, fallback = DEFAULT_FPS_LIMIT) {
    const parsed = value === '' || value == null ? NaN : Number(value);
    if (Number.isFinite(parsed)) {
        return Math.min(MAX_FPS_LIMIT, Math.max(MIN_FPS_LIMIT, Math.round(parsed)));
    }

    const parsedFallback = fallback === '' || fallback == null ? NaN : Number(fallback);
    return Number.isFinite(parsedFallback)
        ? Math.min(MAX_FPS_LIMIT, Math.max(MIN_FPS_LIMIT, Math.round(parsedFallback)))
        : DEFAULT_FPS_LIMIT;
}

document.addEventListener('DOMContentLoaded', () => {
    
    loadSettings();
    loadTheme();
    setupRailNav();
    setupTabs();
    setupThemeToggle();
    document.getElementById('save-btn').addEventListener('click', saveSettings);
    document.getElementById('download-mac')?.addEventListener('click', () => downloadInstaller('install_host.sh', 'install_appium_locators_inspector.sh'));
    document.getElementById('download-windows')?.addEventListener('click', () => downloadInstaller('install_host.bat', 'install_appium_locators_inspector.bat'));
    document.getElementById('check-backend-btn')?.addEventListener('click', checkBackendStatus);
    chrome.storage.onChanged.addListener(handleStorageChange);
});

function normalizeTheme(theme) {
    return theme === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
    const normalizedTheme = normalizeTheme(theme);
    // Drive the shared dark tokens (tokens.css uses [data-theme="dark"])
    if (normalizedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    document.body.classList.toggle('dark-theme', normalizedTheme === 'dark');
    document.body.classList.toggle('light-theme', normalizedTheme === 'light');

    document.querySelectorAll('.theme-option').forEach(btn => {
        const isActive = btn.dataset.theme === normalizedTheme;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function loadTheme() {
    // Shared with the popup (chrome.storage.sync + localStorage fast-path)
    chrome.storage.sync.get({ theme: DEFAULT_THEME }, (items) => {
        applyTheme(items.theme);
    });
}

function setupThemeToggle() {
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = normalizeTheme(btn.dataset.theme);
            applyTheme(theme);
            chrome.storage.sync.set({ theme });
            try { localStorage.setItem('ali-theme', theme); } catch (e) { /* ignore */ }
            
        });
    });
}

function handleStorageChange(changes, areaName) {
    if (areaName === 'sync' && changes.theme) {
        applyTheme(changes.theme.newValue);
    }
}

function setupRailNav() {
    const items = document.querySelectorAll('.rail-item');
    const panes = document.querySelectorAll('.settings-pane');
    items.forEach(item => {
        item.addEventListener('click', () => {
            const pane = item.dataset.pane;
            items.forEach(i => i.classList.toggle('active', i === item));
            panes.forEach(p => p.classList.toggle('active', p.id === `pane-${pane}`));
        });
    });
}

function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${tab}`)?.classList.add('active');
            
        });
    });

    // Auto-detect platform to show relevant tab
    const isWindows = navigator.userAgentData?.platform === 'Windows' ||
        navigator.platform?.includes('Win');
    if (isWindows) {
        document.querySelector('[data-tab="windows"]')?.click();
    }
}

async function loadCompanionRelease() {
    const response = await fetch(chrome.runtime.getURL('installers/companion-release.json'));
    if (!response.ok) {
        throw new Error('Companion release metadata missing');
    }
    return response.json();
}

function applyInstallerTemplate(content, extensionId, release, companionEmbedded) {
    return content
        .replace(/set "EXTENSION_ID=[^"]*"/, `set "EXTENSION_ID=${extensionId}"`)
        .replace(/^EXTENSION_ID="[^"]*"/m, `EXTENSION_ID="${extensionId}"`)
        .replace(/set "COMPANION_EMBEDDED=[^"]*"/, `set "COMPANION_EMBEDDED=${companionEmbedded ? '1' : '0'}"`)
        .replace(/^COMPANION_EMBEDDED="[^"]*"/m, `COMPANION_EMBEDDED="${companionEmbedded ? '1' : '0'}"`)
        .replaceAll('__EXTENSION_ID__', extensionId)
        .replaceAll('__COMPANION_VERSION__', release.version)
        .replaceAll('__COMPANION_URL__', release.url)
        .replaceAll('__COMPANION_SHA256__', release.sha256);
}

function splitBase64(value, width = 76) {
    return value.match(new RegExp(`.{1,${width}}`, 'g')) || [];
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

async function loadCompanionArchive(release) {
    const archivePath = release.extensionPath || `installers/${release.filename}`;
    const response = await fetch(chrome.runtime.getURL(archivePath));
    if (!response.ok) {
        throw new Error(`Bundled companion archive missing: ${archivePath}`);
    }
    return arrayBufferToBase64(await response.arrayBuffer());
}

function embedCompanionForShell(content, companionB64) {
    const lines = splitBase64(companionB64);
    let embed = `write_embedded_companion() {\n`;
    embed += `    local DEST="$1"\n`;
    embed += `    local B64_PATH="$DEST.b64"\n`;
    embed += `    cat > "$B64_PATH" << 'COMPANION_ZIP_B64_EOF'\n`;
    embed += `${lines.join('\n')}\n`;
    embed += `COMPANION_ZIP_B64_EOF\n`;
    embed += `    if base64 --decode < "$B64_PATH" > "$DEST" 2>/dev/null; then\n`;
    embed += `        rm -f "$B64_PATH"\n`;
    embed += `        return 0\n`;
    embed += `    fi\n`;
    embed += `    if base64 -D < "$B64_PATH" > "$DEST" 2>/dev/null; then\n`;
    embed += `        rm -f "$B64_PATH"\n`;
    embed += `        return 0\n`;
    embed += `    fi\n`;
    embed += `    rm -f "$B64_PATH"\n`;
    embed += `    echo "  ERROR: Could not decode bundled companion archive."\n`;
    embed += `    exit 1\n`;
    embed += `}`;
    return content.replace(/write_embedded_companion\(\) \{[\s\S]*?\n\}\n\n# __EMBEDDED_COMPANION_ZIP__/, `${embed}\n`);
}

function embedCompanionForBatch(content, companionB64) {
    return content.replace(
        ':: __EMBEDDED_COMPANION_ZIP__',
        splitBase64(companionB64).map(line => `echo.${line}`).join('\r\n')
    );
}

async function downloadInstaller(filename, downloadName = filename) {
    const status = document.getElementById('download-status');
    const extensionId = chrome.runtime.id;
    const platform = filename.endsWith('.bat') ? 'windows' : 'mac';

    

    try {
        const [installerResp, launcherResp, release] = await Promise.all([
            fetch(chrome.runtime.getURL(`installers/${filename}`)),
            fetch(chrome.runtime.getURL('installers/launcher.js')),
            loadCompanionRelease()
        ]);
        const companionB64 = await loadCompanionArchive(release);
        let content = await installerResp.text();
        const launcherJS = await launcherResp.text();

        content = applyInstallerTemplate(content, extensionId, release, true);

        // Embed launcher.js into the installer (base64, decoded by Node.js at install time).
        if (filename.endsWith('.bat')) {
            const lines = splitBase64(btoa(launcherJS));
            let embed = `> "%TEMP%\\ll_launcher_b64.txt" (\r\n`;
            for (const line of lines) embed += `echo.${line}\r\n`;
            embed += `)\r\n`;
            embed += `node -e "var fs=require('fs');var b=fs.readFileSync(process.env.TEMP+'/ll_launcher_b64.txt','utf8').replace(/\\s/g,'');fs.writeFileSync(process.argv[1],Buffer.from(b,'base64'))" "%NATIVE_HOST_DIR%\\launcher.js"\r\n`;
            embed += `del "%TEMP%\\ll_launcher_b64.txt" >nul 2>&1\r\n`;
            embed += `echo   OK Embedded launcher.js`;
            content = content.replace(':: __EMBEDDED_LAUNCHER_JS__', embed);
            content = embedCompanionForBatch(content, companionB64);
            content = content.replace(/\r?\n/g, '\r\n');
        } else if (filename.endsWith('.sh')) {
            // Keep launcher.js embedded as a fallback for local/dev installs.
            let embed = `cat > "$NATIVE_HOST_DIR/launcher.js" << 'LAUNCHER_EMBEDDED_EOF'\n`;
            embed += launcherJS;
            if (!launcherJS.endsWith('\n')) embed += '\n';
            embed += `LAUNCHER_EMBEDDED_EOF\n`;
            embed += `chmod +x "$NATIVE_HOST_DIR/launcher.js"\n`;
            embed += `echo "  OK Embedded launcher.js"`;
            content = content.replace('# __EMBEDDED_LAUNCHER_JS__', embed);
            content = embedCompanionForShell(content, companionB64);
        }

        // Download single self-contained installer
        const blob = new Blob([content], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = downloadName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);

        if (status) {
            status.textContent = `Downloaded ${downloadName} — run it to complete setup.`;
            setTimeout(() => { status.textContent = ''; }, 6000);
        }
        
    } catch (e) {
        if (status) status.textContent = 'Download failed. Try again.';
        
    }
}

async function checkBackendStatus() {
    const resultEl = document.getElementById('check-result');
    resultEl.innerHTML = '<div class="check-summary muted">Running preflight…</div>';
    

    const port = document.getElementById('backend-port').value || 8765;
    const checks = [];

    // Companion / native host (via native messaging)
    const setup = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'check-setup' }, (response) => {
            resolve(chrome.runtime.lastError
                ? { success: false, error: chrome.runtime.lastError.message }
                : (response || { success: false, error: 'No setup response' }));
        });
    });

    if (setup.success && setup.diagnostics) {
        const d = setup.diagnostics;
        const extId = chrome.runtime.id;
        checks.push({ name: 'Companion (native host)', ok: setup.nativeHost, detail: setup.nativeHost ? `connected · ${d.hostName || 'com.appium_locators_inspector.host'}` : 'not connected' });
        checks.push({ name: 'Install location', ok: !!d.installBase, detail: d.installBase || 'unknown' });
        checks.push({ name: 'Backend installed', ok: d.backendInstalled, detail: d.backendInstalled ? `${d.companionVersion ? 'v' + d.companionVersion + ' · ' : ''}${d.backendPath}` : 'missing — re-run installer' });
        checks.push({ name: 'Dependencies installed', ok: d.dependenciesInstalled, detail: d.dependenciesInstalled ? 'node_modules present' : 'run the installer' });
        checks.push({ name: 'Extension ID (allowed_origins)', ok: d.extensionAllowed, detail: `${extId}${d.extensionAllowed ? '' : ' — not allowed, re-run installer'}` });
    } else {
        checks.push({ name: 'Companion (native host)', ok: false, detail: setup.error || 'run the auto-setup installer, then reload' });
    }

    // Rich environment diagnostics from the backend
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        const resp = await fetch(`http://localhost:${port}/api/diagnostics`, { signal: controller.signal });
        clearTimeout(timeout);
        const data = await resp.json();
        if (data.success && Array.isArray(data.checks)) checks.push(...data.checks);
    } catch (e) {
        checks.push({ name: 'Backend server', ok: false, detail: 'not running — click "Start servers" in the popup first' });
    }

    const healthy = checks.every(c => c.ok || c.warn);
    const failCount = checks.filter(c => !c.ok && !c.warn).length;

    const summary = healthy
        ? '<div class="check-summary ok">All good — you\'re ready to inspect.</div>'
        : `<div class="check-summary bad">${failCount} item${failCount === 1 ? '' : 's'} need${failCount === 1 ? 's' : ''} attention.</div>`;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    const rows = checks.map(c => `
        <div class="status-item">
            <span class="dot ${c.ok ? 'ok' : c.warn ? 'warn' : 'err'}"></span>
            <div class="status-text">
                <div class="status-name">${esc(c.name)}</div>
                <div class="status-detail">${esc(c.detail)}</div>
            </div>
        </div>
    `).join('');

    resultEl.innerHTML = summary + rows;
}

function loadSettings() {
    chrome.storage.sync.get({ backendPort: 8765, appiumUrl: 'http://localhost:4723', fpsLimit: DEFAULT_FPS_LIMIT }, (items) => {
        document.getElementById('backend-port').value = items.backendPort;
        document.getElementById('appium-url').value = items.appiumUrl;
        document.getElementById('fps-limit').value = normalizeFpsLimit(items.fpsLimit);
    });
}

function saveSettings() {
    const backendPort = document.getElementById('backend-port').value;
    const appiumUrl = document.getElementById('appium-url').value;
    const fpsInput = document.getElementById('fps-limit');
    const fpsLimit = normalizeFpsLimit(fpsInput.value);
    fpsInput.value = fpsLimit;

    chrome.storage.sync.set({ backendPort, appiumUrl, fpsLimit }, () => {
        const btn = document.getElementById('save-btn');
        const orig = btn.textContent;
        btn.textContent = 'Saved!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
        
    });
}
