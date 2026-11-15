import { execFileSync, execSync } from 'node:child_process';

/** Kill whatever listens on `port` (orphans from a previous run). Port must already be validated. */
export function killPortProcess(port: number, log: (message: string) => void): void {
    if (!Number.isInteger(port) || port <= 0 || port >= 65536) return;
    try {
        if (process.platform === 'win32') {
            const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8', timeout: 5000 });
            const pid = out.trim().match(/\s+(\d+)\s*$/m)?.[1];
            if (pid) {
                execFileSync('taskkill', ['/PID', pid, '/F'], { timeout: 5000 });
                log(`Killed process ${pid} on port ${port}`);
            }
            return;
        }
        const pids = execFileSync('lsof', [`-ti:${port}`], { encoding: 'utf8', timeout: 5000 })
            .split(/\s+/)
            .map((s) => Number.parseInt(s, 10))
            .filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
        for (const pid of pids) {
            try {
                process.kill(pid, 'SIGKILL');
                log(`Killed process ${pid} on port ${port}`);
            } catch { /* already gone */ }
        }
    } catch {
        // Nothing listening, or the tool is missing.
    }
}

/** Stop a child and its children (Windows `shell: true` spawns cmd.exe). */
export function killProcessTree(pid: number | undefined): void {
    if (!pid) return;
    try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 5000 });
        else process.kill(pid, 'SIGTERM');
    } catch {
        // Already dead.
    }
}
