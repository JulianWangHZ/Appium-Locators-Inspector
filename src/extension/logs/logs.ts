import { requireById } from '../lib/html.js';
import { sendToBackground, type BackgroundEvent, type LogEntry } from '../lib/messages.js';

const MAX_ENTRIES = 1000;
const BOTTOM_THRESHOLD_PX = 50;

const EMPTY_STATE_HTML = `
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <p>No logs yet</p>
    <span>Logs will appear here when servers are running</span>
  `;

interface RenderedLog {
    level: string;
    element: HTMLElement;
}

const logsContent = requireById('logs-content');
const filterButtons = Array.from(document.querySelectorAll<HTMLElement>('.filter-btn'));
let rendered: RenderedLog[] = [];
let currentFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
    requireById('clear-logs-btn').addEventListener('click', clearLogs);
    filterButtons.forEach((btn) => btn.addEventListener('click', () => setFilter(btn.dataset.filter ?? 'all')));
    chrome.runtime.onMessage.addListener((message: BackgroundEvent) => {
        if (message.type === 'server-log') addLogEntry(message.message, message.level, message.timestamp);
        else if (message.type === 'initial-logs') message.logs.forEach(addFromHistory);
    });
    void sendToBackground<{ logs?: LogEntry[] }>({ type: 'request-logs' })
        .then((response) => response?.logs?.forEach(addFromHistory))
        .catch(() => {});
});

function addFromHistory(entry: LogEntry): void {
    addLogEntry(entry.message, entry.level, entry.timestamp);
}

export function formatLogTime(timestamp: number | null): string {
    return (timestamp ? new Date(timestamp) : new Date()).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function isVisible(level: string): boolean {
    return currentFilter === 'all' || level === currentFilter;
}

function addLogEntry(message: string, level = 'info', timestamp: number | null = null): void {
    document.getElementById('empty-state')?.classList.add('hidden');

    const entry = document.createElement('div');
    entry.className = `log-entry log-${level}`;
    const time = document.createElement('span');
    time.className = 'log-timestamp';
    time.textContent = formatLogTime(timestamp);
    const text = document.createElement('span');
    text.className = 'log-message';
    text.textContent = message;
    entry.append(time, text);
    if (!isVisible(level)) entry.classList.add('hidden');

    const wasAtBottom = logsContent.scrollHeight - logsContent.scrollTop <= logsContent.clientHeight + BOTTOM_THRESHOLD_PX;
    logsContent.appendChild(entry);
    if (wasAtBottom) logsContent.scrollTop = logsContent.scrollHeight;

    rendered = [...rendered, { level, element: entry }];
    if (rendered.length > MAX_ENTRIES) {
        rendered[0]?.element.remove();
        rendered = rendered.slice(1);
    }
}

function clearLogs(): void {
    rendered = [];
    logsContent.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.id = 'empty-state';
    empty.innerHTML = EMPTY_STATE_HTML;
    logsContent.appendChild(empty);
}

function setFilter(filter: string): void {
    currentFilter = filter;
    filterButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.filter === filter));
    rendered.forEach((log) => log.element.classList.toggle('hidden', !isVisible(log.level)));
}
