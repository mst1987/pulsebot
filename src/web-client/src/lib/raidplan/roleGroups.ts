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
export function roleNamesLayout(innerW: number, innerH: number, names: string[], iconScale: number, withIcon = true): { font: number; icon: number; shown: number; more: number; lines: number } {
    const w = innerW > 0 ? innerW : 0;
    const h = innerH > 0 ? innerH : 0;
    const font = Math.round(Math.max(4, Math.min(11.4, Math.sqrt(w * h) * 0.07)) * 10) / 10;
    // an area in the calm style carries its symbol in the badge on its edge: the names have the whole inner area (#559)
    const icon = withIcon ? Math.round(Math.max(8, Math.min(Math.min(w, h) * 0.3, 96)) * (iconScale > 0 ? iconScale : 1) * 10) / 10 : 0;
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

// ---- a role group area in the style "calm" or "arc" (#559, docs/raidplan/board.md "Role group areas: calm or arc") ----------

/** The two looks of a role group area: calm (light fill, thin outline, badge on the top edge, names inside) and arc (a ring / arc band). */
export const AREA_STYLES = ["calm", "arc"] as const;
export type AreaStyle = (typeof AREA_STYLES)[number];

type AreaZone = { shape?: string; role?: string; areaStyle?: string; arcSpan?: number; arcWidth?: number };

/** The style a role group area is drawn in: "arc" only when set (a cluster of symbols is no area and has none), else "calm" - every area stored before. */
export function areaStyleOf(z: AreaZone): AreaStyle {
    return z.areaStyle === "arc" && z.shape !== "cluster" ? "arc" : "calm";
}

/** The arc's span in whole degrees (30 .. 360; 360 = a closed ring): the one stored, else a ring for melee and tanks, a half ring for the others. */
export function arcSpanOf(z: AreaZone): number {
    const s = Number(z.arcSpan);
    if (Number.isFinite(s) && s > 0) return Math.max(30, Math.min(360, Math.round(s)));
    return z.role === "melee" || z.role === "tank" ? 360 : 180;
}

/** The band's width as a share of the smaller half axis (0.1 .. 0.8, default 0.35). */
export function arcWidthOf(z: AreaZone): number {
    const s = Number(z.arcWidth);
    return Number.isFinite(s) && s > 0 ? Math.max(0.1, Math.min(0.8, Math.round(s * 100) / 100)) : 0.35;
}

/** The badge of an area (role symbol, label, count) of `w` x `h` reference px: its font, its symbol and its height - a share of the zone, times "Symbolgroesse". */
export function areaBadgeMetrics(w: number, h: number, iconScale = 1): { font: number; icon: number; height: number } {
    const s = iconScale > 0 ? Math.max(0.25, Math.min(3, iconScale)) : 1;
    const font = Math.round(Math.max(6, Math.min(13, Math.sqrt(Math.max(0, w) * Math.max(0, h)) * 0.075)) * s * 10) / 10;
    const icon = Math.round(font * 1.6 * 10) / 10;
    return { font, icon, height: Math.round((icon + font * 0.3) * 10) / 10 };
}

/**
 * Where the badge of a CALM area sits (offset from the zone's middle, reference px): centred on the edge that lies on top - the middle of
 * the zone's own top edge while it lies straight, of whichever side is up when it is turned (a strip on its side: its upper short edge).
 * The same point for a rectangle and an ellipse (the ellipse touches its box there).
 */
export function calmBadgeAt(w: number, h: number, deg: number): { dx: number; dy: number } {
    const a = normAngle(deg || 0);
    const r = (a * Math.PI) / 180;
    // the side whose outward direction points most nearly up: top, then left / bottom / right as the zone turns past 45, 135, 225 degrees
    const k = ((Math.round(-a / 90) % 4) + 4) % 4;
    const [x, y] = [[0, -h / 2], [w / 2, 0], [0, h / 2], [-w / 2, 0]][k];
    return { dx: r2(x * Math.cos(r) - y * Math.sin(r)), dy: r2(x * Math.sin(r) + y * Math.cos(r)) };
}

/** An estimated width (reference px) of the badge: symbol, label and count. */
export function areaBadgeWidth(label: string, count: number, font: number): number {
    return font * 1.6 + nameWidth(label) * font + (count > 0 ? nameWidth(String(count)) * font : 0) + font;
}

/**
 * The band of an arc in a zone of `w` x `h` reference px: the outer ellipse is the zone's, the inner one lies `t` further in (t = arcWidth
 * of the smaller half axis), the names run on the line between them. Angles in degrees, clockwise from the right (screen y points down);
 * the arc's middle points down (90) before the zone is turned.
 */
export function arcBand(w: number, h: number, span: number, width: number): { rx: number; ry: number; irx: number; iry: number; crx: number; cry: number; t: number; a0: number; a1: number; ring: boolean } {
    const rx = Math.max(1, w / 2);
    const ry = Math.max(1, h / 2);
    const t = Math.max(1, Math.min(rx, ry) * Math.max(0.1, Math.min(0.8, width)));
    const s = Math.max(30, Math.min(360, span));
    return { rx, ry, irx: Math.max(0.5, rx - t), iry: Math.max(0.5, ry - t), crx: rx - t / 2, cry: ry - t / 2, t, a0: 90 - s / 2, a1: 90 + s / 2, ring: s >= 360 };
}

const r2 = (v: number) => Math.round(v * 100) / 100 || 0;

/** The band as an SVG path in the zone's own px (0..w, 0..h): a closed ring (two ellipses, even-odd) or an annulus sector. */
export function arcPath(w: number, h: number, span: number, width: number): string {
    const b = arcBand(w, h, span, width);
    const cx = w / 2;
    const cy = h / 2;
    const at = (rx: number, ry: number, deg: number) => { const a = (deg * Math.PI) / 180; return `${r2(cx + rx * Math.cos(a))} ${r2(cy + ry * Math.sin(a))}`; };
    if (b.ring) {
        const ell = (rx: number, ry: number) => `M ${r2(cx + rx)} ${r2(cy)} A ${r2(rx)} ${r2(ry)} 0 1 1 ${r2(cx - rx)} ${r2(cy)} A ${r2(rx)} ${r2(ry)} 0 1 1 ${r2(cx + rx)} ${r2(cy)} Z`;
        return `${ell(b.rx, b.ry)} ${ell(b.irx, b.iry)}`;
    }
    const large = b.a1 - b.a0 > 180 ? 1 : 0;
    return `M ${at(b.rx, b.ry, b.a0)} A ${r2(b.rx)} ${r2(b.ry)} 0 ${large} 1 ${at(b.rx, b.ry, b.a1)} L ${at(b.irx, b.iry, b.a1)} A ${r2(b.irx)} ${r2(b.iry)} 0 ${large} 0 ${at(b.irx, b.iry, b.a0)} Z`;
}

/** A point of an ellipse (half axes rx, ry) at `angle` degrees, as an offset from the zone's middle, turned with the zone by `deg`. */
export function arcOffset(rx: number, ry: number, angle: number, deg: number): { dx: number; dy: number } {
    const a = (angle * Math.PI) / 180;
    const r = (normAngle(deg || 0) * Math.PI) / 180;
    const x = rx * Math.cos(a);
    const y = ry * Math.sin(a);
    return { dx: r2(x * Math.cos(r) - y * Math.sin(r)), dy: r2(x * Math.sin(r) + y * Math.cos(r)) };
}

/**
 * Where the badge and the names of an arc stand (offsets from the zone's middle, reference px, upright): the badge on the outer edge - at
 * the top of a ring, in the middle of an arc - and the names as small chips along the middle of the band, spread evenly, leaving the
 * badge's place free. What does not fit is one "+N" chip at the end (never silently gone). Pure: the same in editor and sheet.
 */
export function arcLayout(w: number, h: number, span: number, width: number, deg: number, names: string[], badgeW: number): { badge: { dx: number; dy: number }; font: number; spots: { dx: number; dy: number }[]; shown: number; more: number } {
    const b = arcBand(w, h, span, width);
    const badgeAt = b.ring ? 270 : 90;
    const radius = Math.max(1, (b.crx + b.cry) / 2);
    const toDeg = (len: number) => (len / radius) * (180 / Math.PI);
    const total = b.a1 - b.a0;
    const gapDeg = Math.min(total * 0.5, toDeg(badgeW * 1.1));
    // the stretches of the band the names may use (degrees): the ring round from the badge, or the arc's two halves beside it
    const parts: [number, number][] = b.ring ? [[badgeAt + gapDeg / 2, badgeAt + 360 - gapDeg / 2]] : [[b.a0, badgeAt - gapDeg / 2], [badgeAt + gapDeg / 2, b.a1]];
    const lens = parts.map(([s, e]) => Math.max(0, ((e - s) * Math.PI * radius) / 180));
    const room = lens.reduce((a, l) => a + l, 0);
    // the font: a share of the band (at most a token name's 11.4); when the names do not fit it shrinks, down to 60 % of it, before a "+N" takes the rest
    const full = Math.max(4, Math.min(11.4, b.t * 0.42));
    const need = names.reduce((a, n) => a + nameWidth(n) + 0.6, 0);
    const font = Math.round(Math.max(Math.max(4, full * 0.6), need > 0 ? Math.min(full, room / need) : full) * 10) / 10;
    const gap = font * 0.6;
    let used = 0;
    let shown = 0;
    for (const n of names) {
        const cw = nameWidth(n) * font + gap;
        if (used + cw > room) break;
        used += cw;
        shown += 1;
    }
    if (shown < names.length) {
        const plus = nameWidth(`+${names.length}`) * font + gap;
        while (shown > 0 && used + plus > room) { shown -= 1; used -= nameWidth(names[shown]) * font + gap; }
    }
    // the chips shown (the last one "+N" when not all fit), each with its width; what is left over is shared out evenly between them
    const widths = names.slice(0, shown).map((n) => nameWidth(n) * font + gap);
    if (shown < names.length) widths.push(nameWidth(`+${names.length - shown}`) * font + gap);
    const extra = widths.length > 0 ? Math.max(0, room - widths.reduce((a, x) => a + x, 0)) / widths.length : 0;
    const spots: { dx: number; dy: number }[] = [];
    let along = 0;
    for (const cw of widths) {
        // this chip in the middle of its share of the free stretches
        let s = along + (cw + extra) / 2;
        along += cw + extra;
        let angle = parts[parts.length - 1][1];
        for (let i = 0; i < parts.length; i++) {
            if (s <= lens[i]) { angle = parts[i][0] + toDeg(s); break; }
            s -= lens[i];
        }
        spots.push(arcOffset(b.crx, b.cry, angle, deg));
    }
    return { badge: arcOffset(b.rx, b.ry, badgeAt, deg), font, spots, shown, more: names.length - shown };
}
