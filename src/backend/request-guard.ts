import type { IncomingHttpHeaders } from 'node:http';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Requests may only come from extension pages or non-browser local tools (no Origin). */
export function isAllowedOrigin(origin: string | undefined): boolean {
    return !origin || origin.startsWith('chrome-extension://');
}

/** Blocks DNS-rebinding: the Host header must name the loopback interface. */
export function isLoopbackHost(host: string | undefined): boolean {
    if (!host) return false;
    const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
    return LOOPBACK_HOSTS.has((hostname ?? '').toLowerCase());
}

export function isTrustedRequest(headers: IncomingHttpHeaders): boolean {
    return isLoopbackHost(headers.host) && isAllowedOrigin(headers.origin);
}
