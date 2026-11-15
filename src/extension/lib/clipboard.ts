const COPIED_FEEDBACK_MS = 1500;

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

/** Copy with the Clipboard API, falling back to execCommand. */
export async function writeClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (error) {
        console.log('Clipboard API failed, using fallback:', error);
        return legacyCopy(text);
    }
}

/** Copy and show "Copied!" on the button for a moment. */
export async function copyText(text: string, button: HTMLElement): Promise<boolean> {
    const copied = await writeClipboard(text);
    const original = button.textContent;
    button.textContent = copied ? 'Copied!' : 'Copy failed';
    setTimeout(() => { button.textContent = original; }, COPIED_FEEDBACK_MS);
    return copied;
}
