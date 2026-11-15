import { execFile, exec } from 'node:child_process';

export interface ExecResult {
    stdout: string;
    stderr: string;
}

/** Run a binary with an argument array (no shell). Rejects on non-zero exit or timeout. */
export function runFile(file: string, args: readonly string[], timeoutMs = 15_000): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
        execFile(file, args, { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

/**
 * Run a fixed shell command (never interpolate input into it).
 * Resolves the trimmed stdout+stderr, or null when the command failed with no output.
 */
export function runShell(command: string, timeoutMs = 8_000): Promise<string | null> {
    return new Promise((resolve) => {
        exec(command, { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout, stderr) => {
            if (error && !stdout && !stderr) {
                resolve(null);
                return;
            }
            resolve(`${stdout || ''}${stderr || ''}`.trim() || null);
        });
    });
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
