// Which blocks of the raid plan editor a viewer folded away (Roster slots, Taktik, the mobs bar, an assignment card …),
// remembered in this browser only (never in the plan, never shared between viewers). Pure parsing so it is testable without
// a DOM; the actual localStorage access (wrapped in try/catch - a private window or blocked storage must not break the
// page) lives in the hooks (hooks/useCollapse.ts).

/** A single block's remembered fold state from what localStorage held for its own key: "1" is folded, anything else is open. */
export function parseCollapsed(raw: string | null): boolean {
    return raw === "1";
}

/** The ids folded away from what localStorage held for a set of same-shaped blocks (the assignment cards, one per type): anything
 * that is not an array of strings is dropped, so a fresh browser (or corrupted storage) opens every block. */
export function parseCollapseSet(raw: string | null): string[] {
    try {
        const v = raw ? JSON.parse(raw) : [];
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
        return [];
    }
}

/** Toggles one id of a remembered set (on/off), keeping the others as they were. */
export function toggleCollapseId(ids: string[], id: string): string[] {
    return ids.indexOf(id) >= 0 ? ids.filter((x) => x !== id) : [...ids, id];
}
