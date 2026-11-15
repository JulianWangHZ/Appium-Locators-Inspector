/** Pure geometry over page-source XML: bounds parsing, hit-testing, screen scale. */

const ANDROID_BOUNDS = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/;

export interface Box {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    /** iOS reports points (needs the retina scale); Android reports pixels. */
    inPoints: boolean;
}

export interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export function parseAndroidBounds(bounds: string | null | undefined): Omit<Box, 'inPoints'> | null {
    const match = bounds?.match(ANDROID_BOUNDS);
    if (!match) return null;
    const [, x1 = 0, y1 = 0, x2 = 0, y2 = 0] = match.map(Number);
    return { x1, y1, x2, y2 };
}

/** Box for a hit-test (iOS needs x and width present). */
function hitBox(el: Element): Box | null {
    const bounds = el.getAttribute('bounds');
    if (bounds) {
        const parsed = parseAndroidBounds(bounds);
        return parsed ? { ...parsed, inPoints: false } : null;
    }
    if (el.getAttribute('x') && el.getAttribute('width')) return iosBox(el);
    return null;
}

/** Box for drawing (iOS needs only x present). */
export function drawBox(el: Element): Box | null {
    const bounds = el.getAttribute('bounds');
    if (bounds) {
        const parsed = parseAndroidBounds(bounds);
        return parsed ? { ...parsed, inPoints: false } : null;
    }
    if (el.getAttribute('x')) return iosBox(el);
    return null;
}

function iosBox(el: Element): Box {
    const num = (name: string) => parseFloat(el.getAttribute(name) ?? '');
    const x1 = num('x');
    const y1 = num('y');
    return { x1, y1, x2: x1 + num('width'), y2: y1 + num('height'), inPoints: true };
}

/** Smallest element containing the point; on a tie prefer one with a name/label. */
export function findElementAtPoint(doc: Document | null, x: number, y: number): Element | null {
    if (!doc?.documentElement) return null;
    let found: Element | null = null;
    let smallestArea = Infinity;
    const hasName = (el: Element) => !!(el.getAttribute('name') || el.getAttribute('label'));

    const visit = (el: Element): void => {
        const box = hitBox(el);
        if (box && x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2) {
            const area = (box.x2 - box.x1) * (box.y2 - box.y1);
            if (found === null || area < smallestArea || (area === smallestArea && hasName(el) && !hasName(found))) {
                smallestArea = area;
                found = el;
            }
        }
        for (const child of Array.from(el.childNodes)) {
            if (child.nodeType === 1) visit(child as Element);
        }
    };
    visit(doc.documentElement);
    return found;
}

/** The element's rect in device coordinates (same space as tap coordinates). */
export function deviceRectOf(attributes: Record<string, string> | undefined): Rect | null {
    const a = attributes ?? {};
    if (a.bounds) {
        const b = parseAndroidBounds(a.bounds);
        return b ? { left: b.x1, top: b.y1, width: b.x2 - b.x1, height: b.y2 - b.y1 } : null;
    }
    if (a.x != null && a.width != null) {
        return { left: parseFloat(a.x), top: parseFloat(a.y ?? ''), width: parseFloat(a.width), height: parseFloat(a.height ?? '') };
    }
    return null;
}

function referenceWidth(doc: Document): number {
    const app = doc.querySelector('XCUIElementTypeApplication');
    if (app) {
        const bounds = app.getAttribute('bounds');
        if (bounds) {
            const b = parseAndroidBounds(bounds);
            if (b) return b.x2 - b.x1;
        } else if (app.getAttribute('width')) {
            return parseFloat(app.getAttribute('width') ?? '');
        }
    }
    // No app element: widest element, skipping status bars (often in native pixels).
    let max = 0;
    for (const el of Array.from(doc.getElementsByTagName('*'))) {
        if (el.tagName.includes('StatusBar')) continue;
        const w = el.getAttribute('width') ? parseFloat(el.getAttribute('width') ?? '') : 0;
        if (w > max) max = w;
    }
    return max;
}

/** Screenshot pixels per XML point (e.g. 3.0 on an iPhone Pro); 1.0 when they match. */
export function computeCoordinateScale(doc: Document, imageWidth: number): number {
    const xmlWidth = referenceWidth(doc);
    if (!(xmlWidth > 0)) return 1.0;
    const ratio = imageWidth / xmlWidth;
    if (Math.abs(ratio - 1.0) < 0.1) return 1.0;
    return ratio > 1.5 ? Math.round(ratio * 10) / 10 : 1.0;
}
