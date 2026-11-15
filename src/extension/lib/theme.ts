export type Theme = 'light' | 'dark';

/** localStorage fast-path read by theme-init before stylesheets load. */
export const THEME_STORAGE_KEY = 'ali-theme';

export function normalizeTheme(theme: unknown): Theme {
    return theme === 'dark' ? 'dark' : 'light';
}

function readLocalTheme(): string | null {
    try {
        return localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
        return null;
    }
}

/** Saved theme: chrome.storage.sync first, then the localStorage fast-path. */
export async function loadTheme(): Promise<Theme> {
    const { theme } = await chrome.storage.sync.get({ theme: null });
    return normalizeTheme(theme || readLocalTheme());
}

export function saveTheme(theme: Theme): void {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
        // Storage blocked; sync storage still persists it.
    }
    void chrome.storage.sync.set({ theme });
}

/** Drive the shared dark tokens (tokens.css uses [data-theme="dark"]). */
export function setDocumentTheme(theme: Theme): void {
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
}

export function currentDocumentTheme(): Theme {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
