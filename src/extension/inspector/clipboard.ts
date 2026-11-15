import { showNotification } from './notify.js';

const FEEDBACK_MS = 2000;

function legacyCopy(text: string): boolean {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        return document.execCommand('copy');
    } catch (error) {
        console.error('execCommand failed:', error);
        return false;
    } finally {
        textArea.remove();
    }
}

/** Copy text and flash "Copied!" on the button that triggered it. */
export async function copyToClipboard(text: string, button: HTMLElement | null): Promise<void> {
    let copied = false;
    try {
        await navigator.clipboard.writeText(text);
        copied = true;
    } catch (error) {
        console.log('Clipboard API failed, using fallback:', error);
        copied = legacyCopy(text);
    }

    if (!copied) {
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
