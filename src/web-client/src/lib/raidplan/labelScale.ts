// The name label of a token / slot / icon scales with the icon itself: its font is a share of the icon's size (in reference units, so every scale
// that changes the icon - its own size, the group's size, the board's symbol size, the zoom - changes the label by the same factor). That share
// NEVER changes: the name looks the same under its icon at 50 %, 100 % and 300 %, in the editor and the sheet. The only limit is legibility: when the
// name would be smaller than HIDE_SCREEN_FONT px on screen it is hidden (the icon is too small on screen to carry it) - it is never blown up
// beyond its share, which made names wider than the room between two raiders and let them lie on the next one while zoomed out (#raidplan-14).
// Pure and tested (src/web-client/src/lib/labelScale.test.ts); function declarations with one-line signatures only.

/** The font of a name as a share of the icon's size: tokens, slots and group members; icons (boss, mob) whose default is bigger use a smaller share. */
export const NAME_FACTOR = 0.3;
export const ICON_NAME_FACTOR = 0.24;
/** The smallest font on screen (px) a name is shown with; smaller it is hidden, never enlarged. */
export const HIDE_SCREEN_FONT = 5.5;

/**
 * The label of an icon of `size` reference units on a board scaled by `screenScale` (px per unit): its font in units (always `size * factor`),
 * and whether it is shown. `clamped` stays in the answer for the callers and is always false: nothing is enlarged any more.
 */
export function labelMetrics(size: number, factor: number, screenScale: number): { font: number; show: boolean; clamped: boolean } {
    const font = size * factor;
    return { font, show: !(screenScale > 0) || font * screenScale >= HIDE_SCREEN_FONT, clamped: false };
}

/** Shares of an icon's size for everything drawn AROUND it (reference units, like the label): the "me" ring and glow, the selection glow, the drop shadow, the outline. */
export const RING_FACTOR = 0.079;
export const GLOW_FACTOR = 0.47;
export const GLOW_SPREAD_FACTOR = 0.105;
export const SELECT_GLOW_FACTOR = 0.105;
export const SHADOW_FACTOR = 0.05;
export const OUTLINE_FACTOR = 0.053;

/** The ring, glow, selection glow, shadow and outline widths (reference units) of an icon of `size` units: proportional to the icon, so a small or a big icon looks the same at every zoom. */
export function effectMetrics(size: number): { ring: number; glow: number; spread: number; select: number; shadow: number; outline: number } {
    const s = size > 0 ? size : 0;
    return { ring: s * RING_FACTOR, glow: s * GLOW_FACTOR, spread: s * GLOW_SPREAD_FACTOR, select: s * SELECT_GLOW_FACTOR, shadow: s * SHADOW_FACTOR, outline: s * OUTLINE_FACTOR };
}
