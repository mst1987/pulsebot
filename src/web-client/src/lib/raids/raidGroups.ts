// Raid groups (#811) in the raid lists: the further raids of an evening ("Zul'Aman
// 2") stand under their first raid ("Zul'Aman · 2 Raids") instead of as raids of
// their own. Pure, so the list only draws.

/** What a list row needs to be grouped: the first raid's id on every raid of a group and its place. */
export type GroupableRow = { id: string; raidGroupId?: string; raidGroupIndex?: number };

/** A row with the further raids of its group (only on a group's first raid). */
export type GroupedRow<T> = T & { groupRaids?: T[] };

/** Whether a row is a further raid of a group (not the first). */
export function isFurtherRaid(row: GroupableRow): boolean {
    return !!row.raidGroupId && row.raidGroupId !== row.id;
}

/**
 * The rows with every further raid moved under its group's first raid
 * (`groupRaids`, in their order). A further raid whose first raid is not in the
 * list (another filter, another page) stays a row of its own.
 */
export function withRaidGroups<T extends GroupableRow>(rows: T[]): GroupedRow<T>[] {
    const heads = new Set(rows.filter((r) => !isFurtherRaid(r)).map((r) => r.id));
    const under = new Map<string, T[]>();
    for (const r of rows) {
        if (!isFurtherRaid(r) || !heads.has(r.raidGroupId as string)) continue;
        under.set(r.raidGroupId as string, [...(under.get(r.raidGroupId as string) || []), r]);
    }
    return rows
        .filter((r) => !isFurtherRaid(r) || !heads.has(r.raidGroupId as string))
        .map((r) => {
            const list = under.get(r.id);
            return list ? { ...r, groupRaids: list.slice().sort((a, b) => (a.raidGroupIndex || 0) - (b.raidGroupIndex || 0)) } : r;
        });
}
