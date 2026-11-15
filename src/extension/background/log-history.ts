import type { LogLevel } from '../../shared/protocol.js';
import type { LogEntry } from '../lib/messages.js';

export const MAX_LOG_HISTORY = 1000;

/** Bounded, append-only view of recent server logs. */
export class LogHistory {
    private entries: readonly LogEntry[] = [];

    add(message: string, level: LogLevel | undefined, now = Date.now()): LogEntry {
        const entry: LogEntry = { type: 'server-log', message, level: level || 'info', timestamp: now };
        this.entries = [...this.entries, entry].slice(-MAX_LOG_HISTORY);
        return entry;
    }

    all(): LogEntry[] {
        return [...this.entries];
    }
}
