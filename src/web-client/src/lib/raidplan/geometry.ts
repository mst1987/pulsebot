import type { RaidplanBoard } from "../../api";
import { clamp01, clampOpacity, MIN_ZONE, type ObjectKind, type Rect, SCALE_MAX, SCALE_MIN, SIZE_RANGES, type ZoneGrip } from "./model";
import { isLocked, patchIn, updateIcon, updateLine, updateSlot, updateText, updateZone } from "./objects";
import { autoRange, autoStyleOf, patchAutoStyle } from "./autoStyle";
import { parseMemberId, placeToken } from "./players";

/** The default size of tokens, slots, marks and icons of a board, 0.5..2 (1 = as is). */
export function setObjectScale(board: RaidplanBoard, value: number): RaidplanBoard {
    if (!Number.isFinite(value)) return { ...board, objectScale: 1 };
    return { ...board, objectScale: Math.max(SCALE_MIN, Math.min(SCALE_MAX, Math.round(value * 100) / 100)) };
}

/** How strongly the map shows (0.1..1). */
export function setMapOpacity(board: RaidplanBoard, value: number): RaidplanBoard {
    return { ...board, mapOpacity: clampOpacity(value, 1) };
}

/** A zone's rectangle after a resize by one corner: the opposite corner stays, the size never drops below the minimum, the zone stays on the board. */
export function resizeRect(start: Rect, corner: ZoneGrip, dx: number, dy: number): Rect {
    let left = start.x;
    let top = start.y;
    let right = start.x + start.w;
    let bottom = start.y + start.h;
    // a corner moves two sides, an edge's middle ("n", "e", "s", "w") only its own
    if (corner === "nw" || corner === "sw" || corner === "w") left = Math.min(clamp01(start.x + dx), right - MIN_ZONE);
    if (corner === "ne" || corner === "se" || corner === "e") right = Math.max(clamp01(start.x + start.w + dx), left + MIN_ZONE);
    if (corner === "nw" || corner === "ne" || corner === "n") top = Math.min(clamp01(start.y + dy), bottom - MIN_ZONE);
    if (corner === "sw" || corner === "se" || corner === "s") bottom = Math.max(clamp01(start.y + start.h + dy), top + MIN_ZONE);
    return { x: left, y: top, w: right - left, h: bottom - top };
}

/** A zone's rectangle after moving it, kept on the board. */
export function moveRect(start: Rect, dx: number, dy: number): Rect {
    return {
        x: Math.max(0, Math.min(1 - start.w, start.x + dx)),
        y: Math.max(0, Math.min(1 - start.h, start.y + dy)),
        w: start.w,
        h: start.h,
    };
}

/** A line moved by (dx, dy); both ends stay on the board, so it slides along the edge instead of bending. */
export function moveLine(line: { x1: number; y1: number; x2: number; y2: number }, dx: number, dy: number): { x1: number; y1: number; x2: number; y2: number } {
    const sx = Math.max(-Math.min(line.x1, line.x2), Math.min(1 - Math.max(line.x1, line.x2), dx));
    const sy = Math.max(-Math.min(line.y1, line.y2), Math.min(1 - Math.max(line.y1, line.y2), dy));
    return { x1: line.x1 + sx, y1: line.y1 + sy, x2: line.x2 + sx, y2: line.y2 + sy };
}

/** Moves one end of a line (1 = start, 2 = end). */
export function moveLineEnd(board: RaidplanBoard, id: string, end: number, x: number, y: number): RaidplanBoard {
    if (isLocked(board, "line", id)) return board;
    return updateLine(board, id, end === 1 ? { x1: clamp01(x), y1: clamp01(y) } : { x2: clamp01(x), y2: clamp01(y) });
}

/** Moves an object's anchor to x/y (0..1): a token, slot, mark or text by its point, a line by its middle, a zone by its top-left corner. A locked object stays. */
export function moveObject(board: RaidplanBoard, kind: ObjectKind, id: string, x: number, y: number): RaidplanBoard {
    // an object the tank rows put on the map: only where it was moved to is stored
    if (kind === "auto" && autoStyleOf(board, id).lock) return board;
    if (kind === "auto") return { ...board, autoPos: { ...(board.autoPos || {}), [id]: { x: Math.round(clamp01(x) * 10000) / 10000, y: Math.round(clamp01(y) * 10000) / 10000 } } };
    if (isLocked(board, kind, id)) return board;
    if (kind === "token") return placeToken(board, id, x, y);
    if (kind === "slot") return { ...board, slots: patchIn(board.slots, (s) => s.id === id, { x: clamp01(x), y: clamp01(y) }) };
    if (kind === "mark") return { ...board, marks: patchIn(board.marks, (m) => m.id === id, { x: clamp01(x), y: clamp01(y) }) };
    if (kind === "icon") return { ...board, icons: patchIn(board.icons, (m) => m.id === id, { x: clamp01(x), y: clamp01(y) }) };
    if (kind === "member") {
        // a raider of a split group moved on his own: his place is kept relative to the marker, so the group still moves along with it
        const ref = parseMemberId(id);
        const slot = board.slots.find((k) => k.id === ref.slotId);
        if (!slot) return board;
        const old = slot.offsets[ref.userId] || { dx: 0, dy: 0, size: SIZE_RANGES.member.def };
        // stored relative to the marker in units of the group's spacing, so the group's scale moves the whole ring
        const k = groupSpread(slot);
        const offsets = { ...slot.offsets, [ref.userId]: { ...old, dx: Math.max(-1, Math.min(1, (x - slot.x) / k)), dy: Math.max(-1, Math.min(1, (y - slot.y) / k)) } };
        return updateSlot(board, ref.slotId, { offsets });
    }
    if (kind === "text") return { ...board, texts: patchIn(board.texts, (o) => o.id === id, { x: clamp01(x), y: clamp01(y) }) };
    if (kind === "line") {
        const l = board.lines.find((o) => o.id === id);
        return l ? updateLine(board, id, moveLine(l, x - (l.x1 + l.x2) / 2, y - (l.y1 + l.y2) / 2)) : board;
    }
    return { ...board, zones: board.zones.map((z) => (z.id === id ? { ...z, ...moveRect(z, x - z.x, y - z.y) } : z)) };
}

/** The anchor of an object (a point object's point, a line's middle, a zone's top-left corner), or null when it is gone. */
export function objectPoint(board: RaidplanBoard, kind: ObjectKind, id: string): { x: number; y: number } | null {
    // where it stands now (the editor hands the derived places over as autoAt), else where it was moved to
    if (kind === "auto") return board.autoAt && board.autoAt[id] ? board.autoAt[id] : board.autoPos && board.autoPos[id] ? board.autoPos[id] : null;
    if (kind === "line") {
        const l = board.lines.find((o) => o.id === id);
        return l ? { x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 } : null;
    }
    if (kind === "member") {
        const ref = parseMemberId(id);
        const slot = board.slots.find((k) => k.id === ref.slotId);
        const off = slot ? slot.offsets[ref.userId] : undefined;
        return slot && off ? { x: slot.x + off.dx * groupSpread(slot), y: slot.y + off.dy * groupSpread(slot) } : null;
    }
    const list = kind === "token" ? board.tokens.filter((k) => k.userId === id)
        : kind === "slot" ? board.slots.filter((s) => s.id === id)
            : kind === "mark" ? board.marks.filter((m) => m.id === id)
                : kind === "icon" ? board.icons.filter((m) => m.id === id)
                    : kind === "text" ? board.texts.filter((x) => x.id === id)
                        : board.zones.filter((z) => z.id === id);
    return list[0] ? { x: list[0].x, y: list[0].y } : null;
}

/** Moves an object by a step (arrow keys), staying inside the board. */
export function nudgeObject(board: RaidplanBoard, kind: ObjectKind, id: string, dx: number, dy: number): RaidplanBoard {
    const at = objectPoint(board, kind, id);
    if (!at) return board;
    return moveObject(board, kind, id, at.x + dx, at.y + dy);
}

/** How big an object is: px for a token, slot, mark, icon, the font size of a text, the thickness of a line; null for a zone (it has a width and a height). */
export function sizeOf(board: RaidplanBoard, kind: ObjectKind, id: string): number | null {
    if (kind === "auto") return autoStyleOf(board, id).size || autoRange(id).def;
    if (kind === "token") { const o = board.tokens.find((k) => k.userId === id); return o ? o.size || SIZE_RANGES.token.def : null; }
    if (kind === "slot") { const o = board.slots.find((k) => k.id === id); return o ? o.size || SIZE_RANGES.slot.def : null; }
    if (kind === "mark") { const o = board.marks.find((k) => k.id === id); return o ? o.size || SIZE_RANGES.mark.def : null; }
    if (kind === "icon") { const o = board.icons.find((k) => k.id === id); return o ? o.size || SIZE_RANGES.icon.def : null; }
    if (kind === "text") { const o = board.texts.find((k) => k.id === id); return o ? o.size : null; }
    if (kind === "line") { const o = board.lines.find((k) => k.id === id); return o ? o.width : null; }
    if (kind === "member") {
        const ref = parseMemberId(id);
        const slot = board.slots.find((k) => k.id === ref.slotId);
        const off = slot ? slot.offsets[ref.userId] : undefined;
        return slot ? (off && off.size) || slot.size || SIZE_RANGES.member.def : null;
    }
    return null;
}

/** A scale factor kept between 25 % and 400 % (two decimals); 1 when it is not a number. */
export function clampFactor(v: number): number {
    return Number.isFinite(v) ? Math.max(0.25, Math.min(4, Math.round(v * 100) / 100)) : 1;
}

/** The three scales of a group (whole, ring spacing, member tokens): each 0.25 .. 4, 1 when missing. */
export function groupScales(s: { groupScale?: number; ringSpread?: number; tokenScale?: number }): { gs: number; sp: number; ts: number } {
    return { gs: clampFactor(s.groupScale === undefined ? 1 : s.groupScale), sp: clampFactor(s.ringSpread === undefined ? 1 : s.ringSpread), ts: clampFactor(s.tokenScale === undefined ? 1 : s.tokenScale) };
}

/** How far a group's members stand from its marker relative to what is stored: the whole scale times the ring spacing. */
export function groupSpread(s: { groupScale?: number; ringSpread?: number; tokenScale?: number }): number {
    const g = groupScales(s);
    return g.gs * g.sp;
}

/** The size steps of the context menu (percent of the default). */
export const SIZE_STEPS = [50, 75, 100, 125, 150, 200];

/** A size in reference units as percent of the default of its kind, and back (the range of the kind is applied by setObjectSize). */
export function sizePct(size: number, def: number): number {
    return Math.round((size / def) * 100);
}

export function pctSize(pct: number, def: number): number {
    return Math.round((def * pct) / 100);
}

/** Sets a group's own scales (each clamped 25 % .. 400 %); a locked group keeps them. */
export function setGroupScale(board: RaidplanBoard, slotId: string, patch: { groupScale?: number; ringSpread?: number; tokenScale?: number }): RaidplanBoard {
    const s = board.slots.find((x) => x.id === slotId);
    if (!s || s.kind !== "group" || s.lock) return board;
    const next = {};
    for (const k of Object.keys(patch)) next[k] = clampFactor(patch[k]);
    return updateSlot(board, slotId, next);
}

/** Scales the given groups by a factor, each relative to its own scale (a group keeps its proportion to the others). */
export function scaleGroups(board: RaidplanBoard, slotIds: string[], factor: number): RaidplanBoard {
    return { ...board, slots: board.slots.map((s) => (s.kind === "group" && !s.lock && slotIds.indexOf(s.id) >= 0 ? { ...s, groupScale: clampFactor(groupScales(s).gs * factor) } : s)) };
}

/** Gives every group the same scale. */
export function setAllGroupScale(board: RaidplanBoard, value: number): RaidplanBoard {
    return { ...board, slots: board.slots.map((s) => (s.kind === "group" && !s.lock ? { ...s, groupScale: clampFactor(value) } : s)) };
}

/** An object's size as percent of the default of its kind: a group as a whole (its scale), every other point object its size, a text its font, a line its thickness. */
export function objectPercent(board: RaidplanBoard, kind: ObjectKind, id: string): number | null {
    if (kind === "zone") return null;
    if (kind === "slot") {
        const s = board.slots.find((x) => x.id === id);
        if (s && s.kind === "group") return Math.round(groupScales(s).gs * 100);
    }
    const size = sizeOf(board, kind, id);
    return size === null ? null : sizePct(size, kind === "auto" ? autoRange(id).def : SIZE_RANGES[kind].def);
}

/** Sets that percent (25 % .. 400 %): a group scales as a whole, the rest by size. A zone is scaled relative by scaleObject(). */
export function setObjectPercent(board: RaidplanBoard, kind: ObjectKind, id: string, pct: number): RaidplanBoard {
    if (!Number.isFinite(pct) || kind === "zone") return board;
    if (kind === "slot") {
        const s = board.slots.find((x) => x.id === id);
        if (s && s.kind === "group") return setGroupScale(board, id, { groupScale: pct / 100 });
    }
    return setObjectSize(board, kind, id, pctSize(Math.max(25, Math.min(400, pct)), kind === "auto" ? autoRange(id).def : SIZE_RANGES[kind].def));
}

/** Sets an object's size, kept inside the range of its kind. A locked object keeps its size. A zone is scaled by scaleObject(). */
export function setObjectSize(board: RaidplanBoard, kind: ObjectKind, id: string, value: number): RaidplanBoard {
    if (!Number.isFinite(value) || kind === "zone" || isLocked(board, kind, id)) return board;
    if (kind === "auto") { const ar = autoRange(id); return patchAutoStyle(board, id, { size: Math.max(ar.min, Math.min(ar.max, Math.round(value))) }); }
    const r = SIZE_RANGES[kind];
    const size = Math.max(r.min, Math.min(r.max, Math.round(value)));
    if (kind === "token") return { ...board, tokens: patchIn(board.tokens, (o) => o.userId === id, { size }) };
    if (kind === "slot") return updateSlot(board, id, { size });
    if (kind === "mark") return { ...board, marks: patchIn(board.marks, (o) => o.id === id, { size }) };
    if (kind === "icon") return updateIcon(board, id, { size });
    if (kind === "text") return updateText(board, id, { size });
    if (kind === "line") return updateLine(board, id, { width: size });
    const ref = parseMemberId(id);
    const slot = board.slots.find((k) => k.id === ref.slotId);
    if (!slot) return board;
    const old = slot.offsets[ref.userId] || { dx: 0, dy: 0, size: slot.size || SIZE_RANGES.member.def };
    return updateSlot(board, ref.slotId, { offsets: { ...slot.offsets, [ref.userId]: { ...old, size } } });
}

/** Makes an object bigger (factor > 1) or smaller: a zone around its centre, everything else by its size. */
export function scaleObject(board: RaidplanBoard, kind: ObjectKind, id: string, factor: number): RaidplanBoard {
    if (kind === "zone") {
        const z = board.zones.find((o) => o.id === id);
        if (!z || z.lock || !Number.isFinite(factor)) return board;
        const w = Math.max(MIN_ZONE, Math.min(1, z.w * factor));
        const h = Math.max(MIN_ZONE, Math.min(1, z.h * factor));
        return updateZone(board, id, { w, h, x: Math.max(0, Math.min(1 - w, z.x + (z.w - w) / 2)), y: Math.max(0, Math.min(1 - h, z.y + (z.h - h) / 2)) });
    }
    const size = sizeOf(board, kind, id);
    return size === null ? board : setObjectSize(board, kind, id, size * factor);
}
