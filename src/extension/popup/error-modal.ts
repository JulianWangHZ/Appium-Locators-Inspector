import { START_COMMAND } from '../../shared/defaults.js';
import { copyText } from '../lib/clipboard.js';
import { byId } from '../lib/html.js';
import type { ServerStartError } from '../lib/messages.js';

export function isSetupRequiredError(error: Partial<ServerStartError> | undefined): boolean {
    return error?.code === 'COMPANION_SETUP_REQUIRED' ||
        error?.code === 'NATIVE_HOST_ERROR' ||
        !!error?.error?.includes('native host');
}

function errorItem(title: string, text: string): HTMLElement {
    const item = document.createElement('div');
    item.className = 'error-item';
    const server = document.createElement('div');
    server.className = 'error-server';
    server.textContent = title;
    const body = document.createElement('div');
    body.className = 'error-text';
    body.textContent = text;
    item.append(server, body);
    return item;
}

/** "Start the companion" card: the npx command with a Copy button. */
function startCommandItem(): HTMLElement {
    const item = errorItem('Start the local companion', 'Run this in a terminal and keep it open. The popup picks it up within a few seconds.');
    const row = document.createElement('div');
    row.className = 'cmd-row';
    const code = document.createElement('code');
    code.className = 'cmd-code';
    code.textContent = START_COMMAND;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn btn-quiet btn-sm';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => void copyText(START_COMMAND, copy));
    row.append(code, copy);
    item.appendChild(row);
    return item;
}

export function createErrorModal({ onHelp }: { onHelp: () => void }) {
    const modal = byId('error-modal');
    const title = byId('error-modal-title');
    const body = byId('error-modal-body');
    const helpBtn = byId('error-help-btn');
    const hide = () => modal?.classList.add('hidden');

    byId('error-modal-close')?.addEventListener('click', hide);
    helpBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        onHelp();
    });
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) hide();
    });

    return {
        show(errors: Array<Partial<ServerStartError>>): void {
            if (!modal || !body) return;
            body.innerHTML = '';
            const setupRequired = errors.some(isSetupRequiredError);
            if (title) title.textContent = setupRequired ? 'Start the companion' : 'Setup information';
            if (helpBtn) helpBtn.textContent = setupRequired ? 'More setup options' : 'Open settings';

            if (setupRequired) {
                body.appendChild(startCommandItem());
            } else {
                errors.forEach((error) => {
                    body.appendChild(errorItem(error.server ? `${error.server} needs attention:` : 'Needs attention:', error.error ?? ''));
                });
            }
            modal.classList.remove('hidden');
        },
        hide
    };
}
