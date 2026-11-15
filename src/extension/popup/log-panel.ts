const MAX_POPUP_LOGS = 100;
const BOTTOM_THRESHOLD_PX = 20;

export interface LogPanel {
    add(message: string, level?: string): void;
    expand(): void;
}

export function createLogPanel(els: { toggle: HTMLElement; content: HTMLElement; openButton: HTMLElement | null }): LogPanel {
    const { toggle, content, openButton } = els;

    toggle.addEventListener('click', () => {
        content.classList.toggle('visible');
        toggle.classList.toggle('expanded');
    });
    openButton?.addEventListener('click', (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: 'open-logs-tab' });
    });

    return {
        add(message, level = 'info') {
            const entry = document.createElement('div');
            entry.className = `log-entry log-${level}`;
            entry.textContent = message;
            const wasAtBottom = content.scrollHeight - content.scrollTop <= content.clientHeight + BOTTOM_THRESHOLD_PX;
            content.appendChild(entry);
            if (wasAtBottom) content.scrollTop = content.scrollHeight;
            while (content.children.length > MAX_POPUP_LOGS && content.firstChild) content.removeChild(content.firstChild);
        },
        expand() {
            if (content.classList.contains('visible')) return;
            content.classList.add('visible');
            toggle.classList.add('expanded');
        }
    };
}
