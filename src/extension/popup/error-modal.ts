import { byId } from '../lib/html.js';
import type { ServerStartError } from '../lib/messages.js';

export function isSetupRequiredError(error: Partial<ServerStartError> | undefined): boolean {
    return error?.code === 'COMPANION_SETUP_REQUIRED' ||
        error?.code === 'NATIVE_HOST_ERROR' ||
        !!error?.error?.includes('auto setup installer') ||
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
            if (title) title.textContent = setupRequired ? 'One-time setup needed' : 'Setup information';
            if (helpBtn) helpBtn.textContent = setupRequired ? 'Set up companion' : 'Open settings';

            if (setupRequired) {
                body.appendChild(errorItem('Appium Locators Inspector is ready.', 'Install the local companion once to start servers and connect your devices.'));
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
