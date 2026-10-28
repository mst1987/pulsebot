// Top-Items per server and game version (#952): the pure part of the page —
// which boss a picked item belongs to, how many are picked per boss, and the
// list "Ohne Zuordnung" (items no boss of the version's loot table drops).
import type { TopItem, TopItemRaid } from "../../api";

/** The key of the view "Ohne Zuordnung" in the boss list. */
export const UNASSIGNED = "__unassigned";

/** A boss's key in the list: raid and boss, so two raids never share one. */
export function bossKey(raidId: string, boss: string): string {
    return `${raidId}::${boss}`;
}

/** The ids of every item the loot table of the version knows. */
export function tableItemIds(raids: TopItemRaid[]): Set<number> {
    const ids = new Set<number>();
    for (const raid of raids) for (const boss of raid.bosses) for (const it of boss.items) ids.add(it.id);
    return ids;
}

/** The boss key of the first boss dropping the item, "" when none does. */
export function bossOfItem(raids: TopItemRaid[], id: number): string {
    for (const raid of raids) {
        for (const boss of raid.bosses) {
            if (boss.items.some((it) => it.id === id)) return bossKey(raid.id, boss.name);
        }
    }
    return "";
}

/** Picked items per boss key, plus UNASSIGNED for the ones no boss drops. */
export function pickedCounts(raids: TopItemRaid[], picked: TopItem[]): Map<string, number> {
    const ids = new Set(picked.map((it) => it.id));
    const out = new Map<string, number>();
    for (const raid of raids) {
        for (const boss of raid.bosses) {
            const n = boss.items.filter((it) => ids.has(it.id)).length;
            if (n) out.set(bossKey(raid.id, boss.name), n);
        }
    }
    const loose = unassignedItems(raids, picked, []).length;
    if (loose) out.set(UNASSIGNED, loose);
    return out;
}

/**
 * The rows of "Ohne Zuordnung": the picked items no boss drops, then the ones
 * switched off in this visit (so a slip can be switched on again), each once.
 */
export function unassignedItems(raids: TopItemRaid[], picked: TopItem[], switchedOff: TopItem[]): TopItem[] {
    const inTable = tableItemIds(raids);
    const out: TopItem[] = [];
    const seen = new Set<number>();
    for (const it of [...picked, ...switchedOff]) {
        if (inTable.has(it.id) || seen.has(it.id)) continue;
        seen.add(it.id);
        out.push(it);
    }
    return out;
}

/** The first boss of the table, else "Ohne Zuordnung" (a version without one). */
export function firstView(raids: TopItemRaid[]): string {
    const raid = raids.find((r) => r.bosses.length);
    return raid ? bossKey(raid.id, raid.bosses[0].name) : UNASSIGNED;
}
