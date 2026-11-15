import { connect } from 'node:net';

/** True when something accepts TCP connections on 127.0.0.1:port. */
export function isPortInUse(port: number, host = '127.0.0.1', timeoutMs = 1000): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = connect({ port, host });
        const done = (inUse: boolean) => {
            socket.destroy();
            resolve(inUse);
        };
        socket.setTimeout(timeoutMs, () => done(false));
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
    });
}
