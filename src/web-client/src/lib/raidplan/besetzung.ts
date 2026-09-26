import type { RaidplanBoard, RaidplanPlayer, RaidplanSlot, RaidplanSlotKind, Besetzung, BesetzungCounts } from "../../api";
import { boardOf, clamp01, newLook, SIZE_RANGES } from "./model";
import { objectCount, spawnPoint } from "./objects";

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
    return fillBesetzung(repairSlots(dropGone(board, roster), besetzung, roster), besetzung, roster);
}

/**
 * Whoever is no longer in the event's lineup (the setup changed after the plan was made) is taken off the board: their slot
 * is open again and a free token of them is removed, so nothing keeps showing a player who is not there. With no roster
 * (a template, or a setup not loaded yet) nothing is touched. Returns the same board when nobody is gone.
 */
export function dropGone(board: RaidplanBoard, roster: RaidplanPlayer[]): RaidplanBoard {
    if (roster.length === 0) return board;
    const known = new Set(roster.map((p) => p.userId));
    const gone = board.slots.some((s) => s.userId && !known.has(s.userId)) || board.tokens.some((k) => !known.has(k.userId));
    if (!gone) return board;
    return {
        ...board,
        slots: board.slots.map((s) => (s.userId && !known.has(s.userId) ? { ...s, userId: "" } : s)),
        tokens: board.tokens.filter((k) => known.has(k.userId)),
    };
}

function fillBesetzung(board: RaidplanBoard, besetzung: Besetzung, roster: RaidplanPlayer[]): RaidplanBoard {
    const want = slotCounts(effectiveCounts(board, besetzung, roster));
    const missing: { kind: string; n: number }[] = [];
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

/** A slot while repairSlots works on it: `__dupe` marks a leftover that still needs a free number (taken off before the board goes out). */
type MarkedSlot = RaidplanSlot & { __dupe?: boolean };

/**
 * Mends a board whose role slots got out of step (older versions let the palette make extra slots): the same kind and
 * number more than once is merged into one — it keeps the player, the map position and the size of the ones it
 * merges, and a second player or position is never thrown away (that slot gets a free number instead) — and slots
 * above what the Besetzung has that hold nobody and are not on the map go. Assignments refer to kind and number, so
 * they stay valid. Returns the same board when there is nothing to mend.
 */
export function repairSlots(board: RaidplanBoard, besetzung: Besetzung, roster: RaidplanPlayer[]): RaidplanBoard {
    const want = slotCounts(effectiveCounts(board, besetzung, roster));
    const seen: Map<string, MarkedSlot> = new Map();
    let changed = false;
    const out: MarkedSlot[] = [];
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

function withoutMark(s: MarkedSlot): RaidplanSlot {
    const c = { ...s };
    Reflect.deleteProperty(c, "__dupe");
    return c;
}

/** Two slots of the same kind and number become one: the first takes the player, the position and the size the second has and it lacks; what cannot be taken over stays as a slot of its own (`rest`). */
function mergeSlot(a: RaidplanSlot, b: RaidplanSlot): { keep: RaidplanSlot; rest: MarkedSlot | null } {
    let keep = a;
    let rest: MarkedSlot | null = null;
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
    return board.assignments.length > 0 || (board.steps || []).length > 0 || board.notes.trim() !== "" || objectCount(board) > 0 || board.mapOpacity < 1 || board.objectScale !== 1;
}

/** Whether any board of a plan holds something. */
export function planHasContent(bosses: Record<string, Partial<RaidplanBoard>>, bossKeys: string[]): boolean {
    return bossKeys.some((k) => hasContent(boardOf(bosses, k)));
}
