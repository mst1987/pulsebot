// The raid plan's board logic (docs/raidplan.md), pure: what a board looks like
// when nothing is stored, who is not placed yet, moving / removing objects
// (player tokens, slots, marks, zones), scaling a zone, applying a tactic
// profile, grouping profiles for the picker. The server checks and cleans every
// save again; these rules keep the page consistent while the orga works.
//
// Written to be strippable like setupEditor.ts (test/web-client/raidplan.test.js
// runs it for real, with `t` injected): imports, `export type`, `export const`
// tables and one-line signatures only, no typed locals or casts inside a body.
import type {
    RaidplanBoard, RaidplanMarkName, RaidplanPlayer, RaidplanProfile, RaidplanSlot, RaidplanSlotKind, RaidplanTarget, RaidplanZone, RaidplanZoneType,
} from "../api";
import { t } from "../i18n";

export const RAID_MARKS = ["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"];
export const ZONE_TYPES = ["danger", "healthy", "neutral", "custom"];
// What a new zone of a type starts with; the orga may pick any colour.
export const ZONE_COLORS = { danger: "#ef4444", healthy: "#22c55e", neutral: "#60a5fa", custom: "#a78bfa" };
export const MIN_ZONE = 0.03;

/** The kinds of board objects one can select, move and delete. */
export type ObjectKind = "token" | "slot" | "mark" | "zone";
export type Selection = { kind: ObjectKind; id: string } | null;
export type Rect = { x: number; y: number; w: number; h: number };
export type Corner = "nw" | "ne" | "sw" | "se";

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

/** A fresh id for a target row or a board object (the server keeps it, or replaces an unusable one). */
export function newRowId(): string {
    return `r${Math.random().toString(36).slice(2, 9)}`;
}

/** A board with nothing on it. */
export function emptyBoard(): RaidplanBoard {
    return { tokens: [], slots: [], marks: [], zones: [], targets: [], notes: "", profileId: "" };
}

/** The stored board of a boss, completed — a boss nobody touched has none. */
export function boardOf(bosses: Record<string, Partial<RaidplanBoard>>, key: string): RaidplanBoard {
    const b = bosses[key] || {};
    return {
        tokens: b.tokens || [],
        slots: b.slots || [],
        marks: b.marks || [],
        zones: b.zones || [],
        targets: b.targets || [],
        notes: b.notes || "",
        profileId: b.profileId || "",
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
    const token = { userId, x: clamp01(x), y: clamp01(y) };
    const has = board.tokens.some((k) => k.userId === userId);
    return {
        ...board,
        slots: board.slots.map((s) => (s.userId === userId ? { ...s, userId: "" } : s)),
        tokens: has ? board.tokens.map((k) => (k.userId === userId ? token : k)) : [...board.tokens, token],
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

// New objects appear near the middle, each a little off the last so they do not pile up.
function spawnPoint(count: number): { x: number; y: number } {
    const step = count % 8;
    return { x: 0.42 + step * 0.03, y: 0.42 + step * 0.03 };
}

/** Adds a slot of a kind ("Tank 3"); a free label carries its own text. */
export function addSlot(board: RaidplanBoard, kind: RaidplanSlotKind, label: string): RaidplanBoard {
    const at = spawnPoint(board.slots.length + board.marks.length);
    const slot = { id: newRowId(), kind, n: nextSlotNumber(board, kind), label, x: at.x, y: at.y, userId: "" };
    return { ...board, slots: [...board.slots, slot] };
}

export function addMark(board: RaidplanBoard, mark: RaidplanMarkName): RaidplanBoard {
    const at = spawnPoint(board.slots.length + board.marks.length);
    return { ...board, marks: [...board.marks, { id: newRowId(), mark, x: at.x, y: at.y }] };
}

/** Adds a zone of a type in that type's preset colour. */
export function addZone(board: RaidplanBoard, type: RaidplanZoneType, shape: "rect" | "ellipse"): RaidplanBoard {
    const at = spawnPoint(board.zones.length);
    const zone = { id: newRowId(), shape, type, label: "", color: ZONE_COLORS[type], opacity: 0.3, x: at.x - 0.1, y: at.y - 0.1, w: 0.2, h: 0.2 };
    return { ...board, zones: [...board.zones, zone] };
}

export function updateSlot(board: RaidplanBoard, id: string, patch: Partial<RaidplanSlot>): RaidplanBoard {
    return { ...board, slots: board.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

export function updateZone(board: RaidplanBoard, id: string, patch: Partial<RaidplanZone>): RaidplanBoard {
    return { ...board, zones: board.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) };
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

/** Moves an object's anchor to x/y (0..1) — a token, slot or mark; a zone keeps its size and is placed by its top-left corner. */
export function moveObject(board: RaidplanBoard, kind: ObjectKind, id: string, x: number, y: number): RaidplanBoard {
    if (kind === "token") return placeToken(board, id, x, y);
    if (kind === "slot") return { ...board, slots: board.slots.map((s) => (s.id === id ? { ...s, x: clamp01(x), y: clamp01(y) } : s)) };
    if (kind === "mark") return { ...board, marks: board.marks.map((m) => (m.id === id ? { ...m, x: clamp01(x), y: clamp01(y) } : m)) };
    return { ...board, zones: board.zones.map((z) => (z.id === id ? { ...z, ...moveRect(z, x - z.x, y - z.y) } : z)) };
}

/** The anchor of an object (a token / slot / mark's centre, a zone's top-left corner), or null when it is gone. */
export function objectPoint(board: RaidplanBoard, kind: ObjectKind, id: string): { x: number; y: number } | null {
    const list = kind === "token" ? board.tokens.filter((k) => k.userId === id)
        : kind === "slot" ? board.slots.filter((s) => s.id === id)
            : kind === "mark" ? board.marks.filter((m) => m.id === id)
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
    return { ...board, zones: board.zones.filter((z) => z.id !== id) };
}

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
    return board.targets.length > 0 || board.notes.trim() !== "" || board.slots.length > 0 || board.marks.length > 0 || board.zones.length > 0 || board.tokens.length > 0;
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
    return b.tokens.length + b.targets.length + b.slots.length + b.marks.length + b.zones.length;
}

/** Players by userId, for looking up who a token or an assignment is. */
export function rosterMap(roster: RaidplanPlayer[]): Map<string, RaidplanPlayer> {
    return new Map(roster.map((p) => [p.userId, p]));
}
