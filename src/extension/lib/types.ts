import type { LocatorStrategy } from '../../shared/protocol.js';

export interface Locator {
    type: string;
    strategy: LocatorStrategy;
    value: string;
    priority: number;
    code?: string;
    confidence?: 'fallback';
}

export type LocatorLike = Pick<Locator, 'strategy' | 'value'>;

export type ElementAttributes = Record<string, string>;

/** An element picked from the page source (XML node plus derived data). */
export interface ElementInfo {
    tagName: string;
    attributes: ElementAttributes;
    xpath?: string;
    xmlNode?: Element;
    parentNode?: Element | null;
}

export type StepAction = 'tap' | 'input' | 'clear' | 'assert' | 'doubleTap' | 'longPress' | 'swipe' | 'pinchOpen' | 'pinchClose';
export type AssertMatcher = 'visible' | 'hidden' | 'enabled' | 'disabled' | 'checked' | 'unchecked' | 'empty';

export interface RecordedStep {
    locator: LocatorLike;
    action: StepAction | string;
    label?: string;
    text?: string;
    direction?: string;
    matcher?: AssertMatcher | string;
}

export interface AppiumMethodPreview {
    name: string;
    value: string;
}
