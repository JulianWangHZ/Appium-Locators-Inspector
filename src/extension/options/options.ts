import { sendToBackground, type SetupCheckResponse } from '../lib/messages.js';
import { requireById } from '../lib/html.js';
import { DEFAULT_SETTINGS, loadSettings, normalizeFpsLimit } from '../lib/settings.js';
import { loadTheme, normalizeTheme, saveTheme, setDocumentTheme, type Theme } from '../lib/theme.js';
import { backendChecks, companionChecks, renderChecks } from './environment-check.js';
import { buildInstaller, bytesToBase64, type CompanionRelease } from './installer-builder.js';

const DOWNLOAD_STATUS_MS = 6000;
const SAVED_FEEDBACK_MS = 1500;

document.addEventListener('DOMContentLoaded', () => {
    void fillSettingsForm();
    void loadTheme().then(applyTheme);
    setupRailNav();
    setupTabs();
    setupThemeToggle();
    requireById('save-btn').addEventListener('click', saveSettings);
    document.getElementById('download-mac')?.addEventListener('click', () => void downloadInstaller('install_host.sh', 'install_appium_locators_inspector.sh'));
    document.getElementById('download-windows')?.addEventListener('click', () => void downloadInstaller('install_host.bat', 'install_appium_locators_inspector.bat'));
    document.getElementById('check-backend-btn')?.addEventListener('click', () => void runEnvironmentCheck());
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync' && changes.theme) applyTheme(normalizeTheme(changes.theme.newValue));
    });
});

function applyTheme(theme: Theme): void {
    setDocumentTheme(theme);
    document.body.classList.toggle('dark-theme', theme === 'dark');
    document.body.classList.toggle('light-theme', theme === 'light');
    document.querySelectorAll<HTMLElement>('.theme-option').forEach((btn) => {
        const isActive = btn.dataset.theme === theme;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function setupThemeToggle(): void {
    document.querySelectorAll<HTMLElement>('.theme-option').forEach((btn) => {
        btn.addEventListener('click', () => {
            const theme = normalizeTheme(btn.dataset.theme);
            applyTheme(theme);
            saveTheme(theme);
        });
    });
}

function setupRailNav(): void {
    const items = Array.from(document.querySelectorAll<HTMLElement>('.rail-item'));
    const panes = Array.from(document.querySelectorAll<HTMLElement>('.settings-pane'));
    items.forEach((item) => {
        item.addEventListener('click', () => {
            items.forEach((i) => i.classList.toggle('active', i === item));
            panes.forEach((p) => p.classList.toggle('active', p.id === `pane-${item.dataset.pane}`));
        });
    });
}

function setupTabs(): void {
    const tabButtons = Array.from(document.querySelectorAll<HTMLElement>('.tab-btn'));
    tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            tabButtons.forEach((b) => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add('active');
        });
    });

    // Show the installer for this OS first.
    const uaPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
    if (uaPlatform === 'Windows' || navigator.platform?.includes('Win')) {
        document.querySelector<HTMLElement>('[data-tab="windows"]')?.click();
    }
}

async function fetchExtensionFile(path: string): Promise<Response> {
    const response = await fetch(chrome.runtime.getURL(path));
    if (!response.ok) throw new Error(`Missing extension file: ${path}`);
    return response;
}

async function downloadInstaller(filename: string, downloadName: string): Promise<void> {
    const status = document.getElementById('download-status');
    try {
        const release = (await (await fetchExtensionFile('installers/companion-release.json')).json()) as CompanionRelease;
        const [template, launcherJs, archive] = await Promise.all([
            fetchExtensionFile(`installers/${filename}`).then((r) => r.text()),
            fetchExtensionFile('installers/launcher.js').then((r) => r.text()),
            fetchExtensionFile(release.extensionPath || `installers/${release.filename}`).then((r) => r.arrayBuffer())
        ]);
        const content = buildInstaller({
            filename,
            template,
            launcherJs,
            companionB64: bytesToBase64(new Uint8Array(archive)),
            release,
            extensionId: chrome.runtime.id
        });
        saveFile(content, downloadName);
        if (status) {
            status.textContent = `Downloaded ${downloadName} — run it to complete setup.`;
            setTimeout(() => { status.textContent = ''; }, DOWNLOAD_STATUS_MS);
        }
    } catch (error) {
        console.error('Installer download failed:', error);
        if (status) status.textContent = 'Download failed. Try again.';
    }
}

function saveFile(content: string, name: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function runEnvironmentCheck(): Promise<void> {
    const resultEl = requireById('check-result');
    resultEl.innerHTML = '<div class="check-summary muted">Running preflight…</div>';
    const port = requireById<HTMLInputElement>('backend-port').value || DEFAULT_SETTINGS.backendPort;

    const setup: SetupCheckResponse = await sendToBackground<SetupCheckResponse>({ type: 'check-setup' })
        .then((r) => r || { success: false, nativeHost: false, error: 'No setup response' })
        .catch((error: Error) => ({ success: false, nativeHost: false, error: error.message }));

    const checks = [...companionChecks(setup, chrome.runtime.id), ...(await backendChecks(port))];
    resultEl.innerHTML = renderChecks(checks);
}

async function fillSettingsForm(): Promise<void> {
    const settings = await loadSettings();
    requireById<HTMLInputElement>('backend-port').value = String(settings.backendPort);
    requireById<HTMLInputElement>('appium-url').value = settings.appiumUrl;
    requireById<HTMLInputElement>('fps-limit').value = String(normalizeFpsLimit(settings.fpsLimit));
}

function saveSettings(): void {
    const backendPort = requireById<HTMLInputElement>('backend-port').value;
    const appiumUrl = requireById<HTMLInputElement>('appium-url').value;
    const fpsInput = requireById<HTMLInputElement>('fps-limit');
    const fpsLimit = normalizeFpsLimit(fpsInput.value);
    fpsInput.value = String(fpsLimit);

    void chrome.storage.sync.set({ backendPort, appiumUrl, fpsLimit }).then(() => {
        const btn = requireById('save-btn');
        const original = btn.textContent;
        btn.textContent = 'Saved!';
        setTimeout(() => { btn.textContent = original; }, SAVED_FEEDBACK_MS);
    });
}
