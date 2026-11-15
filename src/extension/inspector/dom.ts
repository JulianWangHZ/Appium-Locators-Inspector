import { requireById } from '../lib/html.js';

export const dom = {
    deviceName: requireById('device-name'),
    modeToggleBtn: requireById('mode-toggle-btn'),
    refreshBtn: requireById('refresh-btn'),
    disconnectBtn: requireById('disconnect-btn'),
    screenImage: requireById<HTMLImageElement>('screen-image'),
    screenLoading: requireById('screen-loading'),
    fpsIndicator: requireById('fps-indicator'),
    sourceTree: requireById('source-tree'),
    sourceLoading: requireById('source-loading'),
    elementDetails: requireById('element-details'),
    connectionDot: requireById('connection-dot'),
    connectionStatus: requireById('connection-status'),
    elementCount: requireById('element-count'),
    searchInput: requireById<HTMLInputElement>('search-input'),
    themeToggleBtn: requireById('theme-toggle-btn'),
    moonIcon: requireById('moon-icon'),
    sunIcon: requireById('sun-icon')
};
