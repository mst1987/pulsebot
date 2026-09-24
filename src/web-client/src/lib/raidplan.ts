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
    RaidplanBoard, RaidplanLook, RaidplanPlayer, RaidplanProfile, RaidplanSlot, RaidplanSlotKind, RaidplanZone, RaidplanZoneType,
    RaidplanMarkName, RaidplanLine, RaidplanText, RaidplanIcon, RaidplanAssignType, Besetzung, BesetzungCounts,
} from "../api";
import { t } from "../i18n";

export const RAID_MARKS = ["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"];
export const ZONE_TYPES = ["danger", "healthy", "neutral", "custom"];
// What a new zone of a type starts with; the orga may pick any colour.
export const ZONE_COLORS = { danger: "#ef4444", healthy: "#22c55e", neutral: "#60a5fa", custom: "#a78bfa" };
export const MIN_ZONE = 0.03;
// The size of an object in px: what a new one starts with, and the range it can be set to.
export const SIZE_RANGES = {
    token: { def: 38, min: 24, max: 96 },
    slot: { def: 38, min: 24, max: 96 },
    mark: { def: 34, min: 16, max: 96 },
    icon: { def: 48, min: 20, max: 200 },
    member: { def: 38, min: 24, max: 96 },
    text: { def: 18, min: 10, max: 48 },
    line: { def: 4, min: 1, max: 12 },
};
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 2;
export const DEFAULT_LINE_COLOR = "#f8fafc";
export const DEFAULT_TEXT_COLOR = "#f8fafc";
const MAX_HISTORY = 100;

/** The kinds of board objects one can select, move and delete. */
export type ObjectKind = "token" | "slot" | "mark" | "icon" | "zone" | "line" | "text" | "member";
export type Selection = { kind: ObjectKind; id: string } | null;
export type Rect = { x: number; y: number; w: number; h: number };
export type Corner = "nw" | "ne" | "sw" | "se";
/** What a palette entry, a tool bar button or a context-menu entry inserts. */
export type InsertSpec =
    | { type: "slot"; kind: RaidplanSlotKind; label: string }
    | { type: "mark"; mark: string }
    | { type: "zone"; zoneType: string; shape: string }
    | { type: "line"; kind: string }
    | { type: "text"; text: string }
    | { type: "icon"; iconKey: string; label: string }
    | { type: "place"; slotId: string };
export type MenuItem = { id: string; section: string; disabled: boolean; danger: boolean };
export type LayerRow = { kind: ObjectKind; id: string; name: string; lock: boolean; hidden: boolean };
export type History<T> = { past: T[]; present: T; future: T[] };

/** The role's colour family: tank blue, healer cyan, melee orange, ranged violet; "dps" (any damage) amber. */
export function roleTone(role: string): "tank" | "healer" | "melee" | "ranged" | "dps" {
    if (role === "tank") return "tank";
    if (role === "healer") return "healer";
    if (role === "melee") return "melee";
    if (role === "ranged") return "ranged";
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
    return { tokens: [], slots: [], marks: [], icons: [], zones: [], lines: [], texts: [], targets: [], assignments: [], mobs: [], hiddenCards: [], counts: null, roles: {}, notes: "", profileId: "", mapOpacity: 1, objectScale: 1 };
}

/** The stored board of a boss, completed — a boss nobody touched has none. */
export function boardOf(bosses: Record<string, Partial<RaidplanBoard>>, key: string): RaidplanBoard {
    const b = bosses[key] || {};
    return {
        tokens: b.tokens || [],
        slots: b.slots || [],
        marks: b.marks || [],
        icons: b.icons || [],
        zones: b.zones || [],
        lines: b.lines || [],
        texts: b.texts || [],
        // the old task rows are read as assignments (title = the task, the players = who does it)
        targets: [],
        assignments: [
            ...(b.targets || []).map((r) => ({ id: r.id, type: "other" as RaidplanAssignType, title: r.title, spell: null, assignees: (r.userIds || []).map((u) => `user:${u}`), targets: [], note: "", suggested: false })),
            ...(b.assignments || []).map((a) => ({ ...a, title: a.title || "", spell: a.spell || null })),
        ],
        counts: b.counts || null,
        roles: b.roles || {},
        mobs: b.mobs || [],
        hiddenCards: b.hiddenCards || [],
        notes: b.notes || "",
        profileId: b.profileId || "",
        mapOpacity: b.mapOpacity || 1,
        objectScale: b.objectScale || 1,
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

/** The raiders of a group marker that stand around it as tokens: its setup group, minus anyone who already stands somewhere else on the board. */
export function splitMembers(board: RaidplanBoard, slot: RaidplanSlot, roster: RaidplanPlayer[]): RaidplanPlayer[] {
    if (slot.kind !== "group" || !slot.split || slot.hideMembers) return [];
    const elsewhere = new Set(board.tokens.map((x) => x.userId));
    for (const s of board.slots) if (s.userId) elsewhere.add(s.userId);
    return roster.filter((p) => p.group === slot.n && !elsewhere.has(p.userId));
}

/** Everyone who already stands somewhere on the board: a free token, a slot, or a group that is split around its marker. */
export function placedIds(board: RaidplanBoard, roster: RaidplanPlayer[] = []): Set<string> {
    const ids = new Set(board.tokens.map((x) => x.userId));
    for (const s of board.slots) if (s.userId) ids.add(s.userId);
    for (const s of board.slots) for (const p of splitMembers(board, s, roster)) ids.add(p.userId);
    return ids;
}

/** The players of the roster who stand nowhere on this board yet, in setup order. */
export function unplaced(roster: RaidplanPlayer[], board: RaidplanBoard): RaidplanPlayer[] {
    const placed = placedIds(board, roster);
    return roster.filter((p) => !placed.has(p.userId));
}

/** Puts a free token on the board at x/y (0..1): a new one, or the moved existing one. The player leaves any slot. */
export function placeToken(board: RaidplanBoard, userId: string, x: number, y: number): RaidplanBoard {
    const old = board.tokens.find((k) => k.userId === userId);
    const token = { ...(old || { ...newLook(1), size: SIZE_RANGES.token.def }), userId, x: clamp01(x), y: clamp01(y) };
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
    return board.tokens.length + board.slots.length + board.marks.length + board.icons.length + board.zones.length + board.lines.length + board.texts.length;
}

/**
 * Inserts one object of a kind: at `at` (the pointer, a drop or a right click), else
 * near the middle. Returns the new board and the selection of what was inserted.
 * A zone and a line are centred on the point, a slot, mark and text are anchored on it.
 */
export function insertObject(board: RaidplanBoard, spec: InsertSpec, at: { x: number; y: number } | null): { board: RaidplanBoard; sel: Selection; blocked?: string } {
    const p = at ? { x: clamp01(at.x), y: clamp01(at.y) } : spawnPoint(objectCount(board));
    const id = newRowId();
    if (spec.type === "slot") {
        const free = isRoleKind(spec.kind) ? board.slots.filter((s) => s.kind === spec.kind && s.placed === false).sort((a, b) => a.n - b.n)[0] : undefined;
        if (free) return { board: { ...board, slots: board.slots.map((s) => (s.id === free.id ? { ...s, placed: true, x: p.x, y: p.y } : s)) }, sel: { kind: "slot", id: free.id } };
        // a role slot belongs to the Besetzung: the palette never makes a new one (+/- in the Besetzung does), it says so instead
        if (isRoleKind(spec.kind)) return { board, sel: null, blocked: spec.kind };
        const slot = {
            id, kind: spec.kind, n: nextSlotNumber(board, spec.kind), label: spec.label || (spec.kind === "group" ? t("raidBoard.slot.group", { n: nextSlotNumber(board, spec.kind) }) : ""), x: p.x, y: p.y, userId: "", size: SIZE_RANGES.slot.def,
            hideMembers: false, split: false, offsets: {}, placed: true, ...newLook(1),
        };
        return { board: { ...board, slots: [...board.slots, slot] }, sel: { kind: "slot", id } };
    }
    if (spec.type === "mark") {
        return { board: { ...board, marks: [...board.marks, { id, mark: spec.mark as RaidplanMarkName, x: p.x, y: p.y, size: SIZE_RANGES.mark.def, ...newLook(1) }] }, sel: { kind: "mark", id } };
    }
    if (spec.type === "icon") {
        const icon = { id, iconKey: spec.iconKey, label: spec.label, x: p.x, y: p.y, size: SIZE_RANGES.icon.def, rotation: 0, showLabel: false, ...newLook(1) };
        return { board: { ...board, icons: [...board.icons, icon] }, sel: { kind: "icon", id } };
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
    if (spec.type !== "text") return { board, sel: null };
    const text = { id, text: spec.text, x: p.x, y: p.y, color: DEFAULT_TEXT_COLOR, size: 18, ...newLook(1) };
    return { board: { ...board, texts: [...board.texts, text] }, sel: { kind: "text", id } };
}

/** Adds a slot of a kind ("Tank 3"); a free label carries its own text. */
export function addSlot(board: RaidplanBoard, kind: RaidplanSlotKind, label: string): RaidplanBoard {
    // makes a slot outright (the palette never does for a role: it places one of the Besetzung)
    const n = nextSlotNumber(board, kind);
    const p = spawnPoint(objectCount(board));
    const slot = {
        id: newRowId(), kind, n, label: label || (kind === "group" ? t("raidBoard.slot.group", { n }) : ""), x: p.x, y: p.y, userId: "", size: SIZE_RANGES.slot.def,
        hideMembers: false, split: false, offsets: {}, placed: true, ...newLook(1),
    };
    return { ...board, slots: [...board.slots, slot] };
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

export function updateIcon(board: RaidplanBoard, id: string, patch: Partial<RaidplanIcon>): RaidplanBoard {
    return { ...board, icons: patchIn(board.icons, (i) => i.id === id, patch) };
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
    if (kind === "icon") return { ...board, icons: patchIn(board.icons, (o) => o.id === id, patch) };
    if (kind === "member") return board;
    if (kind === "zone") return { ...board, zones: patchIn(board.zones, (o) => o.id === id, patch) };
    if (kind === "line") return { ...board, lines: patchIn(board.lines, (o) => o.id === id, patch) };
    return { ...board, texts: patchIn(board.texts, (o) => o.id === id, patch) };
}

/** The id of a raider standing around a split group marker: "<slot id>~<user id>". */
export function memberId(slotId: string, userId: string): string {
    return `${slotId}~${userId}`;
}

export function parseMemberId(id: string): { slotId: string; userId: string } {
    const at = id.indexOf("~");
    return at < 0 ? { slotId: id, userId: "" } : { slotId: id.slice(0, at), userId: id.slice(at + 1) };
}

/** The default size of tokens, slots, marks and icons of a board, 0.5..2 (1 = as is). */
export function setObjectScale(board: RaidplanBoard, value: number): RaidplanBoard {
    if (!Number.isFinite(value)) return { ...board, objectScale: 1 };
    return { ...board, objectScale: Math.max(SCALE_MIN, Math.min(SCALE_MAX, Math.round(value * 100) / 100)) };
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
                : kind === "icon" ? board.icons.filter((o) => o.id === id)
                    : kind === "member" ? board.slots.filter((o) => o.id === parseMemberId(id).slotId)
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
    if (kind === "icon") return { ...board, icons: patchIn(board.icons, (m) => m.id === id, { x: clamp01(x), y: clamp01(y) }) };
    if (kind === "member") {
        // a raider of a split group moved on his own: his place is kept relative to the marker, so the group still moves along with it
        const ref = parseMemberId(id);
        const slot = board.slots.find((k) => k.id === ref.slotId);
        if (!slot) return board;
        const old = slot.offsets[ref.userId] || { dx: 0, dy: 0, size: SIZE_RANGES.member.def };
        const offsets = { ...slot.offsets, [ref.userId]: { ...old, dx: Math.max(-1, Math.min(1, x - slot.x)), dy: Math.max(-1, Math.min(1, y - slot.y)) } };
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
    if (kind === "line") {
        const l = board.lines.find((o) => o.id === id);
        return l ? { x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 } : null;
    }
    if (kind === "member") {
        const ref = parseMemberId(id);
        const slot = board.slots.find((k) => k.id === ref.slotId);
        const off = slot ? slot.offsets[ref.userId] : undefined;
        return slot && off ? { x: slot.x + off.dx, y: slot.y + off.dy } : null;
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

/** Deletes a board object. A slot's player is simply not placed any more. */
export function removeObject(board: RaidplanBoard, kind: ObjectKind, id: string): RaidplanBoard {
    if (kind === "token") return removeToken(board, id);
    if (kind === "slot") {
        // a role slot belongs to the Besetzung: taking it off the map keeps it (the counts remove it)
        const o = board.slots.find((s) => s.id === id);
        if (o && isRoleKind(o.kind)) return unplaceSlot(board, id);
        return { ...board, slots: board.slots.filter((s) => s.id !== id) };
    }
    if (kind === "mark") return { ...board, marks: board.marks.filter((m) => m.id !== id) };
    if (kind === "icon") return { ...board, icons: board.icons.filter((m) => m.id !== id) };
    if (kind === "member") {
        // "deleting" a raider's own place puts him back into the ring
        const ref = parseMemberId(id);
        const slot = board.slots.find((k) => k.id === ref.slotId);
        if (!slot) return board;
        const offsets = { ...slot.offsets };
        delete offsets[ref.userId];
        return updateSlot(board, ref.slotId, { offsets });
    }
    if (kind === "line") return { ...board, lines: board.lines.filter((l) => l.id !== id) };
    if (kind === "text") return { ...board, texts: board.texts.filter((x) => x.id !== id) };
    return { ...board, zones: board.zones.filter((z) => z.id !== id) };
}

/** How big an object is: px for a token, slot, mark, icon, the font size of a text, the thickness of a line; null for a zone (it has a width and a height). */
export function sizeOf(board: RaidplanBoard, kind: ObjectKind, id: string): number | null {
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

/** Sets an object's size, kept inside the range of its kind. A locked object keeps its size. A zone is scaled by scaleObject(). */
export function setObjectSize(board: RaidplanBoard, kind: ObjectKind, id: string, value: number): RaidplanBoard {
    if (!Number.isFinite(value) || kind === "zone" || isLocked(board, kind, id)) return board;
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

/**
 * Where the raiders of a split group stand around their marker: evenly on a ring
 * whose radius grows with their number, so they never overlap. Offsets from the
 * marker in board fractions (the ring is a circle in pixels, whatever the board's
 * shape is), for a board of w × h px and tokens of tokenPx.
 */
export function ringOffsets(count: number, w: number, h: number, tokenPx: number): { dx: number; dy: number }[] {
    const out = [];
    if (count <= 0 || w <= 0 || h <= 0) return out;
    const radius = Math.max(tokenPx * 1.7, (count * tokenPx * 1.3) / (2 * Math.PI));
    for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
        out.push({ dx: (Math.cos(angle) * radius) / w, dy: (Math.sin(angle) * radius) / h });
    }
    return out;
}

/** A copy of an object, a little off the original and unlocked, with a new id. A player is unique, so a token is not duplicated; a slot's copy is open. */
export function duplicateObject(board: RaidplanBoard, kind: ObjectKind, id: string): { board: RaidplanBoard; sel: Selection } {
    const nid = newRowId();
    const off = 0.03;
    if (kind === "slot") {
        const o = board.slots.find((s) => s.id === id);
        if (!o) return { board, sel: null };
        const copy = { ...o, id: nid, userId: "", offsets: {}, lock: false, x: clamp01(o.x + off), y: clamp01(o.y + off), n: nextSlotNumber(board, o.kind) };
        return { board: { ...board, slots: [...board.slots, copy] }, sel: { kind, id: nid } };
    }
    if (kind === "mark") {
        const o = board.marks.find((m) => m.id === id);
        if (!o) return { board, sel: null };
        return { board: { ...board, marks: [...board.marks, { ...o, id: nid, lock: false, x: clamp01(o.x + off), y: clamp01(o.y + off) }] }, sel: { kind, id: nid } };
    }
    if (kind === "icon") {
        const o = board.icons.find((m) => m.id === id);
        if (!o) return { board, sel: null };
        return { board: { ...board, icons: [...board.icons, { ...o, id: nid, lock: false, x: clamp01(o.x + off), y: clamp01(o.y + off) }] }, sel: { kind, id: nid } };
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
    if (kind === "icon") return { ...board, icons: moveInList(board.icons, board.icons.findIndex((o) => o.id === id), dir) };
    if (kind === "member") return board;
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

/**
 * What a board object prints next to itself. Only what was typed is drawn: no
 * fallback such as "Tank 1" or the zone's type (those names belong to the layer list,
 * the tooltips and the screen readers, see slotTitle / objectName).
 */
export function slotBoardLabel(slot: RaidplanSlot): string {
    return (slot.label || "").trim();
}

export function zoneBoardLabel(zone: RaidplanZone): string {
    return (zone.label || "").trim();
}

/** An icon's label is drawn only when it was switched on (inspector) and has words. */
export function iconBoardLabel(icon: RaidplanIcon): string {
    return icon.showLabel ? (icon.label || "").trim() : "";
}

/** A text object with no words is not drawn (only while it is selected, so it can be filled in). */
export function textShown(text: RaidplanText, selected: boolean): boolean {
    return (text.text || "").trim() !== "" || selected;
}

/** The players of the setup group a group marker stands for. */
export function groupMembers(slot: RaidplanSlot, roster: RaidplanPlayer[]): RaidplanPlayer[] {
    return roster.filter((p) => p.group === slot.n);
}

/** How many slots of a board are still open (a group marker and a label are not places to fill). */
export function openSlots(board: RaidplanBoard): number {
    return board.slots.filter((s) => (s.kind === "tank" || s.kind === "healer" || s.kind === "melee" || s.kind === "ranged" || s.kind === "dps") && !s.userId).length;
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
    if (kind === "icon") {
        const i = board.icons.find((o) => o.id === id);
        return i ? i.label || t(`raidBoard.icon.${iconKeyType(i.iconKey)}`) : "";
    }
    if (kind === "member") return (players.get(parseMemberId(id).userId) || { character: "" }).character;
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
    add("slot", board.slots.filter((o) => o.placed !== false), (o) => o.id);
    add("mark", board.marks, (o) => o.id);
    add("icon", board.icons, (o) => o.id);
    add("line", board.lines, (o) => o.id);
    add("zone", board.zones, (o) => o.id);
    return rows;
}

// ---- the right-click menu ----------------------------------------------------------------

/** Which source an icon key names: a boss icon of the encounter list, a spell / ability icon of the icon CDN, or one of the two built in symbols. */
// ---- facing (boss / enemy icons): 0 = up / north, clockwise -----------------------------

export const COMPASS = [0, 45, 90, 135, 180, 225, 270, 315];
export const COMPASS_NAMES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** An angle as whole degrees 0..359; anything that is not a number is 0. */
export function normAngle(deg: number): number {
    const n = Math.round(Number(deg));
    return Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0;
}

/** The angle of the pointer (px, py) around the centre (cx, cy): 0 = straight up, clockwise. */
export function angleTo(cx: number, cy: number, px: number, py: number): number {
    return normAngle((Math.atan2(px - cx, cy - py) * 180) / Math.PI);
}

/** The angle rounded to a step (Shift while turning: 15). */
export function snapAngle(deg: number, step: number): number {
    return normAngle(Math.round(deg / step) * step);
}

/** The compass point (N, NE, ...) an angle is closest to. */
export function compassName(deg: number): string {
    return COMPASS_NAMES[Math.round(normAngle(deg) / 45) % 8];
}

/** Whether an icon shows which way it faces: bosses, enemies and positions do, spell icons do not. */
export function canFace(key: string): boolean {
    return key.slice(0, 4) !== "wow:";
}

/** Turns an icon by delta degrees. */
export function turnIcon(board: RaidplanBoard, id: string, delta: number): RaidplanBoard {
    const i = board.icons.find((k) => k.id === id);
    return i ? updateIcon(board, id, { rotation: normAngle(i.rotation + delta) }) : board;
}

export function iconKeyType(key: string): string {
    if (key.startsWith("boss:") || key.startsWith("mob:")) return "boss";
    if (key.startsWith("wow:")) return "wow";
    if (key === "enemy" || key === "bosspos") return key;
    return "";
}

/** The picture of a `boss:<encounter id>` (public/bosses/<id>.jpg) or `mob:<NPC id>` (public/mobs/<id>.png) icon key, "" for any other. */
export function portraitUrl(key: string): string {
    const m = key.match(/^(boss|mob):(\d{1,6})$/);
    return !m ? "" : m[1] === "boss" ? `/bosses/${m[2]}.jpg` : `/mobs/${m[2]}.png`;
}

/** The icon key a boss list entry stands for: its WCL encounter icon, else the icon of its instance. */
export function iconKeyForBoss(iconUrl: string): string {
    const m = iconUrl.match(/\/bosses\/(\d+)\.jpg$/);
    if (m) return `boss:${m[1]}`;
    const w = iconUrl.match(/\/icons\/(?:large|medium)\/([^/]+)\.jpg$/);
    return w ? `wow:${decodeURIComponent(w[1])}` : "enemy";
}

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
export function contextMenuItems(target: string, opts: { locked: boolean; hasPlayer: boolean; isEvent: boolean; kind: string; hideMembers?: boolean; split?: boolean; faces?: boolean }): MenuItem[] {
    if (target === "board") {
        const out = [];
        for (const k of ["tank", "healer", "melee", "ranged", "dps", "group", "label"]) out.push(item(`insert:slot:${k}`, "slots", false, false));
        for (const m of RAID_MARKS) out.push(item(`insert:mark:${m}`, "marks", false, false));
        for (const z of ZONE_TYPES) out.push(item(`insert:zone:${z}`, "zones", false, false));
        out.push(item("insert:icon:enemy", "icons", false, false), item("insert:icon:bosspos", "icons", false, false));
        out.push(item("insert:line:arrow", "shapes", false, false), item("insert:line:line", "shapes", false, false), item("insert:text", "shapes", false, false));
        out.push(item("deselect", "end", false, false));
        return out;
    }
    if (target === "member") return [item("properties", "main", false, false), item("resetpos", "end", false, false)];
    const out = [item("properties", "main", false, false)];
    if (target !== "token") out.push(item("duplicate", "main", false, false));
    if (target === "icon" && opts.faces) for (const a of COMPASS) out.push(item("face:" + a, "face", false, false));
    out.push(item("front", "order", false, false), item("back", "order", false, false));
    out.push(item(opts.locked ? "unlock" : "lock", "order", false, false));
    if (target === "slot" && opts.isEvent && opts.kind !== "group") {
        out.push(item("assign", "player", false, false));
        if (opts.hasPlayer) out.push(item("unassign", "player", false, false));
    }
    if (target === "token") out.push(item("unassign", "player", false, false));
    if (target === "slot" && opts.kind === "group") {
        out.push(item(opts.hideMembers ? "members:show" : "members:hide", "group", false, false));
        out.push(item(opts.split ? "split:off" : "split:on", "group", false, false));
    }
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
    if (parts[1] === "icon") return { type: "icon", iconKey: parts[2], label: "" };
    if (parts[1] === "text") return { type: "text", text: t("raidBoard.text.default") };
    return null;
}

/**
 * Carries out the entries that change the board (insert, duplicate, order, lock,
 * take a player out, delete); "properties", "assign" and "deselect" are the page's.
 * `at` is where the menu was opened (an insert lands there). Returns the new board
 * and what should be selected afterwards (null = nothing / keep).
 */
export function applyMenuAction(board: RaidplanBoard, id: string, kind: ObjectKind | "", objId: string, at: { x: number; y: number } | null): { board: RaidplanBoard; sel: Selection; blocked?: string } {
    const spec = parseInsertId(id);
    if (spec) return insertObject(board, spec, at);
    const sel = kind ? { kind, id: objId } : null;
    if (!kind) return { board, sel: null };
    if (id === "duplicate") return duplicateObject(board, kind, objId);
    if (id.startsWith("face:")) return { board: updateIcon(board, objId, { rotation: normAngle(Number(id.slice(5))) }), sel };
    if (id === "members:hide") return { board: updateSlot(board, objId, { hideMembers: true }), sel };
    if (id === "members:show") return { board: updateSlot(board, objId, { hideMembers: false }), sel };
    if (id === "split:on") return { board: updateSlot(board, objId, { split: true }), sel };
    if (id === "split:off") return { board: updateSlot(board, objId, { split: false }), sel };
    if (id === "resetpos") return { board: removeObject(board, kind, objId), sel };
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

// ---- the Besetzung (role slots that exist before anything is on the map) ---------------------

/**
 * The Besetzung a raid type comes to (the same rules as the server's raidplanBesetzung.js): tanks and
 * healers from the biggest instance's own suggestion for the size (else the default rule), the DPS is
 * what is left — one number, no melee / ranged split. `size` 0 = the instances' default (else 25).
 */
export function besetzungFor(instances: { defaultSize: number; suggested: Record<string, { tanks: number; healers: number }> }[], size: number): Besetzung {
    const biggest = [...instances].sort((a, b) => b.defaultSize - a.defaultSize)[0];
    const fallback = biggest ? biggest.defaultSize : 0;
    const n = size >= 1 && size <= 40 ? Math.floor(size) : fallback || 25;
    const own = biggest ? biggest.suggested[String(n)] : undefined;
    const base = n <= 1 ? { tanks: n, healers: 0 } : n <= 5 ? { tanks: 1, healers: 1 } : { tanks: n <= 20 ? 2 : n <= 25 ? 3 : 4, healers: 0 };
    const tanks = own ? own.tanks : base.tanks;
    const healers = own ? own.healers : n <= 5 ? base.healers : Math.min(Math.round(n / 4), n - tanks);
    const tank = Math.min(tanks, n);
    const healer = Math.min(healers, n - tank);
    return { size: n, counts: { tank, healer, dps: Math.max(0, n - tank - healer), melee: 0, ranged: 0 }, groups: Math.max(1, Math.ceil(n / 5)), split: false };
}

/** How many slots of each kind the counts make: the DPS that is not split into melee / ranged is "DPS n". */
export function slotCounts(counts: BesetzungCounts): BesetzungCounts {
    return { tank: counts.tank, healer: counts.healer, dps: Math.max(0, counts.dps - counts.melee - counts.ranged), melee: counts.melee, ranged: counts.ranged };
}

/** One role's number out of a counts object. */
export function countOf(counts: BesetzungCounts, kind: string): number {
    return kind === "tank" ? counts.tank : kind === "healer" ? counts.healer : kind === "dps" ? counts.dps : kind === "melee" ? counts.melee : kind === "ranged" ? counts.ranged : 0;
}

export const ROLE_KINDS = ["tank", "healer", "dps", "melee", "ranged"];

/** A slot of the Besetzung: a tank, healer, DPS, melee or ranged place, or a setup group. */
export function isRoleKind(kind: string): boolean {
    return ROLE_KINDS.indexOf(kind) >= 0 || kind === "group";
}

/** What a player counts as on this board: the role set for this boss (flex), else the role of the setup. */
export function roleOn(board: RaidplanBoard, player: RaidplanPlayer): string {
    return board.roles[player.userId] || player.role;
}

/** Which slot kinds take a player of a role: the exact kind first, a damage dealer also any melee / ranged / DPS place. */
function kindsFor(role: string): string[] {
    if (role === "tank" || role === "healer") return [role];
    if (role === "melee") return ["melee", "dps"];
    if (role === "ranged") return ["ranged", "dps"];
    return ["dps", "melee", "ranged"];
}

/** How many of each role the lineup really has on this boss (flex roles counted): the damage dealers are all that are neither tank nor healer. */
function rosterCounts(board: RaidplanBoard, roster: RaidplanPlayer[]): BesetzungCounts {
    const out = { tank: 0, healer: 0, dps: 0, melee: 0, ranged: 0 };
    for (const p of roster) {
        const r = roleOn(board, p);
        if (r === "tank") out.tank += 1;
        else if (r === "healer") out.healer += 1;
        else out.dps += 1;
    }
    return out;
}

/**
 * The numbers this board has: its own when it has set some (+/-), else the raid type's — and, in an event, at
 * least as many tanks, healers and DPS as the lineup really has on this boss (a lineup with more than the type
 * gets extra slots, one with fewer leaves slots open).
 */
export function effectiveCounts(board: RaidplanBoard, besetzung: Besetzung, roster: RaidplanPlayer[]): BesetzungCounts {
    const counts = { ...(board.counts || besetzung.counts) };
    if (!board.counts && roster.length > 0) {
        const real = rosterCounts(board, roster);
        counts.tank = Math.max(counts.tank, real.tank);
        counts.healer = Math.max(counts.healer, real.healer);
        counts.dps = Math.max(counts.dps, real.dps);
    }
    return counts;
}

/**
 * The board with every role slot its Besetzung has: Tank 1..n, Heiler 1..n, DPS 1..n (melee / ranged only
 * when they were split), and the groups. What is missing is added (not on the map, `placed: false`);
 * what is there is never changed or removed. In an event the setup's players fill the new slots by role
 * (the role of a boss counts: flex), and — as long as this boss has no counts of its own — a lineup
 * with more tanks, healers or DPS than the type has gets the extra slots; one with fewer leaves slots open.
 */
export function ensureBesetzung(board: RaidplanBoard, besetzung: Besetzung | null, roster: RaidplanPlayer[]): RaidplanBoard {
    if (!besetzung) return board;
    return fillBesetzung(repairSlots(board, besetzung, roster), besetzung, roster);
}

function fillBesetzung(board: RaidplanBoard, besetzung: Besetzung, roster: RaidplanPlayer[]): RaidplanBoard {
    const want = slotCounts(effectiveCounts(board, besetzung, roster));
    const missing = [];
    for (const kind of ["tank", "healer", "melee", "ranged", "dps"]) {
        for (let n = 1; n <= countOf(want, kind); n += 1) if (!board.slots.some((s) => s.kind === kind && s.n === n)) missing.push({ kind, n });
    }
    for (let n = 1; n <= besetzung.groups; n += 1) if (!board.slots.some((s) => s.kind === "group" && s.n === n)) missing.push({ kind: "group", n });
    if (missing.length === 0) return board;
    const taken = new Set(board.slots.map((s) => s.userId).filter(Boolean));
    // the exact roles first, so a generic "DPS n" never takes a melee or ranged player from a place that asks for him
    const added = missing.map((m) => {
        const who = m.kind === "group" ? null : roster.find((p) => !taken.has(p.userId) && (roleOn(board, p) === m.kind || (m.kind === "dps" && roleOn(board, p) !== "tank" && roleOn(board, p) !== "healer"))) || null;
        if (who) taken.add(who.userId);
        return {
            id: `bes-${m.kind}-${m.n}`, kind: m.kind as RaidplanSlotKind, n: m.n, label: "", x: 0.5, y: 0.5, userId: who ? who.userId : "", size: SIZE_RANGES.slot.def,
            hideMembers: false, split: false, offsets: {}, placed: false, ...newLook(1),
        };
    });
    return { ...board, slots: [...board.slots, ...added] };
}

/**
 * Mends a board whose role slots got out of step (older versions let the palette make extra slots): the same kind and
 * number more than once is merged into one — it keeps the player, the map position and the size of the ones it
 * merges, and a second player or position is never thrown away (that slot gets a free number instead) — and slots
 * above what the Besetzung has that hold nobody and are not on the map go. Assignments refer to kind and number, so
 * they stay valid. Returns the same board when there is nothing to mend.
 */
export function repairSlots(board: RaidplanBoard, besetzung: Besetzung, roster: RaidplanPlayer[]): RaidplanBoard {
    const want = slotCounts(effectiveCounts(board, besetzung, roster));
    const seen = new Map();
    let changed = false;
    const out = [];
    for (const s of board.slots) {
        if (!isRoleKind(s.kind)) { out.push(s); continue; }
        const key = `${s.kind}:${s.n}`;
        const keeper = seen.get(key);
        if (!keeper) { seen.set(key, s); out.push(s); continue; }
        // the same slot twice: merge what the second one has into the first
        changed = true;
        const merged = mergeSlot(keeper, s);
        out[out.indexOf(keeper)] = merged.keep;
        seen.set(key, merged.keep);
        if (merged.rest) out.push(merged.rest);
    }
    // a leftover that could not be merged needs a number of its own
    const taken = new Set(out.filter((s) => isRoleKind(s.kind)).map((s) => `${s.kind}:${s.n}`));
    const numbered = out.map((s) => {
        if (!s.__dupe) return s;
        let n = s.n;
        while (taken.has(`${s.kind}:${n}`)) n += 1;
        taken.add(`${s.kind}:${n}`);
        return { ...s, n, __dupe: undefined };
    });
    const kept = numbered.filter((s) => !(isRoleKind(s.kind) && s.n > slotLimit(s.kind, besetzung, want) && !s.userId && s.placed === false));
    if (kept.length !== numbered.length) changed = true;
    return changed ? { ...board, slots: kept.map(withoutMark) } : board;
}

function slotLimit(kind: string, besetzung: Besetzung, want: BesetzungCounts): number {
    return kind === "group" ? besetzung.groups : countOf(want, kind);
}

function withoutMark(s: RaidplanSlot): RaidplanSlot {
    const c = { ...s };
    Reflect.deleteProperty(c, "__dupe");
    return c;
}

/** Two slots of the same kind and number become one: the first takes the player, the position and the size the second has and it lacks; what cannot be taken over stays as a slot of its own (`rest`). */
function mergeSlot(a: RaidplanSlot, b: RaidplanSlot): { keep: RaidplanSlot; rest: RaidplanSlot | null } {
    let keep = a;
    let rest = null;
    if (!a.userId && b.userId) keep = { ...keep, userId: b.userId };
    else if (a.userId && b.userId && a.userId !== b.userId) rest = { ...b, placed: false, __dupe: true };
    if (a.placed === false && b.placed !== false) keep = { ...keep, placed: true, x: b.x, y: b.y };
    else if (a.placed !== false && b.placed !== false && rest === null && (a.x !== b.x || a.y !== b.y)) rest = null;
    if (!keep.label && b.label) keep = { ...keep, label: b.label };
    return { keep, rest };
}

/** How many role slots of each kind are on the map and how many there are: the palette shows "3/5" and greys a kind out once all are placed. */
export function slotTally(board: RaidplanBoard): { kind: string; placed: number; total: number }[] {
    return [...ROLE_KINDS, "group"].map((kind) => {
        const list = board.slots.filter((s) => s.kind === kind);
        return { kind, placed: list.filter((s) => s.placed !== false).length, total: list.length };
    });
}

/** The counts as this board sets them (its own, else the type's) with one role changed (+/-); melee + ranged stay within the DPS. */
export function countsWith(board: RaidplanBoard, besetzung: Besetzung, kind: string, n: number, roster: RaidplanPlayer[]): BesetzungCounts {
    const cur = effectiveCounts(board, besetzung, roster);
    const v = Math.max(0, Math.min(40, Math.round(n)));
    if (kind === "dps") cur.dps = Math.max(v, cur.melee + cur.ranged);
    else if (kind === "melee") cur.melee = Math.min(v, cur.dps - cur.ranged);
    else if (kind === "ranged") cur.ranged = Math.min(v, cur.dps - cur.melee);
    else if (kind === "tank") { cur.tank = v; } else if (kind === "healer") { cur.healer = v; }
    return cur;
}

/** Sets how many slots of a role this board has (+/-): more are added by ensureBesetzung, fewer are removed from the end. */
export function setCount(board: RaidplanBoard, besetzung: Besetzung, kind: string, n: number, roster: RaidplanPlayer[]): RaidplanBoard {
    const counts = countsWith(board, besetzung, kind, n, roster);
    return { ...board, counts, slots: trimSlots(board.slots, counts) };
}

/** Back to the raid type's numbers on this board (extra slots beyond them go away). */
export function resetCounts(board: RaidplanBoard, besetzung: Besetzung): RaidplanBoard {
    return { ...board, counts: null, slots: trimSlots(board.slots, besetzung.counts) };
}

function trimSlots(slots: RaidplanSlot[], counts: BesetzungCounts): RaidplanSlot[] {
    const want = slotCounts(counts);
    return slots.filter((s) => !(ROLE_KINDS.indexOf(s.kind) >= 0 && s.n > countOf(want, s.kind)));
}

/**
 * Somebody plays another role on this boss than in the setup ("Heiler 5 spielt hier DPS"): the player leaves
 * his slot (it stays, open) and takes the first open place that fits the new role; the role is remembered
 * for this board only. Setting the role the setup already has clears the flex. Nothing else changes.
 */
export function setFlexRole(board: RaidplanBoard, roster: RaidplanPlayer[], userId: string, role: string): RaidplanBoard {
    const player = roster.find((p) => p.userId === userId);
    if (!player) return board;
    const roles = { ...board.roles };
    if (role === player.role || (role === "dps" && player.role !== "tank" && player.role !== "healer")) delete roles[userId]; else roles[userId] = role;
    const eff = roles[userId] || player.role;
    const freed = board.slots.map((s) => (s.userId === userId ? { ...s, userId: "" } : s));
    let slots = freed;
    const place = () => {
        for (const kind of kindsFor(eff)) {
            const free = freed.filter((s) => s.kind === kind && !s.userId).sort((a, b) => a.n - b.n)[0];
            if (free) return free.id;
        }
        return "";
    };
    const target = place();
    if (target) slots = freed.map((s) => (s.id === target ? { ...s, userId } : s));
    return { ...board, roles, slots };
}

/** Puts a slot of the Besetzung on the map (at a point, else near the middle). */
export function placeSlot(board: RaidplanBoard, id: string, at: { x: number; y: number } | null): RaidplanBoard {
    const p = at ? { x: clamp01(at.x), y: clamp01(at.y) } : spawnPoint(objectCount(board));
    return { ...board, slots: board.slots.map((s) => (s.id === id ? { ...s, placed: true, x: p.x, y: p.y } : s)) };
}

/** Takes a slot off the map; it stays in the Besetzung and stays assignable. */
export function unplaceSlot(board: RaidplanBoard, id: string): RaidplanBoard {
    return { ...board, slots: board.slots.map((s) => (s.id === id ? { ...s, placed: false } : s)) };
}

/**
 * What dropping a chip of the Besetzung does (pure, so it is testable): on the map the slot goes exactly there (an unplaced
 * one is placed, a placed one moves), on the bar a placed slot leaves the map, anywhere else nothing happens. It never adds
 * a slot or changes a count.
 */
export function dropChip(board: RaidplanBoard, slotId: string, target: "map" | "bar" | "none", at: { x: number; y: number } | null): RaidplanBoard {
    const s = board.slots.find((x) => x.id === slotId);
    if (!s || !isRoleKind(s.kind) && s.kind !== "group") return board;
    if (target === "map" && at) return placeSlot(board, slotId, at);
    if (target === "bar" && s.placed !== false) return unplaceSlot(board, slotId);
    return board;
}

/** The role slots of a board in Besetzung order: tanks, healers, melee, ranged, then the groups. */
export function besetzungSlots(board: RaidplanBoard): RaidplanSlot[] {
    const order = [...ROLE_KINDS, "group"];
    return board.slots.filter((s) => isRoleKind(s.kind)).sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind) || x.n - y.n);
}

/** Whether applying a profile or a template would overwrite something the orga already made (asks first). */
export function hasContent(board: RaidplanBoard): boolean {
    return board.assignments.length > 0 || board.notes.trim() !== "" || objectCount(board) > 0 || board.mapOpacity < 1 || board.objectScale !== 1;
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
    const own = board.assignments.filter((a) => a.type === "other");
    const kept = new Map(own.map((a) => [a.title.trim().toLowerCase(), a]));
    const rows = profile.targets.map((r) => {
        const old = kept.get(r.title.trim().toLowerCase());
        return old ? { ...old, title: r.title } : { id: newRowId(), type: "other" as RaidplanAssignType, title: r.title, spell: null, assignees: [], targets: [], note: "", suggested: false };
    });
    return { ...board, assignments: [...board.assignments.filter((a) => a.type !== "other"), ...rows], notes: profile.notes || board.notes, profileId: profile.id };
}

/** The rows of a board as a profile stores them: the titles of its assignments, no players. */
export function profileRows(board: RaidplanBoard): { title: string }[] {
    return board.assignments.map((a) => ({ title: a.title.trim() })).filter((r) => r.title);
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
    return objectCount(b) + b.assignments.length;
}

/** Players by userId, for looking up who a token or an assignment is. */
export function rosterMap(roster: RaidplanPlayer[]): Map<string, RaidplanPlayer> {
    return new Map(roster.map((p) => [p.userId, p]));
}
