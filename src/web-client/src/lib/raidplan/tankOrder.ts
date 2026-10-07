import type { RaidplanBoard, RaidplanSlotKind } from "../../api";

// The tank order of the Standard for the other bosses: every section has its own Besetzung, filled in setup order the first
// time it is opened - so "Tank 1" is the setup's first tank on every boss. When the Standard's order is changed, the editor
// asks whether the bosses should follow (RaidplanTab). Following is a pure reordering: on each boss only the players who
// already stand in its tank slots change places - nobody is added or removed (a flex role of that boss stays), the slots
// keep their place on the map, an open slot stays open.

/** Who stands in the slots of a kind, in slot order (Tank 1, Tank 2 ...); open slots are left out. */
export function roleOrder(board: RaidplanBoard, kind: RaidplanSlotKind = "tank"): string[] {
    return board.slots
        .filter((s) => s.kind === kind && !!s.userId)
        .sort((a, b) => a.n - b.n)
        .map((s) => s.userId);
}

/** Two orders are the same: the same players in the same places. */
export function sameOrder(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((u, i) => u === b[i]);
}

/**
 * The board with the players of its `kind` slots sorted by `order`: who is in `order` comes first, in that order, the rest
 * follows in the board's own order. The occupied slots take the players in their order (Tank 1 the first ...). The same
 * board when nothing moves.
 */
export function applyRoleOrder(board: RaidplanBoard, order: string[], kind: RaidplanSlotKind = "tank"): RaidplanBoard {
    const occupied = board.slots.filter((s) => s.kind === kind && !!s.userId).sort((a, b) => a.n - b.n);
    const present = occupied.map((s) => s.userId);
    const sorted = [...order.filter((u) => present.includes(u)), ...present.filter((u) => !order.includes(u))];
    if (sameOrder(present, sorted)) return board;
    const next = new Map(occupied.map((s, i) => [s.id, sorted[i]]));
    return {
        ...board,
        // a player moved by hand is no longer the slot's class pick (as a swap in "Besetzung zuweisen")
        slots: board.slots.map((s) => (next.has(s.id) && next.get(s.id) !== s.userId ? { ...s, userId: next.get(s.id) as string, byClass: false } : s)),
    };
}

/** The sections (of `keys`) whose order of `kind` would change by following `order`. */
export function differingKeys(boards: (key: string) => RaidplanBoard, keys: string[], order: string[], kind: RaidplanSlotKind = "tank"): string[] {
    return keys.filter((k) => {
        const b = boards(k);
        return applyRoleOrder(b, order, kind) !== b;
    });
}
