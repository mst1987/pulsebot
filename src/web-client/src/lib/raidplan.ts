// The raid plan's board logic (docs/raidplan.md), pure: what a board looks like
// when nothing is stored, who is not placed yet, adding / moving / scaling /
// duplicating / ordering / locking / removing board objects (player tokens,
// slots, marks, zones, lines, texts), the right-click menu's items and what they
// do, undo/redo, applying a tactic profile, grouping profiles for the picker. The
// server checks and cleans every save again; these rules keep the page consistent
// while the orga works.
//
// Written to be strippable like setupEditor.ts (test/web-client/raidplan.test.js
// runs it for real, with `t` injected): imports, `export type`, `export const`
// tables and one-line signatures only, no typed locals or casts inside a body.
import type {
    RaidplanBoard, RaidplanLook, RaidplanPlayer, RaidplanProfile, RaidplanSlot, RaidplanSlotKind, RaidplanTarget, RaidplanZone, RaidplanZoneType,
    RaidplanMarkName, RaidplanLine, RaidplanText,
} from "../api";
import { t } from "../i18n";

export const RAID_MARKS = ["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"];
export const ZONE_TYPES = ["danger", "healthy", "neutral", "custom"];
// What a new zone of a type starts with; the orga may pick any colour.
export const ZONE_COLORS = { danger: "#ef4444", healthy: "#22c55e", neutral: "#60a5fa", custom: "#a78bfa" };
export const MIN_ZONE = 0.03;
export const DEFAULT_LINE_COLOR = "#f8fafc";
export const DEFAULT_TEXT_COLOR = "#f8fafc";
const MAX_HISTORY = 100;

/** The kinds of board objects one can select, move and delete. */
export type ObjectKind = "token" | "slot" | "mark" | "zone" | "line" | "text";
export type Selection = { kind: ObjectKind; id: string } | null;
export type Rect = { x: number; y: number; w: number; h: number };
export type Corner = "nw" | "ne" | "sw" | "se";
/** What a palette entry, a tool bar button or a context-menu entry inserts. */
export type InsertSpec =
    | { type: "slot"; kind: RaidplanSlotKind; label: string }
    | { type: "mark"; mark: string }
    | { type: "zone"; zoneType: string; shape: string }
    | { type: "line"; kind: string }
    | { type: "text"; text: string };
export type MenuItem = { id: string; section: string; disabled: boolean; danger: boolean };
export type LayerRow = { kind: ObjectKind; id: string; name: string; lock: boolean; hidden: boolean };
export type History<T> = { past: T[]; present: T; future: T[] };

/** The role's colour family: tank blue, healer cyan, everything else (melee, ranged, dps) orange. */
export function roleTone(role: string): "tank" | "healer" | "dps" {
    if (role === "tank") return "tank";
    if (role === "healer") return "healer";
    return "dps";
}

export function clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

/** An opacity from an input: 0.1..1, anything else as `fallback`. */
export function clampOpacity(n: number, fallback: number): number {
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0.1, Math.min(1, Math.round(n * 100) / 100));
}

/** A fresh id for a target row or a board object (the server keeps it, or replaces an unusable one). */
export function newRowId(): string {
    return `r${Math.random().toString(36).slice(2, 9)}`;
}

/** The look a new object starts with. */
export function newLook(opacity: number): RaidplanLook {
    return { opacity, lock: false, hidden: false };
}

/** A board with nothing on it. */
export function emptyBoard(): RaidplanBoard {
    return { tokens: [], slots: [], marks: [], zones: [], lines: [], texts: [], targets: [], notes: "", profileId: "", mapOpacity: 1 };
}

/** The stored board of a boss, completed — a boss nobody touched has none. */
export function boardOf(bosses: Record<string, Partial<RaidplanBoard>>, key: string): RaidplanBoard {
    const b = bosses[key] || {};
    return {
        tokens: b.tokens || [],
        slots: b.slots || [],
        marks: b.marks || [],
        zones: b.zones || [],
        lines: b.lines || [],
        texts: b.texts || [],
        targets: b.targets || [],
        notes: b.notes || "",
        profileId: b.profileId || "",
        mapOpacity: b.mapOpacity || 1,
    };
}

/** The bosses of a plan with one board replaced. */
export function withBoard(bosses: Record<string, Partial<RaidplanBoard>>, key: string, board: RaidplanBoard): Record<string, Partial<RaidplanBoard>> {
    return { ...bosses, [key]: board };
}

/** What the save request carries: every touched board complete, an untouched one left out. */
export function toSave(bosses: Record<string, Partial<RaidplanBoard>>, bossKeys: string[]): Record<string, RaidplanBoard> {
    const out = {};
    for (const key of bossKeys) {
        if (!bosses[key]) continue;
        out[key] = boardOf(bosses, key);
    }
    return out;
}

/** Whether two plans' bosses differ in what a save would carry. */
export function sameBosses(a: Record<string, Partial<RaidplanBoard>>, b: Record<string, Partial<RaidplanBoard>>, bossKeys: string[]): boolean {
    return JSON.stringify(toSave(a, bossKeys)) === JSON.stringify(toSave(b, bossKeys));
}

// ---- who stands where ------------------------------------------------------------------

/** Everyone who already stands somewhere on the board: a free token or a slot. */
export function placedIds(board: RaidplanBoard): Set<string> {
    const ids = new Set(board.tokens.map((x) => x.userId));
    for (const s of board.slots) if (s.userId) ids.add(s.userId);
    return ids;
}

/** The players of the roster who stand nowhere on this board yet, in setup order. */
export function unplaced(roster: RaidplanPlayer[], board: RaidplanBoard): RaidplanPlayer[] {
    const placed = placedIds(board);
    return roster.filter((p) => !placed.has(p.userId));
}

/** Puts a free token on the board at x/y (0..1): a new one, or the moved existing one. The player leaves any slot. */
export function placeToken(board: RaidplanBoard, userId: string, x: number, y: number): RaidplanBoard {
    const old = board.tokens.find((k) => k.userId === userId);
    const token = { ...(old || newLook(1)), userId, x: clamp01(x), y: clamp01(y) };
    return {
        ...board,
        slots: board.slots.map((s) => (s.userId === userId ? { ...s, userId: "" } : s)),
        tokens: old ? board.tokens.map((k) => (k.userId === userId ? token : k)) : [...board.tokens, token],
    };
}

/** Takes a free token off the board (the player is "not placed" again). Target rows keep their assignment. */
export function removeToken(board: RaidplanBoard, userId: string): RaidplanBoard {
    return { ...board, tokens: board.tokens.filter((k) => k.userId !== userId) };
}

/** Puts a player into a slot ("" = clears it). A player stands in one place: they leave their free token and any other slot. */
export function assignSlot(board: RaidplanBoard, slotId: string, userId: string): RaidplanBoard {
    return {
        ...board,
        tokens: userId ? board.tokens.filter((k) => k.userId !== userId) : board.tokens,
        slots: board.slots.map((s) => {
            if (s.id === slotId) return { ...s, userId };
            return userId && s.userId === userId ? { ...s, userId: "" } : s;
        }),
    };
}

/** The next free number for a kind: tank 1, tank 2 … */
export function nextSlotNumber(board: RaidplanBoard, kind: RaidplanSlotKind): number {
    let max = 0;
    for (const s of board.slots) if (s.kind === kind && s.n > max) max = s.n;
    return max + 1;
}

// ---- adding ----------------------------------------------------------------------------------

// New objects appear near the middle, each a little off the last so they do not pile up.
function spawnPoint(count: number): { x: number; y: number } {
    const step = count % 8;
    return { x: 0.42 + step * 0.03, y: 0.42 + step * 0.03 };
}

/** How many objects a board holds, tokens included. */
export function objectCount(board: RaidplanBoard): number {
    return board.tokens.length + board.slots.length + board.marks.length + board.zones.length + board.lines.length + board.texts.length;
}

/**
 * Inserts one object of a kind: at `at` (the pointer, a drop or a right click), else
 * near the middle. Returns the new board and the selection of what was inserted.
 * A zone and a line are centred on the point, a slot, mark and text are anchored on it.
 */
export function insertObject(board: RaidplanBoard, spec: InsertSpec, at: { x: number; y: number } | null): { board: RaidplanBoard; sel: Selection } {
    const p = at ? { x: clamp01(at.x), y: clamp01(at.y) } : spawnPoint(objectCount(board));
    const id = newRowId();
    if (spec.type === "slot") {
        const slot = { id, kind: spec.kind, n: nextSlotNumber(board, spec.kind), label: spec.label, x: p.x, y: p.y, userId: "", ...newLook(1) };
        return { board: { ...board, slots: [...board.slots, slot] }, sel: { kind: "slot", id } };
    }
    if (spec.type === "mark") {
        return { board: { ...board, marks: [...board.marks, { id, mark: spec.mark as RaidplanMarkName, x: p.x, y: p.y, ...newLook(1) }] }, sel: { kind: "mark", id } };
    }
    if (spec.type === "zone") {
        const zoneType = spec.zoneType as RaidplanZoneType;
        const zone = {
            id, shape: spec.shape as RaidplanZone["shape"], type: zoneType, label: "", color: ZONE_COLORS[zoneType],
            x: Math.max(0, Math.min(0.8, p.x - 0.1)), y: Math.max(0, Math.min(0.8, p.y - 0.1)), w: 0.2, h: 0.2, ...newLook(0.3),
        };
        return { board: { ...board, zones: [...board.zones, zone] }, sel: { kind: "zone", id } };
    }
    if (spec.type === "line") {
        const line = {
            id, kind: spec.kind as RaidplanLine["kind"], x1: Math.max(0, p.x - 0.1), y1: p.y, x2: Math.min(1, p.x + 0.1), y2: p.y,
            color: DEFAULT_LINE_COLOR, width: 4, ...newLook(1),
        };
        return { board: { ...board, lines: [...board.lines, line] }, sel: { kind: "line", id } };
    }
    const text = { id, text: spec.text, x: p.x, y: p.y, color: DEFAULT_TEXT_COLOR, size: 18, ...newLook(1) };
    return { board: { ...board, texts: [...board.texts, text] }, sel: { kind: "text", id } };
}

/** Adds a slot of a kind ("Tank 3"); a free label carries its own text. */
export function addSlot(board: RaidplanBoard, kind: RaidplanSlotKind, label: string): RaidplanBoard {
    return insertObject(board, { type: "slot", kind, label }, null).board;
}

export function addMark(board: RaidplanBoard, mark: RaidplanMarkName): RaidplanBoard {
    return insertObject(board, { type: "mark", mark }, null).board;
}

/** Adds a zone of a type in that type's preset colour. */
export function addZone(board: RaidplanBoard, type: RaidplanZoneType, shape: "rect" | "ellipse"): RaidplanBoard {
    return insertObject(board, { type: "zone", zoneType: type, shape }, null).board;
}

// ---- changing ----------------------------------------------------------------------------------

function patchIn<T>(list: T[], isTarget: (o: T) => boolean, patch: object): T[] {
    return list.map((o) => (isTarget(o) ? { ...o, ...patch } : o));
}

export function updateSlot(board: RaidplanBoard, id: string, patch: Partial<RaidplanSlot>): RaidplanBoard {
    return { ...board, slots: patchIn(board.slots, (s) => s.id === id, patch) };
}

export function updateZone(board: RaidplanBoard, id: string, patch: Partial<RaidplanZone>): RaidplanBoard {
    return { ...board, zones: patchIn(board.zones, (z) => z.id === id, patch) };
}

export function updateLine(board: RaidplanBoard, id: string, patch: Partial<RaidplanLine>): RaidplanBoard {
    return { ...board, lines: patchIn(board.lines, (l) => l.id === id, patch) };
}

export function updateText(board: RaidplanBoard, id: string, patch: Partial<RaidplanText>): RaidplanBoard {
    return { ...board, texts: patchIn(board.texts, (x) => x.id === id, patch) };
}

/** Changes what every object shares — opacity, lock, hidden — of any kind. */
export function patchLook(board: RaidplanBoard, kind: ObjectKind, id: string, patch: Partial<RaidplanLook>): RaidplanBoard {
    if (kind === "token") return { ...board, tokens: patchIn(board.tokens, (o) => o.userId === id, patch) };
    if (kind === "slot") return { ...board, slots: patchIn(board.slots, (o) => o.id === id, patch) };
    if (kind === "mark") return { ...board, marks: patchIn(board.marks, (o) => o.id === id, patch) };
    if (kind === "zone") return { ...board, zones: patchIn(board.zones, (o) => o.id === id, patch) };
    if (kind === "line") return { ...board, lines: patchIn(board.lines, (o) => o.id === id, patch) };
    return { ...board, texts: patchIn(board.texts, (o) => o.id === id, patch) };
}

/** How strongly the map shows (0.1..1). */
export function setMapOpacity(board: RaidplanBoard, value: number): RaidplanBoard {
    return { ...board, mapOpacity: clampOpacity(value, 1) };
}

/** The `lock` / `hidden` / `opacity` of one object, or null when it is gone. */
export function lookOf(board: RaidplanBoard, kind: ObjectKind, id: string): RaidplanLook | null {
    const list = kind === "token" ? board.tokens.filter((o) => o.userId === id)
        : kind === "slot" ? board.slots.filter((o) => o.id === id)
            : kind === "mark" ? board.marks.filter((o) => o.id === id)
                : kind === "zone" ? board.zones.filter((o) => o.id === id)
                    : kind === "line" ? board.lines.filter((o) => o.id === id)
                        : board.texts.filter((o) => o.id === id);
    return list[0] ? { opacity: list[0].opacity, lock: !!list[0].lock, hidden: !!list[0].hidden } : null;
}

/** A locked object cannot be moved or scaled. */
export function isLocked(board: RaidplanBoard, kind: ObjectKind, id: string): boolean {
    const look = lookOf(board, kind, id);
    return !!look && look.lock;
}

/** A zone's rectangle after a resize by one corner: the opposite corner stays, the size never drops below the minimum, the zone stays on the board. */
export function resizeRect(start: Rect, corner: Corner, dx: number, dy: number): Rect {
    let left = start.x;
    let top = start.y;
    let right = start.x + start.w;
    let bottom = start.y + start.h;
    if (corner === "nw" || corner === "sw") left = Math.min(clamp01(start.x + dx), right - MIN_ZONE);
    if (corner === "ne" || corner === "se") right = Math.max(clamp01(start.x + start.w + dx), left + MIN_ZONE);
    if (corner === "nw" || corner === "ne") top = Math.min(clamp01(start.y + dy), bottom - MIN_ZONE);
    if (corner === "sw" || corner === "se") bottom = Math.max(clamp01(start.y + start.h + dy), top + MIN_ZONE);
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
    if (isLocked(board, kind, id)) return board;
    if (kind === "token") return placeToken(board, id, x, y);
    if (kind === "slot") return { ...board, slots: patchIn(board.slots, (s) => s.id === id, { x: clamp01(x), y: clamp01(y) }) };
    if (kind === "mark") return { ...board, marks: patchIn(board.marks, (m) => m.id === id, { x: clamp01(x), y: clamp01(y) }) };
    if (kind === "text") return { ...board, texts: patchIn(board.texts, (o) => o.id === id, { x: clamp01(x), y: clamp01(y) }) };
    if (kind === "line") {
        const l = board.lines.find((o) => o.id === id);
        return l ? updateLine(board, id, moveLine(l, x - (l.x1 + l.x2) / 2, y - (l.y1 + l.y2) / 2)) : board;
    }
    return { ...board, zones: board.zones.map((z) => (z.id === id ? { ...z, ...moveRect(z, x - z.x, y - z.y) } : z)) };
}

/** The anchor of an object (a point object's point, a line's middle, a zone's top-left corner), or null when it is gone. */
export function objectPoint(board: RaidplanBoard, kind: ObjectKind, id: string): { x: number; y: number } | null {
    if (kind === "line") {
        const l = board.lines.find((o) => o.id === id);
        return l ? { x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 } : null;
    }
    const list = kind === "token" ? board.tokens.filter((k) => k.userId === id)
        : kind === "slot" ? board.slots.filter((s) => s.id === id)
            : kind === "mark" ? board.marks.filter((m) => m.id === id)
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

/** Deletes a board object. A slot's player is simply not placed any more. */
export function removeObject(board: RaidplanBoard, kind: ObjectKind, id: string): RaidplanBoard {
    if (kind === "token") return removeToken(board, id);
    if (kind === "slot") return { ...board, slots: board.slots.filter((s) => s.id !== id) };
    if (kind === "mark") return { ...board, marks: board.marks.filter((m) => m.id !== id) };
    if (kind === "line") return { ...board, lines: board.lines.filter((l) => l.id !== id) };
    if (kind === "text") return { ...board, texts: board.texts.filter((x) => x.id !== id) };
    return { ...board, zones: board.zones.filter((z) => z.id !== id) };
}

/** A copy of an object, a little off the original and unlocked, with a new id. A player is unique, so a token is not duplicated; a slot's copy is open. */
export function duplicateObject(board: RaidplanBoard, kind: ObjectKind, id: string): { board: RaidplanBoard; sel: Selection } {
    const nid = newRowId();
    const off = 0.03;
    if (kind === "slot") {
        const o = board.slots.find((s) => s.id === id);
        if (!o) return { board, sel: null };
        const copy = { ...o, id: nid, userId: "", lock: false, x: clamp01(o.x + off), y: clamp01(o.y + off), n: nextSlotNumber(board, o.kind) };
        return { board: { ...board, slots: [...board.slots, copy] }, sel: { kind, id: nid } };
    }
    if (kind === "mark") {
        const o = board.marks.find((m) => m.id === id);
        if (!o) return { board, sel: null };
        return { board: { ...board, marks: [...board.marks, { ...o, id: nid, lock: false, x: clamp01(o.x + off), y: clamp01(o.y + off) }] }, sel: { kind, id: nid } };
    }
    if (kind === "zone") {
        const o = board.zones.find((z) => z.id === id);
        if (!o) return { board, sel: null };
        const r = moveRect(o, off, off);
        return { board: { ...board, zones: [...board.zones, { ...o, ...r, id: nid, lock: false }] }, sel: { kind, id: nid } };
    }
    if (kind === "line") {
        const o = board.lines.find((l) => l.id === id);
        if (!o) return { board, sel: null };
        return { board: { ...board, lines: [...board.lines, { ...o, ...moveLine(o, off, off), id: nid, lock: false }] }, sel: { kind, id: nid } };
    }
    if (kind === "text") {
        const o = board.texts.find((x) => x.id === id);
        if (!o) return { board, sel: null };
        return { board: { ...board, texts: [...board.texts, { ...o, id: nid, lock: false, x: clamp01(o.x + off), y: clamp01(o.y + off) }] }, sel: { kind, id: nid } };
    }
    return { board, sel: null };
}

function moveInList<T>(list: T[], index: number, dir: string): T[] {
    if (index < 0) return list;
    const to = dir === "front" ? list.length - 1 : dir === "back" ? 0 : dir === "up" ? Math.min(list.length - 1, index + 1) : Math.max(0, index - 1);
    if (to === index) return list;
    const out = list.slice();
    const item = out.splice(index, 1)[0];
    out.splice(to, 0, item);
    return out;
}

/** Changes an object's place in its layer: "front" / "back" (all the way) or "up" / "down" (one step). Objects keep the order of their kind (zones behind lines behind marks behind slots behind texts behind tokens). */
export function reorderObject(board: RaidplanBoard, kind: ObjectKind, id: string, dir: string): RaidplanBoard {
    if (kind === "token") return { ...board, tokens: moveInList(board.tokens, board.tokens.findIndex((o) => o.userId === id), dir) };
    if (kind === "slot") return { ...board, slots: moveInList(board.slots, board.slots.findIndex((o) => o.id === id), dir) };
    if (kind === "mark") return { ...board, marks: moveInList(board.marks, board.marks.findIndex((o) => o.id === id), dir) };
    if (kind === "zone") return { ...board, zones: moveInList(board.zones, board.zones.findIndex((o) => o.id === id), dir) };
    if (kind === "line") return { ...board, lines: moveInList(board.lines, board.lines.findIndex((o) => o.id === id), dir) };
    return { ...board, texts: moveInList(board.texts, board.texts.findIndex((o) => o.id === id), dir) };
}

// ---- names, layers -----------------------------------------------------------------------

/** How a slot is called: "Tank 2", "Group 3", or its own label. */
export function slotTitle(slot: RaidplanSlot): string {
    if (slot.kind === "label") return slot.label;
    if (slot.label) return slot.label;
    return t(`raidBoard.slot.${slot.kind}`, { n: slot.n });
}

/** The players of the setup group a group marker stands for. */
export function groupMembers(slot: RaidplanSlot, roster: RaidplanPlayer[]): RaidplanPlayer[] {
    return roster.filter((p) => p.group === slot.n);
}

/** How many slots of a board are still open (a group marker and a label are not places to fill). */
export function openSlots(board: RaidplanBoard): number {
    return board.slots.filter((s) => (s.kind === "tank" || s.kind === "healer" || s.kind === "dps") && !s.userId).length;
}

/** The name an object goes by in the layer list and the inspector. */
export function objectName(board: RaidplanBoard, kind: ObjectKind, id: string, players: Map<string, RaidplanPlayer>): string {
    if (kind === "token") return (players.get(id) || { character: id }).character;
    if (kind === "slot") {
        const s = board.slots.find((o) => o.id === id);
        return s ? slotTitle(s) : "";
    }
    if (kind === "mark") {
        const m = board.marks.find((o) => o.id === id);
        return m ? t(`raidBoard.mark.${m.mark}`) : "";
    }
    if (kind === "zone") {
        const z = board.zones.find((o) => o.id === id);
        return z ? z.label || t(`raidBoard.zone.${z.type}`) : "";
    }
    if (kind === "line") {
        const l = board.lines.find((o) => o.id === id);
        return l ? t(`raidBoard.line.${l.kind}`) : "";
    }
    const x = board.texts.find((o) => o.id === id);
    return x ? x.text : "";
}

/** Every object of the board, front to back — the layer list. Within a kind the last one added is in front. */
export function layerList(board: RaidplanBoard, players: Map<string, RaidplanPlayer>): LayerRow[] {
    const rows = [];
    const add = (kind, list, idOf) => {
        for (let i = list.length - 1; i >= 0; i--) {
            const o = list[i];
            rows.push({ kind, id: idOf(o), name: objectName(board, kind, idOf(o), players), lock: !!o.lock, hidden: !!o.hidden });
        }
    };
    add("token", board.tokens, (o) => o.userId);
    add("text", board.texts, (o) => o.id);
    add("slot", board.slots, (o) => o.id);
    add("mark", board.marks, (o) => o.id);
    add("line", board.lines, (o) => o.id);
    add("zone", board.zones, (o) => o.id);
    return rows;
}

// ---- the right-click menu ----------------------------------------------------------------

/** The dark-on-light image of a raid mark (public/raidmarks/<mark>.png). */
export function markUrl(mark: string): string {
    return `/raidmarks/${mark}.png`;
}

function item(id: string, section: string, disabled: boolean, danger: boolean): MenuItem {
    return { id, section, disabled, danger };
}

/**
 * The entries of the context menu of an object (`target` is its kind) or of the
 * empty board (`"board"`), in order. `id`s are what applyMenuAction() and the page
 * understand; `section` groups them (a separator between sections).
 */
export function contextMenuItems(target: string, opts: { locked: boolean; hasPlayer: boolean; isEvent: boolean; kind: string }): MenuItem[] {
    if (target === "board") {
        const out = [];
        for (const k of ["tank", "healer", "dps", "group", "label"]) out.push(item(`insert:slot:${k}`, "slots", false, false));
        for (const m of RAID_MARKS) out.push(item(`insert:mark:${m}`, "marks", false, false));
        for (const z of ZONE_TYPES) out.push(item(`insert:zone:${z}`, "zones", false, false));
        out.push(item("insert:line:arrow", "shapes", false, false), item("insert:line:line", "shapes", false, false), item("insert:text", "shapes", false, false));
        out.push(item("deselect", "end", false, false));
        return out;
    }
    const out = [item("properties", "main", false, false)];
    if (target !== "token") out.push(item("duplicate", "main", false, false));
    out.push(item("front", "order", false, false), item("back", "order", false, false));
    out.push(item(opts.locked ? "unlock" : "lock", "order", false, false));
    if (target === "slot" && opts.isEvent && opts.kind !== "group") {
        out.push(item("assign", "player", false, false));
        if (opts.hasPlayer) out.push(item("unassign", "player", false, false));
    }
    if (target === "token") out.push(item("unassign", "player", false, false));
    out.push(item("delete", "end", false, true));
    return out;
}

/** What an "insert:…" id means, or null. */
export function parseInsertId(id: string): InsertSpec | null {
    const parts = id.split(":");
    if (parts[0] !== "insert") return null;
    if (parts[1] === "slot") return { type: "slot", kind: parts[2] as RaidplanSlotKind, label: parts[2] === "label" ? t("raidBoard.slot.kind.label") : "" };
    if (parts[1] === "mark") return { type: "mark", mark: parts[2] };
    if (parts[1] === "zone") return { type: "zone", zoneType: parts[2], shape: "rect" };
    if (parts[1] === "line") return { type: "line", kind: parts[2] };
    if (parts[1] === "text") return { type: "text", text: t("raidBoard.text.default") };
    return null;
}

/**
 * Carries out the entries that change the board (insert, duplicate, order, lock,
 * take a player out, delete); "properties", "assign" and "deselect" are the page's.
 * `at` is where the menu was opened (an insert lands there). Returns the new board
 * and what should be selected afterwards (null = nothing / keep).
 */
export function applyMenuAction(board: RaidplanBoard, id: string, kind: ObjectKind | "", objId: string, at: { x: number; y: number } | null): { board: RaidplanBoard; sel: Selection } {
    const spec = parseInsertId(id);
    if (spec) return insertObject(board, spec, at);
    const sel = kind ? { kind, id: objId } : null;
    if (!kind) return { board, sel: null };
    if (id === "duplicate") return duplicateObject(board, kind, objId);
    if (id === "front" || id === "back") return { board: reorderObject(board, kind, objId, id), sel };
    if (id === "lock") return { board: patchLook(board, kind, objId, { lock: true }), sel };
    if (id === "unlock") return { board: patchLook(board, kind, objId, { lock: false }), sel };
    if (id === "unassign") return { board: kind === "token" ? removeToken(board, objId) : assignSlot(board, objId, ""), sel: kind === "token" ? null : sel };
    if (id === "delete") return { board: removeObject(board, kind, objId), sel: null };
    return { board, sel };
}

/** Where a menu of a size opens so it stays inside the viewport (opens up / left when there is no room). */
export function clampMenuPosition(x: number, y: number, w: number, h: number, vw: number, vh: number): { x: number; y: number } {
    const margin = 8;
    return {
        x: Math.max(margin, x + w + margin > vw ? Math.max(margin, vw - w - margin) : x),
        y: Math.max(margin, y + h + margin > vh ? Math.max(margin, vh - h - margin) : y),
    };
}

// ---- undo / redo ---------------------------------------------------------------------------

export function historyInit<T>(present: T): History<T> {
    return { past: [], present, future: [] };
}

/** A new present. `merge` = it continues the last change (a drag): the past does not grow. Any new change clears the redo. */
export function historyRecord<T>(h: History<T>, next: T, merge: boolean): History<T> {
    if (merge) return { past: h.past, present: next, future: [] };
    return { past: [...h.past, h.present].slice(-MAX_HISTORY), present: next, future: [] };
}

export function historyUndo<T>(h: History<T>): History<T> {
    if (!h.past.length) return h;
    return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function historyRedo<T>(h: History<T>): History<T> {
    if (!h.future.length) return h;
    return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

// ---- rows, profiles ------------------------------------------------------------------------

/** A new, empty target row. */
export function newTarget(title: string): RaidplanTarget {
    return { id: newRowId(), title, userIds: [] };
}

/** Gives one row a new title, players, or drops it. */
export function updateTarget(board: RaidplanBoard, id: string, patch: Partial<RaidplanTarget>): RaidplanBoard {
    return { ...board, targets: board.targets.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
}

export function removeTarget(board: RaidplanBoard, id: string): RaidplanBoard {
    return { ...board, targets: board.targets.filter((r) => r.id !== id) };
}

/** Assigns a player to a row (once), or takes them off it. */
export function toggleAssignee(board: RaidplanBoard, id: string, userId: string): RaidplanBoard {
    return {
        ...board,
        targets: board.targets.map((r) => {
            if (r.id !== id) return r;
            const has = r.userIds.includes(userId);
            return { ...r, userIds: has ? r.userIds.filter((u) => u !== userId) : [...r.userIds, userId] };
        }),
    };
}

/** Whether applying a profile or a template would overwrite something the orga already made (asks first). */
export function hasContent(board: RaidplanBoard): boolean {
    return board.targets.length > 0 || board.notes.trim() !== "" || objectCount(board) > 0 || board.mapOpacity < 1;
}

/** Whether any board of a plan holds something. */
export function planHasContent(bosses: Record<string, Partial<RaidplanBoard>>, bossKeys: string[]): boolean {
    return bossKeys.some((k) => hasContent(boardOf(bosses, k)));
}

/**
 * The board after a profile was applied: its rows replace the board's rows, the
 * note comes along, `profileId` remembers where they came from. Players assigned
 * to a row whose title the profile keeps (ignoring case) stay assigned; tokens,
 * slots, marks and zones are not touched.
 */
export function applyProfile(board: RaidplanBoard, profile: RaidplanProfile): RaidplanBoard {
    const kept = new Map(board.targets.map((r) => [r.title.trim().toLowerCase(), r]));
    const targets = profile.targets.map((r) => {
        const old = kept.get(r.title.trim().toLowerCase());
        return old ? { ...old, title: r.title } : newTarget(r.title);
    });
    return { ...board, targets, notes: profile.notes || board.notes, profileId: profile.id };
}

/** The rows of a board as a profile stores them: titles only, no players. */
export function profileRows(board: RaidplanBoard): { title: string }[] {
    return board.targets.map((r) => ({ title: r.title.trim() })).filter((r) => r.title);
}

/** The profiles that fit a boss: made for every boss, for its instance, or for exactly this boss. */
export function profilesFor(profiles: RaidplanProfile[], bossKey: string): RaidplanProfile[] {
    const instance = bossKey.split("/")[0];
    return profiles.filter((p) => !p.bossKey || p.bossKey === bossKey || p.bossKey === instance);
}

/** Profiles matching a search text (name or category), grouped by category; "no category" comes last. */
export function groupProfiles(profiles: RaidplanProfile[], query: string): { category: string; profiles: RaidplanProfile[] }[] {
    const q = query.trim().toLowerCase();
    const hits = profiles.filter((p) => !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
    const groups = new Map();
    for (const p of hits) {
        if (!groups.has(p.category)) groups.set(p.category, []);
        groups.get(p.category).push(p);
    }
    const out = [...groups.entries()].map(([category, list]) => ({ category, profiles: list }));
    return out.sort((a, b) => {
        if (!a.category !== !b.category) return a.category ? -1 : 1;
        return a.category.localeCompare(b.category);
    });
}

/** How many objects and rows a boss holds — the small dot next to it in the boss list. */
export function boardCount(bosses: Record<string, Partial<RaidplanBoard>>, key: string): number {
    const b = boardOf(bosses, key);
    return objectCount(b) + b.targets.length;
}

/** Players by userId, for looking up who a token or an assignment is. */
export function rosterMap(roster: RaidplanPlayer[]): Map<string, RaidplanPlayer> {
    return new Map(roster.map((p) => [p.userId, p]));
}
