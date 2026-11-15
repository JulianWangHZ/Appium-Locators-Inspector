import { SETUP_COMMAND, START_COMMAND } from '../../shared/defaults.js';
import type { NativeMessage, ProcessStartResult } from '../../shared/protocol.js';
import type { ServerStartError } from '../lib/messages.js';

export const SETUP_REQUIRED_MESSAGE = `Start the local companion with: ${START_COMMAND}`;

export interface DisconnectExplanation {
    message: string;
    needsHelp: boolean;
}

/** Turn Chrome's native-host error into something a user can act on. */
export function explainDisconnect(error: string): DisconnectExplanation {
    if (error.includes('Specified native messaging host not found')) {
        return { message: SETUP_REQUIRED_MESSAGE, needsHelp: true };
    }
    if (error.includes('Access to the specified native messaging host is forbidden')) {
        return { message: `Run ${SETUP_COMMAND} again, then reload the extension.`, needsHelp: true };
    }
    if (error.includes('Native host has exited')) {
        return { message: 'Native host crashed. Check that Node.js is installed and in your PATH.', needsHelp: true };
    }
    return { message: error, needsHelp: false };
}

function toStartError(server: string, result: ProcessStartResult | undefined): ServerStartError[] {
    if (!result || result.success) return [];
    return [{ server, error: result.error ?? 'Unknown error', code: result.code }];
}

export function startErrorsOf(msg: Extract<NativeMessage, { type: 'start-result' }>): ServerStartError[] {
    return [...toStartError('Backend', msg.backend), ...toStartError('Appium', msg.appium)];
}
