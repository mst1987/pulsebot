// Where a popover goes (#439): the pure half of components/ui/Popover.tsx.
// Every function takes the anchor's rectangle, the box's measured size and the
// viewport, and returns fixed coordinates — so Jest can check them through
// loadTs (test/web-client/popover.test.js) without a browser.

/** The part of a DOMRect the placements read. */
export type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type Size = { width: number; height: number };
/** Fixed coordinates of the box (CSS pixels), as a style object takes them. */
export type PopoverStyle = { left?: number; top?: number; right?: number; bottom?: number; width?: number; maxHeight?: number };
/** A placement: anchor rectangle (null when there is none), box size, viewport size -> coordinates. */
export type Placement = (anchor: Rect | null, box: Size, viewport: Size) => PopoverStyle;

/** How far a box stays away from the viewport's edge. */
export const VIEWPORT_MARGIN = 8;

/** Where a box of w x h opened at (x, y) sits so it stays inside the viewport (opens up / left when there is no room). */
export function clampToViewport(x: number, y: number, w: number, h: number, vw: number, vh: number): { x: number; y: number } {
    const margin = VIEWPORT_MARGIN;
    return {
        x: Math.max(margin, x + w + margin > vw ? Math.max(margin, vw - w - margin) : x),
        y: Math.max(margin, y + h + margin > vh ? Math.max(margin, vh - h - margin) : y),
    };
}

/** A tooltip: centred above the anchor, below it when there is no room above, never past the left or right edge. */
export function tipPosition(anchor: Rect, box: Size, viewport: Size, gap = 9): { left: number; top: number } {
    const x = anchor.left + anchor.width / 2 - box.width / 2;
    let y = anchor.top - box.height - gap;
    if (y < VIEWPORT_MARGIN) y = anchor.bottom + gap;
    return { left: Math.max(VIEWPORT_MARGIN, Math.min(x, viewport.width - box.width - VIEWPORT_MARGIN)), top: y };
}

/** A menu under its button, its right edge on the button's right edge. */
export function belowEndPosition(anchor: Rect, viewport: Size, gap = 6): { top: number; right: number } {
    return { top: anchor.bottom + gap, right: Math.max(VIEWPORT_MARGIN, viewport.width - anchor.right) };
}

/**
 * A hover panel of a fixed width: its right edge on the anchor's, below the
 * anchor, flipped above it when there is more room up there and not enough
 * below; its height is capped to the room it has.
 */
export function panelPosition(anchor: Rect, viewport: Size, width = 340, maxHeight = 340): PopoverStyle {
    const w = Math.min(width, viewport.width - 16);
    const left = Math.max(VIEWPORT_MARGIN, Math.min(anchor.right - w, viewport.width - w - VIEWPORT_MARGIN));
    const below = viewport.height - anchor.bottom - 14;
    const above = anchor.top - 14;
    return above > below && below < maxHeight
        ? { left, width: w, bottom: viewport.height - anchor.top + 6, maxHeight: Math.min(maxHeight, above) }
        : { left, width: w, top: anchor.bottom + 6, maxHeight: Math.min(maxHeight, below) };
}

/** Placement: a tooltip over the anchor (see tipPosition). */
export function tipPlacement(gap = 9): Placement {
    return (anchor, box, viewport) => (anchor ? tipPosition(anchor, box, viewport, gap) : {});
}

/** Placement: a menu under its button, right-aligned (see belowEndPosition). */
export function belowEndPlacement(gap = 6): Placement {
    return (anchor, _box, viewport) => (anchor ? belowEndPosition(anchor, viewport, gap) : {});
}

/** Placement: a hover panel of a fixed width (see panelPosition). */
export function panelPlacement(width = 340, maxHeight = 340): Placement {
    return (anchor, _box, viewport) => (anchor ? panelPosition(anchor, viewport, width, maxHeight) : {});
}

/** Placement: a menu at a point (the pointer of a right click), moved back into the viewport. */
export function pointPlacement(x: number, y: number): Placement {
    return (_anchor, box, viewport) => {
        const p = clampToViewport(x, y, box.width, box.height, viewport.width, viewport.height);
        return { left: p.x, top: p.y };
    };
}

/** Whether two placements put the box in the same spot (so a re-measure does not render again). */
export function samePosition(a: PopoverStyle | null, b: PopoverStyle | null): boolean {
    if (!a || !b) return a === b;
    return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.width === b.width && a.maxHeight === b.maxHeight;
}
