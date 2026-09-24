// The board's coordinate space. Everything on a board (positions are fractions 0..1, sizes, fonts, ring radii, line widths, badges ...) is defined
// in reference units: the content is laid out on a canvas REF_W units wide and the whole canvas is scaled by ONE factor to the width the board
// really has. That makes the editor, the template editor and preview and the read view show the same picture at any width — only bigger or
// smaller — and the arrangement an organiser makes in the editor is what the raiders see. Written with function declarations and one-line signatures only.

/** The reference width of the canvas in units (1 unit = 1 css px at this board width; the sizes people stored before were px on boards of about this width). */
export const REF_W = 700;

/** The scale factor of a board that is `width` px wide (0 while it is not measured yet). */
export function boardScale(width: number): number {
    return width > 0 ? width / REF_W : 0;
}

/** The reference height of a board with this aspect (width / height). */
export function refHeight(aspect: number): number {
    return REF_W / (aspect > 0 ? aspect : 16 / 10);
}

/** The css of the canvas: laid out at the reference size, scaled to the board's width and (zoom / pan of the view) enlarged and moved. `--rp-k` = the scale on screen. */
export function canvasStyle(width: number, height: number, aspect: number, z: number, ox: number, oy: number): object {
    const s = boardScale(width) * z;
    return { width: REF_W, height: refHeight(aspect), transform: `translate(${ox * width}px, ${oy * height}px) scale(${s})`, "--rp-k": String(s) };
}
