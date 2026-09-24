// Zoom and pan of a board: a view setting only (never stored in the plan), the same picture as at "fit", enlarged. The view is {z, ox, oy}: the zoom
// factor (1 = fit = what the read view shows) and where the canvas starts, as fractions of the visible frame. Board points stay where they are:
// converting a screen point to a board fraction is (px - rect.left) / rect.width on the canvas' own (transformed) rectangle, at any zoom.
// Pure and tested (test/web-client/boardView.test.js); written with function declarations and one-line signatures only.

export const MIN_Z = 0.5;
export const MAX_Z = 4;
export const FIT = { z: 1, ox: 0, oy: 0 };

export type BoardView = { z: number; ox: number; oy: number };

export function clampZoom(z: number): number {
    return Math.max(MIN_Z, Math.min(MAX_Z, isFinite(z) ? z : 1));
}

/** One axis of the offset: zoomed in the image may not leave the frame (its edges stay outside), zoomed out it sits in the middle. */
function clampAxis(o: number, z: number): number {
    return z >= 1 ? Math.max(1 - z, Math.min(0, o)) : (1 - z) / 2;
}

/** A view kept inside its limits. */
export function clampView(v: BoardView): BoardView {
    const z = clampZoom(v.z);
    return { z, ox: clampAxis(v.ox, z), oy: clampAxis(v.oy, z) };
}

/** Zooms to `z` about a point of the frame (fractions of the frame, e.g. the pointer): the board point under it stays under it. */
export function zoomAt(v: BoardView, z: number, px: number, py: number): BoardView {
    const nz = clampZoom(z);
    const bx = (px - v.ox) / v.z;
    const by = (py - v.oy) / v.z;
    return clampView({ z: nz, ox: px - bx * nz, oy: py - by * nz });
}

/** Moves the picture by a distance given in fractions of the frame. */
export function panBy(v: BoardView, dx: number, dy: number): BoardView {
    return clampView({ z: v.z, ox: v.ox + dx, oy: v.oy + dy });
}

/** The zoom after a mouse wheel (ctrl + wheel): a smooth exponential step. */
export function wheelZoom(z: number, deltaY: number): number {
    return clampZoom(z * Math.exp(-deltaY * 0.0015));
}

/** The next zoom of the +/- buttons (a step of a quarter, snapped to it). */
export function stepZoom(z: number, dir: number): number {
    const next = dir > 0 ? z * 1.25 : z / 1.25;
    return clampZoom(Math.round(next * 100) / 100);
}

/** A pinch: the view after the two touches went from a distance/centre to another (frame fractions): zoom by the ratio about the centre, then follow the centre's move. */
export function pinchView(v: BoardView, fromDist: number, fromCx: number, fromCy: number, toDist: number, toCx: number, toCy: number): BoardView {
    if (!(fromDist > 0) || !(toDist > 0)) return v;
    const zoomed = zoomAt(v, v.z * (toDist / fromDist), fromCx, fromCy);
    return panBy(zoomed, toCx - fromCx, toCy - fromCy);
}

/** The screen point (client px) of a board point (fractions 0..1) for a frame at (left, top) of the size (w, h): what the canvas' transformed rectangle gives. */
export function boardToScreen(v: BoardView, bx: number, by: number, left: number, top: number, w: number, h: number): { x: number; y: number } {
    return { x: left + (v.ox + bx * v.z) * w, y: top + (v.oy + by * v.z) * h };
}

/** The board point (fractions 0..1) under a screen point: the inverse of boardToScreen. */
export function screenToBoard(v: BoardView, x: number, y: number, left: number, top: number, w: number, h: number): { bx: number; by: number } {
    return { bx: ((x - left) / w - v.ox) / v.z, by: ((y - top) / h - v.oy) / v.z };
}
