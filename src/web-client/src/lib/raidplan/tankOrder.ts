import type { Besetzung, RaidplanBoard, RaidplanPlayer, RaidplanSlotKind } from "../../api";
import { effectiveCounts, ensureBesetzung, setCount } from "./besetzung";

// The tank line-up of the Standard for the other bosses: every section has its own Besetzung, filled in setup order the
// first time it is opened - so "Tank 1" is the setup's first tank on every boss. When the Standard's tanks are changed (the
// order, the number of tank slots, who stands in them), the editor asks whether the bosses should follow (RaidplanTab).
// Following gives each boss the Standard's line-up: as many tank slots, the Standard's tanks in its order. A tank who stands
// in another slot on that boss swaps places with whoever had his tank slot (nobody drops out of a slot he could take back);
// one who plays another role on that boss on purpose (a flex role that is not tank) stays where he is. The slots keep their
// place on the map.

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

/** The tank line-up of a board: how many tank slots it has, and who stands in which (slot number -> player, "" = open). */
export function tankLineup(board: RaidplanBoard): string[] {
    const tanks = board.slots.filter((s) => s.kind === "tank").sort((a, b) => a.n - b.n);
    return tanks.map((s) => s.userId || "");
}

/**
 * The board with the Standard's tank line-up (`want`, as tankLineup reads it): as many tank slots as the Standard (more are
 * added, fewer are cut from the end, as +/- on the boss would), and its tanks in Tank 1, Tank 2 ... in its order. Who stands
 * in another slot on this boss swaps with the one who had his tank slot. A player not in this boss's lineup, one who plays
 * another role here on purpose (a flex role other than tank) and an open slot of the Standard are skipped: the next tank
 * moves up. The same board when nothing changes.
 */
export function applyTankLineup(board: RaidplanBoard, want: string[], besetzung: Besetzung | null, roster: RaidplanPlayer[]): RaidplanBoard {
    let b = board;
    if (besetzung && effectiveCounts(b, besetzung, roster).tank !== want.length) b = ensureBesetzung(setCount(b, besetzung, "tank", want.length, roster), besetzung, roster);
    const known = new Set(roster.map((p) => p.userId));
    const slots = b.slots.map((s) => ({ ...s }));
    const roles = { ...b.roles };
    const moved = new Set<string>();
    // the Standard's tanks this boss can have, in its order: Tank 1 is the first of them (a "Tank 1 -> Boss" row needs one)
    const tanks = want.filter((u) => !!u && known.has(u) && !(roles[u] && roles[u] !== "tank"));
    tanks.forEach((u, i) => {
        const target = slots.find((s) => s.kind === "tank" && s.n === i + 1);
        if (!target || target.userId === u) return;
        const from = slots.find((s) => s.userId === u && s.kind !== "group");
        const other = target.userId;
        // a player moved by hand is no longer the slot's class pick (as a swap in "Besetzung zuweisen")
        target.userId = u;
        target.byClass = false;
        if (from) {
            from.userId = other;
            from.byClass = false;
        }
        moved.add(u);
        if (other) moved.add(other);
    });
    if (moved.size === 0) return b;
    // who stands in a tank slot tanks here (classRefs slotRoles), no flex role needed; a displaced one's flex "tank" goes with the slot
    for (const u of moved) {
        const s = slots.find((x) => x.userId === u && x.kind !== "group");
        if ((!s || s.kind !== "tank") && roles[u] === "tank") delete roles[u];
    }
    // a free token of a player who now stands in a slot goes, as with any slot assignment
    return { ...b, slots, roles, tokens: b.tokens.filter((k) => !(moved.has(k.userId) && slots.some((s) => s.userId === k.userId))) };
}

/** The sections (of `keys`) whose tank line-up would change by following `want`. */
export function differingKeys(boards: (key: string) => RaidplanBoard, keys: string[], want: string[], besetzung: Besetzung | null, roster: RaidplanPlayer[]): string[] {
    return keys.filter((k) => {
        const b = boards(k);
        return applyTankLineup(b, want, besetzung, roster) !== b;
    });
}
