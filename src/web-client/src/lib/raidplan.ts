// The raid plan's board logic (docs/raidplan.md), pure: what a board looks like
// when nothing is stored, who is not placed yet, moving / removing a token,
// applying a tactic profile, grouping profiles for the picker. The server checks
// and cleans every save again; these rules keep the page consistent while the
// orga works.
//
// Written to be strippable like setupEditor.ts (test/web-client/raidplan.test.js
// runs it for real): imports, `export type` and one-line signatures only, no
// typed locals or casts inside a body.
import type { RaidplanBoard, RaidplanPlayer, RaidplanProfile, RaidplanTarget } from "../api";

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

/** A fresh id for a target row (the server keeps it, or replaces an unusable one). */
export function newRowId(): string {
    return `r${Math.random().toString(36).slice(2, 9)}`;
}

/** A board with nothing on it. */
export function emptyBoard(): RaidplanBoard {
    return { tokens: [], targets: [], notes: "", profileId: "" };
}

/** The stored board of a boss, completed — a boss nobody touched has none. */
export function boardOf(bosses: Record<string, Partial<RaidplanBoard>>, key: string): RaidplanBoard {
    const b = bosses[key] || {};
    return {
        tokens: b.tokens || [],
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

/** The players of the roster who stand nowhere on this board yet, in setup order. */
export function unplaced(roster: RaidplanPlayer[], board: RaidplanBoard): RaidplanPlayer[] {
    const placed = new Set(board.tokens.map((t) => t.userId));
    return roster.filter((p) => !placed.has(p.userId));
}

/** Puts a token on the board at x/y (0..1): a new one, or the moved existing one. */
export function placeToken(board: RaidplanBoard, userId: string, x: number, y: number): RaidplanBoard {
    const token = { userId, x: clamp01(x), y: clamp01(y) };
    const has = board.tokens.some((t) => t.userId === userId);
    return {
        ...board,
        tokens: has ? board.tokens.map((t) => (t.userId === userId ? token : t)) : [...board.tokens, token],
    };
}

/** Takes a token off the board (the player is "not placed" again). Target rows keep their assignment. */
export function removeToken(board: RaidplanBoard, userId: string): RaidplanBoard {
    return { ...board, tokens: board.tokens.filter((t) => t.userId !== userId) };
}

/** Moves a token by a step (arrow keys), staying inside the board. */
export function nudgeToken(board: RaidplanBoard, userId: string, dx: number, dy: number): RaidplanBoard {
    const t = board.tokens.find((x) => x.userId === userId);
    if (!t) return board;
    return placeToken(board, userId, t.x + dx, t.y + dy);
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

/** Whether applying a profile would overwrite something the orga already wrote (asks first). */
export function hasContent(board: RaidplanBoard): boolean {
    return board.targets.length > 0 || board.notes.trim() !== "";
}

/**
 * The board after a profile was applied: its rows replace the board's rows, the
 * note comes along, `profileId` remembers where they came from. Players assigned
 * to a row whose title the profile keeps (ignoring case) stay assigned; tokens
 * are not touched.
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

/** How many tokens and rows a boss holds — the small number next to it in the boss list. */
export function boardCount(bosses: Record<string, Partial<RaidplanBoard>>, key: string): number {
    const b = boardOf(bosses, key);
    return b.tokens.length + b.targets.length;
}

/** Players by userId, for looking up who a token or an assignment is. */
export function rosterMap(roster: RaidplanPlayer[]): Map<string, RaidplanPlayer> {
    return new Map(roster.map((p) => [p.userId, p]));
}
