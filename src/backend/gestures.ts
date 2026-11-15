import type { DeviceRect, GestureName, Platform, SwipeDirection } from '../shared/protocol.js';
import type { LocatorStrategy } from '../shared/protocol.js';

export const GESTURE_NAMES: readonly GestureName[] = ['doubleTap', 'longPress', 'swipe', 'pinchOpen', 'pinchClose'];
export const SWIPE_DIRECTIONS: readonly SwipeDirection[] = ['up', 'down', 'left', 'right'];

export interface GestureOptions {
    x?: number;
    y?: number;
    rect?: DeviceRect;
    direction?: SwipeDirection;
}

export interface MobileCommand {
    script: string;
    params: Record<string, unknown>;
}

/** The platform-specific `mobile:` command for a gesture. */
export function mobileGestureCommand(platform: Platform, name: GestureName, opts: GestureOptions): MobileCommand {
    const ios = platform === 'ios';
    const { x, y, rect, direction } = opts;

    switch (name) {
        case 'doubleTap':
            return { script: ios ? 'mobile: doubleTap' : 'mobile: doubleClickGesture', params: { x, y } };
        case 'longPress':
            return ios
                ? { script: 'mobile: touchAndHold', params: { x, y, duration: 1.0 } }
                : { script: 'mobile: longClickGesture', params: { x, y, duration: 1000 } };
        case 'swipe':
            return ios
                ? { script: 'mobile: swipe', params: { direction } }
                : { script: 'mobile: swipeGesture', params: { ...rect, direction, percent: 0.75 } };
        case 'pinchOpen':
            return ios
                ? { script: 'mobile: pinch', params: { scale: 2.0, velocity: 1.0 } }
                : { script: 'mobile: pinchOpenGesture', params: { ...rect, percent: 0.75 } };
        case 'pinchClose':
            return ios
                ? { script: 'mobile: pinch', params: { scale: 0.5, velocity: 1.0 } }
                : { script: 'mobile: pinchCloseGesture', params: { ...rect, percent: 0.75 } };
    }
}

export function tapActions(x: number, y: number) {
    return [{
        type: 'pointer' as const,
        id: 'finger1',
        parameters: { pointerType: 'touch' as const },
        actions: [
            { type: 'pointerMove', duration: 0, x, y },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 100 },
            { type: 'pointerUp', button: 0 }
        ]
    }];
}

export function keyActions(text: string) {
    const actions = Array.from(text).flatMap((char) => [
        { type: 'keyDown', value: char },
        { type: 'keyUp', value: char }
    ]);
    return [{ type: 'key' as const, id: 'keyboard', actions }];
}

/** Map an inspector locator to a W3C find-element request Appium understands. */
export function toW3CLocator(strategy: LocatorStrategy, value: string): { using: string; value: string } {
    switch (strategy) {
        case 'id':
        case 'resource-id':
            return { using: '-android uiautomator', value: `new UiSelector().resourceId("${value.replace(/"/g, '\\"')}")` };
        case 'accessibility id':
        case 'xpath':
        case 'class name':
        case '-android uiautomator':
        case '-ios predicate string':
        case '-ios class chain':
            return { using: strategy, value };
    }
}

export const LOCATOR_STRATEGIES: readonly LocatorStrategy[] = [
    'id', 'resource-id', 'accessibility id', 'class name', 'xpath',
    '-android uiautomator', '-ios predicate string', '-ios class chain'
];
