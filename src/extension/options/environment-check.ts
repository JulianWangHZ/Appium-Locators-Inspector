import type { DiagnosticCheck, SetupDiagnostics } from '../../shared/protocol.js';
import { NATIVE_HOST_NAME, SETUP_COMMAND, START_COMMAND, STORE_EXTENSION_ID } from '../../shared/defaults.js';
import { escapeHtml } from '../lib/html.js';
import type { SetupCheckResponse } from '../lib/messages.js';

const DIAGNOSTICS_TIMEOUT_MS = 12_000;

/**
 * Companion checks from the native host's diagnose report. The native host is
 * optional (it powers the popup's Start button), so it only warns while a
 * companion started with npx is already running.
 */
export function companionChecks(setup: SetupCheckResponse, extensionId: string, backendRunning = false): DiagnosticCheck[] {
    if (!setup.success || !setup.diagnostics) {
        return [backendRunning
            ? { name: 'Start button (native host)', ok: false, warn: true, detail: `optional — run ${SETUP_COMMAND} to enable it` }
            : { name: 'Companion', ok: false, detail: `not running — run ${START_COMMAND}` }];
    }
    const d: SetupDiagnostics = setup.diagnostics;
    return [
        { name: 'Companion (native host)', ok: setup.nativeHost, detail: setup.nativeHost ? `connected · ${d.hostName || NATIVE_HOST_NAME}` : 'not connected' },
        { name: 'Install location', ok: !!d.installBase, detail: d.installBase || 'unknown' },
        {
            name: 'Backend installed',
            ok: d.backendInstalled,
            detail: d.backendInstalled ? `${d.companionVersion ? `v${d.companionVersion} · ` : ''}${d.backendPath}` : `missing — run ${SETUP_COMMAND}`
        },
        { name: 'Dependencies installed', ok: d.dependenciesInstalled, detail: d.dependenciesInstalled ? 'ready' : `run ${SETUP_COMMAND}` },
        { name: 'Extension ID (allowed_origins)', ok: d.extensionAllowed, detail: `${extensionId}${d.extensionAllowed ? '' : ` — not allowed, run ${SETUP_COMMAND} --extension-id ${extensionId}`}` }
    ];
}

export async function backendChecks(port: string | number): Promise<DiagnosticCheck[]> {
    try {
        const response = await fetch(`http://localhost:${port}/api/diagnostics`, { signal: AbortSignal.timeout(DIAGNOSTICS_TIMEOUT_MS) });
        const data = (await response.json()) as { success?: boolean; checks?: DiagnosticCheck[] };
        return data.success && Array.isArray(data.checks) ? data.checks : [];
    } catch {
        return [{ name: 'Backend server', ok: false, detail: `not running — run ${START_COMMAND}` }];
    }
}

export function renderChecks(checks: DiagnosticCheck[]): string {
    const healthy = checks.every((c) => c.ok || c.warn);
    const failCount = checks.filter((c) => !c.ok && !c.warn).length;
    const summary = healthy
        ? '<div class="check-summary ok">All good — you\'re ready to inspect.</div>'
        : `<div class="check-summary bad">${failCount} item${failCount === 1 ? '' : 's'} need${failCount === 1 ? 's' : ''} attention.</div>`;

    const rows = checks.map((c) => `
        <div class="status-item">
            <span class="dot ${c.ok ? 'ok' : c.warn ? 'warn' : 'err'}"></span>
            <div class="status-text">
                <div class="status-name">${escapeHtml(c.name)}</div>
                <div class="status-detail">${escapeHtml(c.detail)}</div>
            </div>
        </div>
    `).join('');
    return summary + rows;
}

/** `setup` must allow this extension's ID; the store build is allowed by default. */
export function setupCommandFor(extensionId: string): string {
    return extensionId === STORE_EXTENSION_ID ? SETUP_COMMAND : `${SETUP_COMMAND} --extension-id ${extensionId}`;
}
