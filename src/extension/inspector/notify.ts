export type NoticeType = 'info' | 'success' | 'warning' | 'error';

let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** Toast at the bottom of the inspector; errors stay longer. */
export function showNotification(message: string, type: NoticeType = 'info'): void {
    console.log(`[${type.toUpperCase()}] ${message}`);
    let toast = document.getElementById('notification-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'notification-toast';
        document.body.appendChild(toast);
    }
    if (hideTimer) clearTimeout(hideTimer);

    toast.textContent = message;
    toast.className = `notification-toast notification-${type} notification-visible`;
    const delay = type === 'error' ? 6000 : type === 'warning' ? 4000 : 2500;
    const el = toast;
    hideTimer = setTimeout(() => el.classList.remove('notification-visible'), delay);
}
