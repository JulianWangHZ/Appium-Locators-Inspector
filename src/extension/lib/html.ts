const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for HTML element content and quoted attribute values. */
export function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
}

/** For elements a page cannot work without. */
export function requireById<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = byId<T>(id);
    if (!el) throw new Error(`Missing #${id}`);
    return el;
}
