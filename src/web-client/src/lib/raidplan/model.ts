import type { RaidplanBoard, RaidplanLook, RaidplanSlotKind, RaidplanAssignType } from "../../api";

export const RAID_MARKS = ["skull", "cross", "square", "moon", "triangle", "diamond", "circle", "star"];

export const ZONE_TYPES = ["danger", "healthy", "neutral", "custom"];

// What a new zone of a type starts with; the orga may pick any colour.
export const ZONE_COLORS = { danger: "#ef4444", healthy: "#22c55e", neutral: "#60a5fa", custom: "#a78bfa", role: "#f97316" };

// A role group placeholder ("Melees", "Ranged" ...): the roles in the order the palette offers them, their colours (the board's role colours).
export const ROLE_GROUPS = ["melee", "ranged", "healer", "tank", "dps"];

export const ROLE_GROUP_COLORS: Record<string, string> = { melee: "#f97316", ranged: "#a78bfa", healer: "#35d6c4", tank: "#60a5fa", dps: "#f5c542" };

/** The facing wedge of an icon: 25 % .. 300 % of its default size. */
export const ARROW_MIN = 0.25;

export const ARROW_MAX = 3;

export const ARROW_COLOR = "#ffb020";

export const MIN_ZONE = 0.03;

// The size of an object in px: what a new one starts with, and the range it can be set to.
export const SIZE_RANGES = {
    token: { def: 38, min: 10, max: 152 },
    slot: { def: 38, min: 10, max: 152 },
    mark: { def: 34, min: 9, max: 136 },
    icon: { def: 48, min: 12, max: 192 },
    member: { def: 38, min: 10, max: 152 },
    text: { def: 18, min: 5, max: 72 },
    line: { def: 4, min: 1, max: 16 },
};

export const SCALE_MIN = 0.4;

export const SCALE_MAX = 2;

export const DEFAULT_LINE_COLOR = "#f8fafc";

export const DEFAULT_TEXT_COLOR = "#f8fafc";

const MAX_HISTORY = 100;

/** The kinds of board objects one can select, move and delete; "auto" = one the tank rows put on the map (lib/raidplan/autoPlace.ts), id = its key. */
export type ObjectKind = "token" | "slot" | "mark" | "icon" | "zone" | "line" | "text" | "member" | "auto";

export type Selection = { kind: ObjectKind; id: string } | null;

export type Rect = { x: number; y: number; w: number; h: number };

export type Corner = "nw" | "ne" | "sw" | "se";

/** A grip of a zone: a corner (both sides) or the middle of an edge (only that side: height or width alone). */
export type ZoneGrip = Corner | "n" | "s" | "e" | "w";

export const ZONE_EDGES = ["n", "e", "s", "w"];

/** Where a role group's label may stand: inside, or outside on one side (it stays upright). */
export const LABEL_POS = ["in", "top", "bottom", "left", "right"];

/** What a palette entry, a tool bar button or a context-menu entry inserts. */
export type InsertSpec =
    | { type: "slot"; kind: RaidplanSlotKind; label: string }
    | { type: "mark"; mark: string }
    | { type: "zone"; zoneType: string; shape: string; role?: string }
    | { type: "line"; kind: string }
    | { type: "text"; text: string }
    | { type: "icon"; iconKey: string; label: string; mobId?: string }
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
    return { tokens: [], slots: [], marks: [], icons: [], zones: [], lines: [], texts: [], targets: [], assignments: [], steps: [], showMap: true, autoPlace: true, autoPos: {}, autoStyle: {}, autoScale: 1, mobs: [], hiddenCards: [], inheritOff: [], showRings: true, inSheet: true, groupColors: {}, groupMarks: {}, showNames: true, showBadges: true, showRoleRings: true, view: null, counts: null, roles: {}, notes: "", profileId: "", mapOpacity: 1, objectScale: 1 };
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
        // the tactic: ordered steps (an old board has none)
        steps: b.steps || [],
        // the section shows its map (a board from before the switch: yes, its objects and map stay)
        showMap: b.showMap !== false,
        // the tank rows put their mobs and tanks on the map (an old board: yes); what was moved by hand
        autoPlace: b.autoPlace !== false,
        autoPos: b.autoPos || {},
        autoStyle: b.autoStyle || {},
        autoScale: b.autoScale || 1,
        counts: b.counts || null,
        roles: b.roles || {},
        mobs: b.mobs || [],
        hiddenCards: b.hiddenCards || [],
        inheritOff: b.inheritOff || [],
        showRings: b.showRings !== false,
        inSheet: b.inSheet !== false,
        groupColors: b.groupColors || {},
        groupMarks: b.groupMarks || {},
        showNames: b.showNames !== false,
        showBadges: b.showBadges !== false,
        showRoleRings: b.showRoleRings !== false,
        view: b.view || null,
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
    const out: Record<string, RaidplanBoard> = {};
    for (const key of bossKeys) {
        if (!bosses[key]) continue;
        out[key] = boardOf(bosses, key);
    }
    return out;
}

/**
 * The section a raid plan opens on: a deep link (`?section=<key>`) when it names one, else the one the editor remembered for this plan,
 * else "Allgemein" when it is there and not left out, else the first section not left out, else the first. `hidden` = left out of the
 * sheet (the read view passes them; the editor shows every section).
 */
export function startSection(keys: { key: string; general?: boolean }[], wanted: string, remembered: string, hidden: string[]): string {
    if (wanted && keys.some((b) => b.key === wanted)) return wanted;
    if (remembered && keys.some((b) => b.key === remembered)) return remembered;
    const shown = keys.filter((b) => hidden.indexOf(b.key) < 0);
    const general = shown.find((b) => b.general);
    if (general) return general.key;
    if (shown.length > 0) return shown[0].key;
    return keys.length > 0 ? keys[0].key : "";
}

/** The section last open in a plan / template (this browser only); "" when none or the storage is blocked. */
export function rememberedSection(planId: string): string {
    try { return window.localStorage.getItem(`eh.raidplan.section.${planId}`) || ""; } catch { return ""; }
}

export function rememberSection(planId: string, key: string): void {
    try { window.localStorage.setItem(`eh.raidplan.section.${planId}`, key); } catch { /* private window */ }
}

/** The sections whose board differs from the saved one (the boss chips mark them "ungespeichert"). */
export function dirtyKeys(draft: Record<string, Partial<RaidplanBoard>>, saved: Record<string, Partial<RaidplanBoard>>, bossKeys: string[]): string[] {
    const a = toSave(draft, bossKeys);
    const b = toSave(saved, bossKeys);
    return bossKeys.filter((k) => JSON.stringify(a[k] || null) !== JSON.stringify(b[k] || null));
}

/** Whether two plans' bosses differ in what a save would carry. */
export function sameBosses(a: Record<string, Partial<RaidplanBoard>>, b: Record<string, Partial<RaidplanBoard>>, bossKeys: string[]): boolean {
    return JSON.stringify(toSave(a, bossKeys)) === JSON.stringify(toSave(b, bossKeys));
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
