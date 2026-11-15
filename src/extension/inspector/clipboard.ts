import { writeClipboard } from '../lib/clipboard.js';
import { showNotification } from './notify.js';

const FEEDBACK_MS = 2000;

/** Copy text and flash "Copied!" on the button that triggered it. */
export async function copyToClipboard(text: string, button: HTMLElement | null): Promise<void> {
    if (!(await writeClipboard(text))) {
        showNotification('Failed to copy to clipboard', 'error');
        return;
    }
    if (!button) return;
    const originalText = button.textContent;
    button.textContent = 'Copied!';
    button.style.background = '#10b981';
    button.style.borderColor = '#10b981';
    button.style.color = 'white';
    setTimeout(() => {
        button.textContent = originalText;
        button.style.background = '';
        button.style.borderColor = '';
        button.style.color = '';
    }, FEEDBACK_MS);
}
