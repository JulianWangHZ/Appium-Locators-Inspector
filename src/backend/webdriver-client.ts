/**
 * Minimal W3C WebDriver client for Appium (replaces webdriverio).
 * Only the commands the inspector needs; plain fetch, no dependencies.
 */

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecc';

export class WebDriverError extends Error {
    constructor(message: string, readonly status?: number, readonly code?: string) {
        super(message);
        this.name = 'WebDriverError';
    }
}

type HttpMethod = 'GET' | 'POST' | 'DELETE';

export interface W3CAction {
    type: 'pointer' | 'key' | 'none';
    id: string;
    parameters?: { pointerType: 'touch' | 'mouse' | 'pen' };
    actions: Array<Record<string, unknown>>;
}

function describeNetworkError(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    if (error.name === 'TimeoutError') return `Request timed out: ${error.message}`;
    const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
    const code = cause?.code ? ` (${cause.code})` : '';
    const detail = cause?.message ? `: ${cause.message}` : '';
    return `${error.message}${detail}${code}`;
}

async function request<T>(url: string, method: HttpMethod, body: unknown, timeoutMs: number): Promise<T> {
    let response: Response;
    try {
        response = await fetch(url, {
            method,
            headers: body === undefined ? undefined : { 'Content-Type': 'application/json; charset=utf-8' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs)
        });
    } catch (error) {
        throw new WebDriverError(describeNetworkError(error));
    }

    const text = await response.text();
    let payload: { value?: unknown } = {};
    try {
        payload = text ? JSON.parse(text) : {};
    } catch {
        throw new WebDriverError(`Invalid response from Appium (${response.status}): ${text.slice(0, 200)}`, response.status);
    }

    const value = payload.value as { error?: string; message?: string } | undefined;
    if (!response.ok || (value && typeof value === 'object' && typeof value.error === 'string')) {
        const code = value?.error ?? `http ${response.status}`;
        throw new WebDriverError(`${code}: ${value?.message ?? text.slice(0, 200)}`, response.status, code);
    }
    return payload.value as T;
}

export class WebDriverSession {
    private readonly sessionUrl: string;

    constructor(baseUrl: string, readonly sessionId: string, private readonly timeoutMs: number) {
        this.sessionUrl = `${baseUrl.replace(/\/$/, '')}/session/${encodeURIComponent(sessionId)}`;
    }

    private call<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
        return request<T>(`${this.sessionUrl}${path}`, method, body, this.timeoutMs);
    }

    getPageSource(): Promise<string> {
        return this.call<string>('GET', '/source');
    }

    takeScreenshot(): Promise<string> {
        return this.call<string>('GET', '/screenshot');
    }

    async performActions(actions: W3CAction[]): Promise<void> {
        await this.call('POST', '/actions', { actions });
    }

    async releaseActions(): Promise<void> {
        await this.call('DELETE', '/actions');
    }

    executeScript<T = unknown>(script: string, args: unknown[]): Promise<T> {
        return this.call<T>('POST', '/execute/sync', { script, args });
    }

    async findElement(using: string, value: string): Promise<string> {
        const result = await this.call<Record<string, string>>('POST', '/element', { using, value });
        const id = result[ELEMENT_KEY] ?? result.ELEMENT;
        if (!id) throw new WebDriverError(`no such element: ${using}=${value}`, 404, 'no such element');
        return id;
    }

    async elementClear(elementId: string): Promise<void> {
        await this.call('POST', `/element/${encodeURIComponent(elementId)}/clear`, {});
    }

    async elementSendKeys(elementId: string, text: string): Promise<void> {
        await this.call('POST', `/element/${encodeURIComponent(elementId)}/value`, { text, value: Array.from(text) });
    }

    async deleteSession(): Promise<void> {
        await request(this.sessionUrl, 'DELETE', undefined, this.timeoutMs);
    }
}

export interface NewSessionOptions {
    /** Per-attempt timeout; WDA builds can take minutes. */
    timeoutMs: number;
    /** Extra attempts after a network failure (not after a WebDriver error). */
    retries: number;
    /** Timeout for commands on the created session. */
    commandTimeoutMs: number;
}

export async function newSession(
    baseUrl: string,
    capabilities: Record<string, unknown>,
    options: NewSessionOptions
): Promise<WebDriverSession> {
    const url = `${baseUrl.replace(/\/$/, '')}/session`;
    const body = { capabilities: { alwaysMatch: capabilities, firstMatch: [{}] } };

    let lastError: unknown;
    for (let attempt = 0; attempt <= options.retries; attempt++) {
        try {
            const value = await request<{ sessionId?: string }>(url, 'POST', body, options.timeoutMs);
            if (!value?.sessionId) throw new WebDriverError('session not created: Appium returned no sessionId');
            return new WebDriverSession(baseUrl, value.sessionId, options.commandTimeoutMs);
        } catch (error) {
            lastError = error;
            const isNetworkError = error instanceof WebDriverError && error.status === undefined;
            if (!isNetworkError) break;
        }
    }
    throw lastError;
}
