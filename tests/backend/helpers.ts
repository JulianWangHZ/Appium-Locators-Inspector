import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export async function listen(server: Server): Promise<number> {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return (server.address() as AddressInfo).port;
}

export async function close(server: Server): Promise<void> {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
}

export interface RecordedRequest {
    method: string;
    url: string;
    body: unknown;
}

/** A fake Appium server: replies from a route table and records requests. */
export async function fakeAppium(
    routes: Record<string, (body: unknown) => { status?: number; value: unknown }>
): Promise<{ url: string; requests: RecordedRequest[]; stop: () => Promise<void> }> {
    const requests: RecordedRequest[] = [];
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            const body = raw ? JSON.parse(raw) : undefined;
            const key = `${req.method} ${req.url}`;
            requests.push({ method: req.method ?? '', url: req.url ?? '', body });
            const handler = routes[key];
            const reply = handler ? handler(body) : { status: 404, value: { error: 'unknown command', message: key } };
            res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ value: reply.value }));
        });
    });
    const port = await listen(server);
    return { url: `http://127.0.0.1:${port}`, requests, stop: () => close(server) };
}
