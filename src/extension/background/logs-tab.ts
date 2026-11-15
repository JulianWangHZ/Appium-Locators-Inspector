let logsTabId: number | null = null;

/** Focus the logs tab if it is open, otherwise open one. */
export async function openLogsTab(): Promise<void> {
    if (logsTabId !== null) {
        try {
            const tab = await chrome.tabs.get(logsTabId);
            await chrome.tabs.update(logsTabId, { active: true });
            await chrome.windows.update(tab.windowId, { focused: true });
            return;
        } catch {
            logsTabId = null;
        }
    }
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('logs.html') });
    logsTabId = tab.id ?? null;
}

export function forgetLogsTab(tabId: number): void {
    if (tabId === logsTabId) logsTabId = null;
}
