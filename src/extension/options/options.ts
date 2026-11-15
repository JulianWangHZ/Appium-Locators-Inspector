import { sendToBackground, type SetupCheckResponse } from '../lib/messages.js';
import { requireById } from '../lib/html.js';
import { DEFAULT_SETTINGS, loadSettings, normalizeFpsLimit } from '../lib/settings.js';
import { loadTheme, normalizeTheme, saveTheme, setDocumentTheme, type Theme } from '../lib/theme.js';
import { copyText } from '../lib/clipboard.js';
import { backendChecks, companionChecks, renderChecks, setupCommandFor } from './environment-check.js';

const SAVED_FEEDBACK_MS = 1500;

document.addEventListener('DOMContentLoaded', () => {
    const version = document.querySelector('.rail-brand .ver');
    if (version) version.textContent = `v${chrome.runtime.getManifest().version}`;
    void fillSettingsForm();
    void loadTheme().then(applyTheme);
    setupRailNav();
    setupThemeToggle();
    setupCommands();
    requireById('save-btn').addEventListener('click', saveSettings);
    document.getElementById('check-backend-btn')?.addEventListener('click', () => void runEnvironmentCheck());
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync' && changes.theme) applyTheme(normalizeTheme(changes.theme.newValue));
    });
});

function setupCommands(): void {
    const setupCode = document.getElementById('cmd-setup');
    if (setupCode) setupCode.textContent = setupCommandFor(chrome.runtime.id);
    document.querySelectorAll<HTMLElement>('.cmd-copy').forEach((btn) => {
        btn.addEventListener('click', () => {
            const text = document.getElementById(btn.dataset.copy ?? '')?.textContent;
            if (text) void copyText(text, btn);
        });
    });
}

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

async function runEnvironmentCheck(): Promise<void> {
    const resultEl = requireById('check-result');
    resultEl.innerHTML = '<div class="check-summary muted">Running preflight…</div>';
    const port = requireById<HTMLInputElement>('backend-port').value || DEFAULT_SETTINGS.backendPort;

    const [setup, backend] = await Promise.all([
        sendToBackground<SetupCheckResponse>({ type: 'check-setup' })
            .then((r) => r || { success: false, nativeHost: false, error: 'No setup response' })
            .catch((error: Error) => ({ success: false, nativeHost: false, error: error.message })),
        backendChecks(port)
    ]);
    const backendRunning = backend.some((c) => c.name === 'Backend server' && c.ok);
    resultEl.innerHTML = renderChecks([...companionChecks(setup, chrome.runtime.id, backendRunning), ...backend]);
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
