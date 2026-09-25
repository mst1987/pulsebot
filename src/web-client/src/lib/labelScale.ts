// The name label of a token / slot / icon scales with the icon itself: its font is a share of the icon's size (in reference units, so every scale
// that changes the icon - its own size, the group's size, the board's symbol size, the zoom - changes the label by the same factor). The only limit is
// legibility: below MIN_SCREEN_FONT px on screen the font stops shrinking, and when the label would then be wider than MAX_LABEL_RATIO icons the name is
// hidden instead (the icon is too small to carry it). Pure and tested (test/web-client/labelScale.test.js); function declarations with one-line signatures only.

/** The font of a name as a share of the icon's size: tokens, slots and group members; icons (boss, mob) whose default is bigger use a smaller share. */
export const NAME_FACTOR = 0.3;
export const ICON_NAME_FACTOR = 0.24;
/** The smallest font on screen that is still read (px), how many characters a typical name has and how wide one is (em), and the widest label in icons. */
export const MIN_SCREEN_FONT = 7;
export const TYPICAL_NAME_CHARS = 8;
export const CHAR_WIDTH = 0.55;
export const MAX_LABEL_RATIO = 2.2;

/** The label of an icon of `size` reference units on a board scaled by `screenScale` (px per unit): its font in units, whether it is shown, and whether legibility clamped it. */
export function labelMetrics(size: number, factor: number, screenScale: number): { font: number; show: boolean; clamped: boolean } {
    const font = size * factor;
    if (!(screenScale > 0) || font * screenScale >= MIN_SCREEN_FONT) return { font, show: true, clamped: false };
    const clampedFont = MIN_SCREEN_FONT / screenScale;
    return { font: clampedFont, show: TYPICAL_NAME_CHARS * CHAR_WIDTH * clampedFont <= MAX_LABEL_RATIO * size, clamped: true };
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
