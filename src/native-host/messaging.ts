/** Chrome native messaging framing: 4-byte little-endian length + UTF-8 JSON. */

export const MAX_MESSAGE_BYTES = 10_000_000;

export function encodeMessage(message: unknown): Buffer {
    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    return Buffer.concat([header, payload]);
}

export interface DecodeResult {
    messages: unknown[];
    rest: Buffer;
    /** Set when a frame was malformed; the buffer was dropped. */
    error?: string;
}

/** Pull every complete frame out of `buffer`; keep the incomplete tail. */
export function decodeMessages(buffer: Buffer): DecodeResult {
    const messages: unknown[] = [];
    let offset = 0;
    while (buffer.length - offset >= 4) {
        const length = buffer.readUInt32LE(offset);
        if (length > MAX_MESSAGE_BYTES) {
            return { messages, rest: Buffer.alloc(0), error: 'Invalid message length, resetting buffer' };
        }
        if (buffer.length - offset - 4 < length) break;
        const payload = buffer.subarray(offset + 4, offset + 4 + length).toString('utf8');
        offset += 4 + length;
        try {
            messages.push(JSON.parse(payload));
        } catch (error) {
            return { messages, rest: buffer.subarray(offset), error: `Invalid JSON message: ${(error as Error).message}` };
        }
    }
    return { messages, rest: buffer.subarray(offset) };
}
