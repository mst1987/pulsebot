// Giving the roster slots (Tank 1..n, Heiler 1..n, DPS / Melee / Ranged n) to players in the event plan: assign with a swap, clear, fill
// what is open by role and class, and the candidates of a slot. Pure (a board goes in, a board comes out, one undo step each), so the
// rules are tested (src/web-client/src/lib/rosterAssign.test.ts). Written with function declarations and one-line signatures only.
import type { RaidplanBoard, RaidplanPlayer, RaidplanSlot } from "../api";
import { assignSlot, roleOn } from "./raidplan";

/** The role slots a player can be given (a group marker and a label are no places for a person). */
export const ROLE_SLOT_KINDS = ["tank", "healer", "melee", "ranged", "dps"];

export function isRoleSlot(slot: RaidplanSlot): boolean {
    return ROLE_SLOT_KINDS.indexOf(slot.kind) >= 0;
}

/** The role slots of a board in the order the roster shows them: by kind, then by number. */
export function roleSlots(board: RaidplanBoard): RaidplanSlot[] {
    return board.slots.filter((s) => isRoleSlot(s)).sort((a, b) => ROLE_SLOT_KINDS.indexOf(a.kind) - ROLE_SLOT_KINDS.indexOf(b.kind) || a.n - b.n);
}

/** Whether a player of this role (on this boss) fits a slot of this kind: an exact match, or any damage dealer in a generic DPS slot. */
export function fitsSlot(kind: string, role: string): boolean {
    if (kind === "dps") return role !== "tank" && role !== "healer";
    return role === kind;
}

/** The slot a player stands in, or null. */
export function slotOfPlayer(board: RaidplanBoard, userId: string): RaidplanSlot | null {
    return board.slots.find((s) => s.userId === userId && isRoleSlot(s)) || null;
}

/**
 * Gives a slot to a player. A player stands in one place: when he already stands in another slot, the two SWAP (the slot's
 * former player goes to his old one) instead of him being in two; a free token of him is taken off the map. "" empties the slot.
 */
export function assignOrSwap(board: RaidplanBoard, slotId: string, userId: string): RaidplanBoard {
    const target = board.slots.find((s) => s.id === slotId);
    if (!target) return board;
    if (!userId) return assignSlot(board, slotId, "");
    const from = board.slots.find((s) => s.userId === userId && s.id !== slotId);
    const next = assignSlot(board, slotId, userId);
    if (!from || !target.userId) return next;
    // the occupant of the slot goes to the slot the player left
    return { ...next, slots: next.slots.map((s) => (s.id === from.id ? { ...s, userId: target.userId, byClass: false } : s)) };
}

/** Empties one slot (the player is then "nicht platziert" unless he stands elsewhere). */
export function clearSlot(board: RaidplanBoard, slotId: string): RaidplanBoard {
    return { ...board, slots: board.slots.map((s) => (s.id === slotId ? { ...s, userId: "", byClass: false } : s)) };
}

/** Empties every role slot. */
export function clearAllSlots(board: RaidplanBoard): RaidplanBoard {
    return { ...board, slots: board.slots.map((s) => (isRoleSlot(s) ? { ...s, userId: "", byClass: false } : s)) };
}

/**
 * Fills the OPEN role slots from the players who stand in no slot yet, never touching a slot that has a player (a manual choice stays):
 * first the slots that ask for a class (the first free player of the slot's role in the order of its classes, setup order among the
 * same class; nobody of the class = the slot stays open, a stranger never takes it), then the others — the exact roles first — with
 * whoever is left. A player fills one slot. Returns the same board when nothing could be filled.
 */
export function fillOpenSlots(board: RaidplanBoard, roster: RaidplanPlayer[]): RaidplanBoard {
    const taken = {};
    for (const s of board.slots) if (s.userId) taken[s.userId] = true;
    const free = (kind, extra) => roster.filter((p) => !taken[p.userId] && fitsSlot(kind, roleOn(board, p)) && extra(p));
    const fills = {};
    const bound = {};
    const open = (kind) => board.slots.filter((s) => s.kind === kind && !s.userId).sort((a, b) => a.n - b.n);
    for (const kind of ["tank", "healer", "melee", "ranged", "dps"]) {
        for (const s of open(kind)) {
            const wish = s.preferredClasses || [];
            if (wish.length === 0) continue;
            bound[s.id] = true;
            for (const cls of wish) {
                const p = free(kind, (x) => x.classId === cls)[0];
                if (p) { taken[p.userId] = true; fills[s.id] = p.userId; break; }
            }
        }
    }
    for (const kind of ["tank", "healer", "melee", "ranged", "dps"]) {
        for (const s of open(kind)) {
            if (bound[s.id]) continue;
            const p = free(kind, () => true)[0];
            if (!p) break;
            taken[p.userId] = true;
            fills[s.id] = p.userId;
        }
    }
    const ids = Object.keys(fills);
    if (ids.length === 0) return board;
    return { ...board, tokens: board.tokens.filter((k) => ids.every((id) => fills[id] !== k.userId)), slots: board.slots.map((s) => (fills[s.id] ? { ...s, userId: fills[s.id], byClass: !!bound[s.id] } : s)) };
}

/** Which players a slot's picker offers: the ones that fit its role first (its classes first among them), then everybody else; each with the slot he stands in now. */
export function slotCandidates(board: RaidplanBoard, slot: RaidplanSlot, roster: RaidplanPlayer[]): { player: RaidplanPlayer; fits: boolean; at: RaidplanSlot | null }[] {
    const wish = slot.preferredClasses || [];
    function rank(p) {
        const i = wish.indexOf(p.classId);
        return i < 0 ? wish.length : i;
    }
    const rows = roster.map((p, i) => ({ player: p, fits: fitsSlot(slot.kind, roleOn(board, p)), at: slotOfPlayer(board, p.userId), i }));
    rows.sort((a, b) => (a.fits === b.fits ? 0 : a.fits ? -1 : 1) || (a.fits && b.fits ? rank(a.player) - rank(b.player) : 0) || a.i - b.i);
    return rows.map((r) => ({ player: r.player, fits: r.fits, at: r.at }));
}

/** Toggles a class on a slot's wish list (the order of choosing is the priority). */
export function toggleSlotClass(board: RaidplanBoard, slotId: string, classId: string): RaidplanBoard {
    return {
        ...board,
        slots: board.slots.map((s) => {
            if (s.id !== slotId) return s;
            const cur = s.preferredClasses || [];
            return { ...s, preferredClasses: cur.indexOf(classId) >= 0 ? cur.filter((c) => c !== classId) : [...cur, classId] };
        }),
    };
}

/** Sets the wish of the slots of a row (the row's classes go to the slots it names as assignees: "slot:dps:3"). */
export function bindClassesToSlots(board: RaidplanBoard, refs: string[], classes: string[]): RaidplanBoard {
    const keys = refs.filter((r) => r.indexOf("slot:") === 0).map((r) => r.slice(5));
    return { ...board, slots: board.slots.map((s) => (keys.indexOf(`${s.kind}:${s.n}`) >= 0 && isRoleSlot(s) ? { ...s, preferredClasses: classes.slice() } : s)) };
}

/** What a bound slot says at a glance: "filled" (by class), "missing" (open and nobody of the class is in the raid), "open" (bound, not filled yet), or "" (no wish). */
export function classStatus(slot: RaidplanSlot, roster: RaidplanPlayer[], board: RaidplanBoard): string {
    const wish = slot.preferredClasses || [];
    if (wish.length === 0) return "";
    if (slot.userId) return "filled";
    const someone = roster.some((p) => wish.indexOf(p.classId) >= 0 && fitsSlot(slot.kind, roleOn(board, p)) && !slotOfPlayer(board, p.userId));
    return someone ? "open" : "missing";
}

/** The classes the role slots named as assignees of a row ask for (in the order of the row's assignees, each class once). */
export function slotClassesOfRow(board: RaidplanBoard, row: { assignees: string[] }): string[] {
    const out = [];
    for (const ref of row.assignees || []) {
        const p = ref.split(":");
        if (p[0] !== "slot") continue;
        const s = board.slots.find((x) => x.kind === p[1] && String(x.n) === p[2] && isRoleSlot(x));
        for (const c of (s && s.preferredClasses) || []) if (out.indexOf(c) < 0) out.push(c);
    }
    return out;
}

/** The classes a row is suggested for: what its slots ask for wins over the row's own choice (and that over the catalog's default, decided by the caller). */
export function effectiveClasses(board: RaidplanBoard, row: { assignees: string[]; preferredClasses?: string[] }): string[] {
    const fromSlots = slotClassesOfRow(board, row);
    return fromSlots.length > 0 ? fromSlots : row.preferredClasses || [];
}

/** Assigns the class-bound slots anew: a bound slot whose player is not of its class, or who was put there by class, is emptied; then the open slots are filled. */
export function refillByClass(board: RaidplanBoard, roster: RaidplanPlayer[]): RaidplanBoard {
    const byId = {};
    for (const p of roster) byId[p.userId] = p;
    const cleared = {
        ...board,
        slots: board.slots.map((s) => {
            const wish = s.preferredClasses || [];
            if (wish.length === 0 || !isRoleSlot(s) || !s.userId) return s;
            const p = byId[s.userId];
            return s.byClass || !p || wish.indexOf(p.classId) < 0 ? { ...s, userId: "", byClass: false } : s;
        }),
    };
    return fillOpenSlots(cleared, roster);
}
