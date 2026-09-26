import { normAngle } from "./facing";
import { clamp01, MIN_ZONE, type Rect, type ZoneGrip } from "./model";

// ---- role groups ("Melees" ...) and group chips: sizes derived from the object itself (feature/raidplan-15) ----

/**
 * The measures of a role group placeholder of `w` x `h` reference px (its zone): the icon (one, unscaled circle in the middle - a cluster:
 * several, smaller), the outline width, the fonts of its label and count, and the font of the names listed under it. All shares of the
 * zone's smaller side, so the whole placeholder scales as one piece with the zone - and with the zoom like everything on the canvas.
 */
export function roleZoneMetrics(w: number, h: number, cluster: boolean, count: number): { unit: number; icon: number; border: number; label: number; badge: number; names: number } {
    const unit = Math.max(8, Math.min(w > 0 ? w : 0, h > 0 ? h : 0));
    const n = cluster ? Math.max(3, Math.min(8, count || 5)) : 1;
    const icon = cluster ? Math.max(8, Math.min(unit * 0.42, Math.sqrt((w * h) / n) * 0.62)) : Math.max(10, Math.min(unit * 0.45, 96));
    return {
        unit,
        icon: Math.round(icon * 10) / 10,
        border: Math.round(Math.max(1, Math.min(4, unit * 0.025)) * 10) / 10,
        // the label goes by the area like the names, a little bigger than them (at most 12)
        label: Math.round(Math.max(6, Math.min(12, Math.sqrt(Math.max(0, w) * Math.max(0, h)) * 0.085)) * 10) / 10,
        badge: Math.round(Math.max(6, Math.min(16, unit * 0.13)) * 10) / 10,
        // the names go by the zone's area (a narrow strip still carries readable names), at most a token name's size
        names: Math.round(Math.max(4, Math.min(11.4, Math.sqrt(Math.max(0, w) * Math.max(0, h)) * 0.085)) * 10) / 10,
    };
}

/** The width a group chip is drawn with (reference px): the one set for it (60 .. 400), else "auto" (as wide as its longest name, up to 220). */
export function chipWidthOf(slot: { chipWidth?: number }): number {
    const w = Number(slot.chipWidth);
    return Number.isFinite(w) && w > 0 ? Math.max(60, Math.min(400, Math.round(w))) : 0;
}

// ---- a role group turned, with its names inside (feature/raidplan-16) -------------------------------------------------------

/** The upright box (reference px) a rectangle of `w` x `h` covers when it is turned by `deg` about its middle. */
export function turnedBox(w: number, h: number, deg: number, shape = "rect"): { w: number; h: number } {
    const a = (normAngle(deg || 0) * Math.PI) / 180;
    const c = Math.abs(Math.cos(a));
    const s = Math.abs(Math.sin(a));
    // an ellipse covers less than its rectangle when it is turned
    if (shape === "ellipse") return { w: 2 * Math.sqrt((w / 2) ** 2 * c * c + (h / 2) ** 2 * s * s), h: 2 * Math.sqrt((w / 2) ** 2 * s * s + (h / 2) ** 2 * c * c) };
    return { w: w * c + h * s, h: w * s + h * c };
}

/**
 * The upright area inside a turned rectangle that holds its content (symbol, names): the rectangle itself when it lies straight, with
 * width and height swapped when it stands on its side (45 .. 135 degrees), and the square of its smaller side when it is turned diagonally
 * (a little less, so the corners stay free). The content never turns with the zone: it stays readable.
 */
export function uprightInner(w: number, h: number, deg: number, shape = "rect"): { w: number; h: number } {
    // an ellipse holds the rectangle inscribed in it (1 / sqrt 2 of each side), so nothing lies outside its outline
    if (shape === "ellipse") { const e = uprightInner(w * 0.7, h * 0.7, deg, "rect"); return e; }
    const a = normAngle(deg || 0) % 180;
    const near = Math.min(Math.abs(a), Math.abs(a - 90), Math.abs(180 - a));
    if (near <= 15) return a > 45 && a < 135 ? { w: h, h: w } : { w, h };
    const side = Math.min(w, h) * 0.78;
    return { w: side, h: side };
}

/** An estimated width (in fonts) of a name as a small chip: its letters and the chip's padding. */
function nameWidth(name: string): number {
    return Math.max(2, String(name || "").length) * 0.56 + 1;
}

/**
 * How the names of a role group fit INSIDE it (reference px): their font (a share of the area, at most a token name's 11.4), the symbol
 * above them (smaller than without names), and how many of them fit - the rest is one "+N" chip (never cut without a hint). The names are
 * packed in lines of the inner width, in their order; a name is never split. Pure: the same for the editor and the sheet.
 */
export function roleNamesLayout(innerW: number, innerH: number, names: string[], iconScale: number): { font: number; icon: number; shown: number; more: number; lines: number } {
    const w = innerW > 0 ? innerW : 0;
    const h = innerH > 0 ? innerH : 0;
    const font = Math.round(Math.max(4, Math.min(11.4, Math.sqrt(w * h) * 0.07)) * 10) / 10;
    const icon = Math.round(Math.max(8, Math.min(Math.min(w, h) * 0.3, 96)) * (iconScale > 0 ? iconScale : 1) * 10) / 10;
    const lineH = font * 1.55;
    const room = Math.max(0, h - icon - font * 0.8);
    const maxLines = Math.max(0, Math.floor(room / lineH));
    const usable = w * 0.92;
    const gap = font * 0.35;
    // pack the names line by line; the last line keeps room for a "+N" chip when not all fit
    let line = 1;
    let x = 0;
    let shown = 0;
    for (let i = 0; i < names.length; i++) {
        const nw = nameWidth(names[i]) * font;
        const next = x === 0 ? nw : x + gap + nw;
        if (next <= usable) { x = next; shown += 1; continue; }
        if (line + 1 > maxLines) break;
        line += 1;
        x = nw;
        shown += 1;
    }
    if (maxLines === 0) shown = 0;
    if (shown < names.length && shown > 0) {
        // room for the "+N" chip on the last line: drop names from the end until it fits
        const plus = nameWidth(`+${names.length}`) * font;
        while (shown > 0 && x + gap + plus > usable) {
            shown -= 1;
            x = Math.max(0, x - gap - nameWidth(names[shown]) * font);
        }
    }
    return { font, icon, shown, more: names.length - shown, lines: maxLines === 0 ? 0 : line };
}

/**
 * A turned zone resized by one of its grips: the pointer's move (board px `dx`, `dy`) read along the zone's own axes, and the opposite
 * side kept where it is on the board. `start` is in board fractions of a board of `bw` x `bh` px; returns the new fractions (x / y
 * are still the upright corner the zone is drawn from before it is turned about its middle).
 */
export function resizeTurned(start: Rect, grip: ZoneGrip, dx: number, dy: number, deg: number, bw: number, bh: number): Rect {
    if (!(bw > 0) || !(bh > 0)) return start;
    const a = (normAngle(deg || 0) * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // the move along the zone's own axes (px)
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const w0 = start.w * bw;
    const h0 = start.h * bh;
    let left = -w0 / 2;
    let right = w0 / 2;
    let top = -h0 / 2;
    let bottom = h0 / 2;
    const minW = MIN_ZONE * bw;
    const minH = MIN_ZONE * bh;
    if (grip === "nw" || grip === "sw" || grip === "w") left = Math.min(left + lx, right - minW);
    if (grip === "ne" || grip === "se" || grip === "e") right = Math.max(right + lx, left + minW);
    if (grip === "nw" || grip === "ne" || grip === "n") top = Math.min(top + ly, bottom - minH);
    if (grip === "sw" || grip === "se" || grip === "s") bottom = Math.max(bottom + ly, top + minH);
    // the new middle in the zone's frame, turned back onto the board
    const mx = (left + right) / 2;
    const my = (top + bottom) / 2;
    const cx = start.x * bw + w0 / 2 + mx * cos - my * sin;
    const cy = start.y * bh + h0 / 2 + mx * sin + my * cos;
    const w = Math.min(bw, right - left);
    const h = Math.min(bh, bottom - top);
    return { x: clamp01((cx - w / 2) / bw), y: clamp01((cy - h / 2) / bh), w: w / bw, h: h / bh };
}
