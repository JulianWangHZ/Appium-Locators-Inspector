import type { DeviceInfo } from '../../shared/protocol.js';
import type { SnippetLang } from '../lib/snippet-generator.js';
import type { ElementInfo, Locator, RecordedStep } from '../lib/types.js';

export interface SessionInfo {
    device: DeviceInfo;
    sessionId?: string;
    timestamp?: number;
}

export interface RecordSelection {
    element: ElementInfo;
    x: number;
    y: number;
}

const SNIPPET_LANG_KEY = 'ali-snippet-lang';

function loadSnippetLang(): SnippetLang {
    try {
        return (localStorage.getItem(SNIPPET_LANG_KEY) as SnippetLang | null) || 'java';
    } catch {
        return 'java';
    }
}

/**
 * Inspector page state. One page = one device session; modules read and update it
 * through this object so every view sees the same selection and page source.
 */
export const state = {
    backendUrl: 'http://localhost:8765',
    wsUrl: 'ws://localhost:8765',
    session: null as SessionInfo | null,
    pageSource: null as string | null,
    xmlDoc: null as Document | null,
    selectedElement: null as ElementInfo | null,
    /** A click locks the selection so hovering does not replace it. */
    isElementLocked: false,
    isLoadingPageSource: false,
    isInteractMode: false,
    isRecording: false,
    recordedSteps: [] as RecordedStep[],
    recordSelected: null as RecordSelection | null,
    recSubtab: 'actions' as 'actions' | 'assert',
    exportFullFile: true,
    typingBuffer: '',
    typingTargetElement: null as ElementInfo | null,
    /** Screenshot pixels per XML point. */
    coordinateScale: 1.0,
    displayedLocators: [] as Locator[],
    snippetLang: loadSnippetLang(),
    currentStreamFps: null as number | null
};

export function setSnippetLang(lang: string): void {
    state.snippetLang = lang as SnippetLang;
    try {
        localStorage.setItem(SNIPPET_LANG_KEY, lang);
    } catch {
        // Not persisted; still used for this page.
    }
}

export function platform(): string | undefined {
    return state.session?.device?.platform;
}
