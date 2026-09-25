// Selecting several objects of a board at once and acting on them together (rubber band, Ctrl/Shift click, Ctrl+A, delete,
// move, scale, duplicate, copy / paste, align, look). Pure: a board goes in, a board comes out, so every action is ONE undo step.
// Written with function declarations and one-line signatures only, so the tests can load it (test/web-client/i18nHelper.js).
import type { RaidplanBoard, RaidplanIcon, RaidplanLine, RaidplanMark, RaidplanSlot, RaidplanText, RaidplanZone } from "../api";
import { MIN_ZONE, SIZE_RANGES, clamp01, scaleArrow, duplicateObject, isLocked, isRoleKind, lookOf, moveObject, newRowId, objectPoint, patchLook, removeObject, reorderObject, objectPercent, scaleObject, setObjectPercent, setObjectSize, sizeOf, unplaceSlot, updateLine, updateZone } from "./raidplan";
import type { ObjectKind } from "./raidplan";

export type SelItem = { kind: ObjectKind; id: string };
/** A rectangle by its corners, in board fractions (0..1). */
export type Box = { x0: number; y0: number; x1: number; y1: number };
export type BoardPx = { w: number; h: number };
export type Snapshot = { marks: RaidplanMark[]; icons: RaidplanIcon[]; zones: RaidplanZone[]; lines: RaidplanLine[]; texts: RaidplanText[]; labels: RaidplanSlot[] };

/** Resizes everything selected by a factor, each relative to its own size (a group by its scale, a zone about its own middle); one edit, so one undo step. */
export function resizeSelection(board: RaidplanBoard, sel: SelItem[], factor: number): RaidplanBoard {
    let next = board;
    for (const it of sel) {
        if (it.kind === "zone") { next = scaleObject(next, "zone", it.id, factor); continue; }
        const now = objectPercent(next, it.kind, it.id);
        if (now !== null) next = setObjectPercent(next, it.kind, it.id, Math.round(now * factor));
    }
    return next;
}

export function itemKey(it: SelItem): string {
    return `${it.kind}:${it.id}`;
}

export function hasItem(sel: SelItem[], it: SelItem): boolean {
    return sel.some((x) => x.kind === it.kind && x.id === it.id);
}

/** Ctrl / Cmd + click: adds the item, or takes it out again when it is in. */
export function toggleItem(sel: SelItem[], it: SelItem): SelItem[] {
    return hasItem(sel, it) ? sel.filter((x) => !(x.kind === it.kind && x.id === it.id)) : [...sel, it];
}

/** Adds items (the rubber band with Ctrl, Shift + click): each once, the old ones first. */
export function addItems(sel: SelItem[], items: SelItem[]): SelItem[] {
    const out = sel.slice();
    for (const it of items) if (!hasItem(out, it)) out.push(it);
    return out;
}

/** The box of a rectangle dragged from one corner to another, whichever way. */
export function bandBox(ax: number, ay: number, bx: number, by: number): Box {
    return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
}

function around(x: number, y: number, halfW: number, halfH: number): Box {
    return { x0: x - halfW, y0: y - halfH, x1: x + halfW, y1: y + halfH };
}

/** Whether an object is on the map at all (a role slot that only stands in the Besetzung is not). */
function onMap(board: RaidplanBoard, it: SelItem): boolean {
    if (it.kind === "slot") {
        const s = board.slots.find((x) => x.id === it.id);
        return !!s && s.placed !== false;
    }
    return objectPoint(board, it.kind, it.id) !== null;
}

/** The box an object covers, in board fractions (a rough one for a text and a group marker). Null when it is not on the map. */
export function objectBox(board: RaidplanBoard, it: SelItem, px: BoardPx): Box | null {
    if (!onMap(board, it)) return null;
    const w = Math.max(1, px.w);
    const h = Math.max(1, px.h);
    if (it.kind === "zone") {
        const z = board.zones.find((o) => o.id === it.id);
        return z ? { x0: z.x, y0: z.y, x1: z.x + z.w, y1: z.y + z.h } : null;
    }
    if (it.kind === "line") {
        const l = board.lines.find((o) => o.id === it.id);
        if (!l) return null;
        const pad = Math.max(l.width, 6) / 2;
        return { x0: Math.min(l.x1, l.x2) - pad / w, y0: Math.min(l.y1, l.y2) - pad / h, x1: Math.max(l.x1, l.x2) + pad / w, y1: Math.max(l.y1, l.y2) + pad / h };
    }
    const at = objectPoint(board, it.kind, it.id);
    if (!at) return null;
    if (it.kind === "text") {
        const tx = board.texts.find((o) => o.id === it.id);
        const size = tx ? tx.size : SIZE_RANGES.text.def;
        const len = tx ? Math.max(2, tx.text.length) : 4;
        return around(at.x, at.y, (len * size * 0.3) / w, (size * 0.7) / h);
    }
    if (it.kind === "slot") {
        const s = board.slots.find((o) => o.id === it.id);
        if (s && s.kind === "group") return around(at.x, at.y, 40 / w, 16 / h);
    }
    const size = sizeOf(board, it.kind, it.id) || SIZE_RANGES.slot.def;
    return around(at.x, at.y, size / 2 / w, size / 2 / h);
}

function unionBox(boxes: Box[]): Box | null {
    if (boxes.length === 0) return null;
    return {
        x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)),
        x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)),
    };
}

/** The frame round the whole selection (what shows the shared box with its scale grips). */
export function selectionBox(board: RaidplanBoard, sel: SelItem[], px: BoardPx): Box | null {
    return unionBox(sel.map((it) => objectBox(board, it, px)).filter((b) => b !== null));
}

/** Every object a rubber band or Ctrl+A may take: on the map, not hidden, not locked (members of a split group are their marker's business). */
export function selectableItems(board: RaidplanBoard): SelItem[] {
    const out = [];
    for (const z of board.zones) if (!z.hidden && !z.lock) out.push({ kind: "zone", id: z.id });
    for (const l of board.lines) if (!l.hidden && !l.lock) out.push({ kind: "line", id: l.id });
    for (const m of board.marks) if (!m.hidden && !m.lock) out.push({ kind: "mark", id: m.id });
    for (const i of board.icons) if (!i.hidden && !i.lock) out.push({ kind: "icon", id: i.id });
    for (const s of board.slots) if (s.placed !== false && !s.hidden && !s.lock) out.push({ kind: "slot", id: s.id });
    for (const x of board.texts) if (!x.hidden && !x.lock) out.push({ kind: "text", id: x.id });
    for (const k of board.tokens) if (!k.hidden && !k.lock) out.push({ kind: "token", id: k.userId });
    // the objects of the tank rows where they stand now (the editor hands them over as autoAt)
    for (const key of Object.keys(board.autoAt || {})) { const s = (board.autoStyle || {})[key] || {}; if (!s.hidden && !s.lock) out.push({ kind: "auto", id: key }); }
    return out;
}

function touches(a: Box, b: Box): boolean {
    return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}

/** What a rubber band touches (touching is enough), among the selectable objects. */
export function hitObjects(board: RaidplanBoard, band: Box, px: BoardPx): SelItem[] {
    return selectableItems(board).filter((it) => {
        const b = objectBox(board, it, px);
        return !!b && touches(b, band);
    });
}

/** Items of a selection that still exist (after an undo, a delete elsewhere ...). */
export function liveItems(board: RaidplanBoard, sel: SelItem[]): SelItem[] {
    return sel.filter((it) => onMap(board, it));
}

/** Moves the whole selection by (dx, dy), as one piece: it stops at the edge instead of bending. Locked objects stay. */
export function moveSelection(board: RaidplanBoard, sel: SelItem[], dx: number, dy: number, px: BoardPx): RaidplanBoard {
    const movable = sel.filter((it) => !isLocked(board, it.kind, it.id));
    const box = selectionBox(board, movable, px);
    if (!box) return board;
    const sx = Math.max(-box.x0, Math.min(1 - box.x1, dx));
    const sy = Math.max(-box.y0, Math.min(1 - box.y1, dy));
    let out = board;
    for (const it of movable) {
        const at = objectPoint(out, it.kind, it.id);
        if (at) out = moveObject(out, it.kind, it.id, at.x + sx, at.y + sy);
    }
    return out;
}

function scaleAbout(v: number, c: number, f: number): number {
    return clamp01(c + (v - c) * f);
}

/**
 * Scales the selection by `factor` around a centre (the middle of its box): positions and sizes together — an icon's, a
 * slot's, a token's size (kept inside the range of its kind), a text's font, a line's ends and thickness, a zone's rectangle.
 */
export function scaleSelection(board: RaidplanBoard, sel: SelItem[], factor: number, center: { x: number; y: number }): RaidplanBoard {
    if (!Number.isFinite(factor) || factor <= 0) return board;
    let out = board;
    for (const it of sel) {
        if (isLocked(out, it.kind, it.id)) continue;
        if (it.kind === "zone") {
            const z = out.zones.find((o) => o.id === it.id);
            if (!z) continue;
            const w = Math.max(MIN_ZONE, Math.min(1, z.w * factor));
            const h = Math.max(MIN_ZONE, Math.min(1, z.h * factor));
            const x = Math.max(0, Math.min(1 - w, center.x + (z.x - center.x) * factor));
            const y = Math.max(0, Math.min(1 - h, center.y + (z.y - center.y) * factor));
            out = updateZone(out, it.id, { x, y, w, h });
        } else if (it.kind === "line") {
            const l = out.lines.find((o) => o.id === it.id);
            if (!l) continue;
            out = updateLine(out, it.id, { x1: scaleAbout(l.x1, center.x, factor), y1: scaleAbout(l.y1, center.y, factor), x2: scaleAbout(l.x2, center.x, factor), y2: scaleAbout(l.y2, center.y, factor) });
            out = setObjectSize(out, "line", it.id, l.width * factor);
        } else {
            const at = objectPoint(out, it.kind, it.id);
            const size = sizeOf(out, it.kind, it.id);
            if (size !== null) out = setObjectSize(out, it.kind, it.id, size * factor);
            if (at) out = moveObject(out, it.kind, it.id, scaleAbout(at.x, center.x, factor), scaleAbout(at.y, center.y, factor));
        }
    }
    return out;
}

/** Deletes the selection: free objects go, a role slot or a group marker only leaves the map (the Besetzung keeps it, its count stays), a token goes back to "Nicht platziert". Locked objects stay. */
export function deleteSelection(board: RaidplanBoard, sel: SelItem[]): RaidplanBoard {
    let out = board;
    for (const it of sel) {
        // an object of the tank rows goes with its row, never with a selection
        if (isLocked(out, it.kind, it.id) || it.kind === "auto") continue;
        if (it.kind === "slot") {
            const s = out.slots.find((o) => o.id === it.id);
            out = s && (isRoleKind(s.kind) || s.kind === "group") ? unplaceSlot(out, it.id) : removeObject(out, it.kind, it.id);
        } else {
            out = removeObject(out, it.kind, it.id);
        }
    }
    return out;
}

function isFree(board: RaidplanBoard, it: SelItem): boolean {
    if (it.kind === "mark" || it.kind === "icon" || it.kind === "zone" || it.kind === "line" || it.kind === "text") return true;
    if (it.kind === "slot") {
        const s = board.slots.find((o) => o.id === it.id);
        return !!s && s.kind === "label";
    }
    return false;
}

/** Duplicates the free objects of the selection (marks, icons, zones, lines, texts, labels). Slots of the Besetzung and players are NOT copied: the Besetzung must not grow. `skipped` counts them. */
export function duplicateSelection(board: RaidplanBoard, sel: SelItem[]): { board: RaidplanBoard; sel: SelItem[]; skipped: number } {
    let out = board;
    const made = [];
    let skipped = 0;
    for (const it of sel) {
        if (!isFree(board, it)) { skipped += 1; continue; }
        const r = duplicateObject(out, it.kind, it.id);
        out = r.board;
        if (r.sel) made.push({ kind: r.sel.kind, id: r.sel.id });
    }
    return { board: out, sel: made, skipped };
}

/** What Ctrl+C keeps: copies of the free objects of the selection (the same rule as duplicating). */
export function copySelection(board: RaidplanBoard, sel: SelItem[]): { snap: Snapshot; skipped: number } {
    const snap = { marks: [], icons: [], zones: [], lines: [], texts: [], labels: [] };
    let skipped = 0;
    for (const it of sel) {
        if (!isFree(board, it)) { skipped += 1; continue; }
        if (it.kind === "mark") snap.marks.push(board.marks.find((o) => o.id === it.id));
        else if (it.kind === "icon") snap.icons.push(board.icons.find((o) => o.id === it.id));
        else if (it.kind === "zone") snap.zones.push(board.zones.find((o) => o.id === it.id));
        else if (it.kind === "line") snap.lines.push(board.lines.find((o) => o.id === it.id));
        else if (it.kind === "text") snap.texts.push(board.texts.find((o) => o.id === it.id));
        else snap.labels.push(board.slots.find((o) => o.id === it.id));
    }
    return { snap, skipped };
}

/** Ctrl+V: puts the copies on the board a little off (`off` grows with every paste), with new ids, unlocked; returns the new selection. */
export function pasteSnapshot(board: RaidplanBoard, snap: Snapshot, off: number): { board: RaidplanBoard; sel: SelItem[] } {
    const made = [];
    const out = { ...board };
    const move = (v) => clamp01(v + off);
    out.marks = [...board.marks, ...snap.marks.filter(Boolean).map((o) => { const id = newRowId(); made.push({ kind: "mark", id }); return { ...o, id, lock: false, hidden: false, x: move(o.x), y: move(o.y) }; })];
    out.icons = [...board.icons, ...snap.icons.filter(Boolean).map((o) => { const id = newRowId(); made.push({ kind: "icon", id }); return { ...o, id, lock: false, hidden: false, x: move(o.x), y: move(o.y) }; })];
    out.texts = [...board.texts, ...snap.texts.filter(Boolean).map((o) => { const id = newRowId(); made.push({ kind: "text", id }); return { ...o, id, lock: false, hidden: false, x: move(o.x), y: move(o.y) }; })];
    out.zones = [...board.zones, ...snap.zones.filter(Boolean).map((o) => {
        const id = newRowId();
        made.push({ kind: "zone", id });
        const x = Math.max(0, Math.min(1 - o.w, o.x + off));
        const y = Math.max(0, Math.min(1 - o.h, o.y + off));
        return { ...o, id, lock: false, hidden: false, x, y };
    })];
    out.lines = [...board.lines, ...snap.lines.filter(Boolean).map((o) => {
        const id = newRowId();
        made.push({ kind: "line", id });
        const sx = Math.max(-Math.min(o.x1, o.x2), Math.min(1 - Math.max(o.x1, o.x2), off));
        const sy = Math.max(-Math.min(o.y1, o.y2), Math.min(1 - Math.max(o.y1, o.y2), off));
        return { ...o, id, lock: false, hidden: false, x1: o.x1 + sx, y1: o.y1 + sy, x2: o.x2 + sx, y2: o.y2 + sy };
    })];
    // a label (free text slot) is a slot of kind "label": it gets the next free number
    let next = Math.max(0, ...board.slots.filter((s) => s.kind === "label").map((s) => s.n));
    out.slots = [...board.slots, ...snap.labels.filter(Boolean).map((o) => { const id = newRowId(); next += 1; made.push({ kind: "slot", id }); return { ...o, id, n: next, userId: "", offsets: {}, lock: false, hidden: false, x: move(o.x), y: move(o.y) }; })];
    return { board: out, sel: made };
}

/** Ways to line the selection up. */
export const ALIGN_MODES = ["left", "right", "top", "bottom", "centerH", "centerV", "distH", "distV"];

/** Lines the selection up on the box's edge or middle, or spreads it evenly (distH / distV need three or more). Locked objects stay. */
export function alignSelection(board: RaidplanBoard, sel: SelItem[], mode: string, px: BoardPx): RaidplanBoard {
    const rows = sel.filter((it) => !isLocked(board, it.kind, it.id)).map((it) => ({ it, box: objectBox(board, it, px) })).filter((r) => r.box !== null);
    if (rows.length < 2) return board;
    const all = unionBox(rows.map((r) => r.box));
    const shift = new Map();
    for (const r of rows) {
        const b = r.box;
        let dx = 0;
        let dy = 0;
        if (mode === "left") dx = all.x0 - b.x0;
        else if (mode === "right") dx = all.x1 - b.x1;
        else if (mode === "top") dy = all.y0 - b.y0;
        else if (mode === "bottom") dy = all.y1 - b.y1;
        else if (mode === "centerH") dx = (all.x0 + all.x1) / 2 - (b.x0 + b.x1) / 2;
        else if (mode === "centerV") dy = (all.y0 + all.y1) / 2 - (b.y0 + b.y1) / 2;
        shift.set(itemKey(r.it), { dx, dy });
    }
    if ((mode === "distH" || mode === "distV") && rows.length >= 3) {
        const horiz = mode === "distH";
        const sorted = rows.slice().sort((a, b) => (horiz ? a.box.x0 + a.box.x1 - b.box.x0 - b.box.x1 : a.box.y0 + a.box.y1 - b.box.y0 - b.box.y1));
        const first = sorted[0].box;
        const last = sorted[sorted.length - 1].box;
        const span = horiz ? last.x1 - first.x0 : last.y1 - first.y0;
        const sizes = sorted.reduce((sum, r) => sum + (horiz ? r.box.x1 - r.box.x0 : r.box.y1 - r.box.y0), 0);
        const gap = (span - sizes) / (sorted.length - 1);
        let cursor = horiz ? first.x0 : first.y0;
        for (const r of sorted) {
            const start = horiz ? r.box.x0 : r.box.y0;
            shift.set(itemKey(r.it), horiz ? { dx: cursor - start, dy: 0 } : { dx: 0, dy: cursor - start });
            cursor += (horiz ? r.box.x1 - r.box.x0 : r.box.y1 - r.box.y0) + gap;
        }
    }
    let out = board;
    for (const r of rows) {
        const s = shift.get(itemKey(r.it));
        const at = objectPoint(out, r.it.kind, r.it.id);
        if (s && at && (s.dx !== 0 || s.dy !== 0)) out = moveObject(out, r.it.kind, r.it.id, at.x + s.dx, at.y + s.dy);
    }
    return out;
}

/** Opacity, lock or hidden of every object of the selection. */
export function setLookSelection(board: RaidplanBoard, sel: SelItem[], patch: { opacity?: number; lock?: boolean; hidden?: boolean }): RaidplanBoard {
    let out = board;
    for (const it of sel) out = patchLook(out, it.kind, it.id, patch);
    return out;
}

/** The wedges of every icon of the selection, each relative to its own size ("Pfeil größer / kleiner" on several at once); anything else stays. */
export function scaleArrowSelection(board: RaidplanBoard, sel: SelItem[], factor: number): RaidplanBoard {
    let out = board;
    for (const it of sel) out = scaleArrow(out, it.kind, it.id, factor);
    return out;
}

/** The rings of the group markers of the selection: shown or hidden (everything else in it is left alone). */
export function setRingSelection(board: RaidplanBoard, sel: SelItem[], show: boolean): RaidplanBoard {
    const ids = sel.filter((it) => it.kind === "slot").map((it) => it.id);
    return { ...board, slots: board.slots.map((s) => (s.kind === "group" && ids.indexOf(s.id) >= 0 ? { ...s, showRing: show } : s)) };
}

/** Puts the selection in front of or behind the rest of its layer; the order among them stays. */
export function reorderSelection(board: RaidplanBoard, sel: SelItem[], dir: string): RaidplanBoard {
    let out = board;
    const order = dir === "front" ? sel : sel.slice().reverse();
    for (const it of order) out = reorderObject(out, it.kind, it.id, dir);
    return out;
}

/** What the selection has in common: a value, or null where it differs ("gemischt"). */
export function lookSummary(board: RaidplanBoard, sel: SelItem[]): { opacity: number | null; lock: boolean | null; hidden: boolean | null } {
    const looks = sel.map((it) => lookOf(board, it.kind, it.id)).filter((l) => l !== null);
    if (looks.length === 0) return { opacity: null, lock: null, hidden: null };
    const same = (pick) => (looks.every((l) => pick(l) === pick(looks[0])) ? pick(looks[0]) : null);
    return { opacity: same((l) => l.opacity), lock: same((l) => l.lock), hidden: same((l) => l.hidden) };
}
