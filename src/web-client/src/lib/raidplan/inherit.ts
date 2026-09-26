// The "Standard" of a raid plan template on the client (the server's twin is src/web/raidplanInherit.js): rows entered once for
// every boss, inherited by each section, deviated from or switched off per boss. Pure. Tests: src/web-client/src/lib/inherit.test.ts.
import type { RaidplanAssignment, RaidplanAssignTarget, RaidplanBoard, RaidplanMobRef } from "../../api";
import { newRowId } from "./model.ts";

/** The key of the board that holds the Standard, and the relative target "the boss of the section this row lands in". */
export const DEFAULTS_KEY = "defaults";
export const THIS_BOSS = "b:this";

/** What a section offers as mob targets: its boss (null in trash) and every mob it has. */
export type InheritSection = { bossMob: RaidplanMobRef | null; mobs: RaidplanMobRef[] };

/** A default row as it lands in a section: the relative boss target becomes the section's boss, mob targets the section lacks are dropped. */
export function resolveInherited(row: RaidplanAssignment, section: InheritSection): RaidplanAssignment {
    const targets: RaidplanAssignTarget[] = [];
    for (const tg of row.targets) {
        if (tg.kind !== "mob") { targets.push(tg); continue; }
        if (tg.ref === THIS_BOSS) {
            if (section.bossMob) targets.push({ kind: "mob", ref: section.bossMob.id, name: section.bossMob.name, icon: section.bossMob.icon });
        } else {
            const m = section.mobs.find((x) => x.id === tg.ref);
            // the instance number ("Flame of Azzinoth 2") goes along
            if (m) targets.push(tg.n ? { kind: "mob", ref: m.id, name: m.name, icon: m.icon, n: tg.n } : { kind: "mob", ref: m.id, name: m.name, icon: m.icon });
        }
    }
    return { ...row, targets, origin: row.id, suggested: false };
}

/** The rows a section inherits: every default row that is not switched off for it, resolved (ids stay the default's). */
export function inheritedRows(defaults: RaidplanAssignment[], off: string[], section: InheritSection): RaidplanAssignment[] {
    const skip = off || [];
    return defaults.filter((r) => skip.indexOf(r.id) < 0).map((r) => resolveInherited(r, section));
}

/** "Vom Standard abweichen": the row becomes the boss's own (a copy with a fresh id that remembers where it comes from), the default row is switched off for this boss. */
export function deviate(board: RaidplanBoard, row: RaidplanAssignment): RaidplanBoard {
    const own = { ...row, id: newRowId(), origin: row.origin || row.id };
    return { ...board, assignments: [...board.assignments, own], inheritOff: [...(board.inheritOff || []).filter((x) => x !== row.id), row.id] };
}

/** The boss does not want this default row at all. */
export function hideInherited(board: RaidplanBoard, defaultId: string): RaidplanBoard {
    return { ...board, inheritOff: [...(board.inheritOff || []).filter((x) => x !== defaultId), defaultId] };
}

/** Whether a row of the board is a copy of a default row (one the boss deviated with). */
export function isDeviation(row: RaidplanAssignment): boolean {
    return !!row.origin && row.origin !== "default";
}

/** "Standard wiederherstellen" for one card type (or all types with ""): the boss's copies of default rows go, the default rows are inherited again. */
export function restoreInherited(board: RaidplanBoard, defaults: RaidplanAssignment[], type: string): RaidplanBoard {
    const ofType = defaults.filter((r) => !type || String(r.type) === type).map((r) => r.id);
    return {
        ...board,
        assignments: board.assignments.filter((a) => !(isDeviation(a) && ofType.indexOf(a.origin || "") >= 0)),
        inheritOff: (board.inheritOff || []).filter((x) => ofType.indexOf(x) < 0),
    };
}

/** Whether there is anything to restore for a card type: the boss deviated from or switched off a default row of it. */
export function canRestore(board: RaidplanBoard, defaults: RaidplanAssignment[], type: string): boolean {
    const ofType = defaults.filter((r) => String(r.type) === type).map((r) => r.id);
    return (board.inheritOff || []).some((x) => ofType.indexOf(x) >= 0);
}

/** Whether a boss board differs from the Standard at all (a deviation or a switched-off row). */
export function differs(board: Partial<RaidplanBoard> | undefined): boolean {
    if (!board) return false;
    return (board.inheritOff || []).length > 0 || (board.assignments || []).some((a) => isDeviation(a));
}

/**
 * "Standard auf alle Bosse anwenden (kopieren)": writes the default rows into every boss that does not differ from the Standard
 * as its own rows (resolved for that section, marked `origin: "default"`) and switches the inherited ones off, so nothing shows
 * twice. Bosses that deviate are left alone. `sections` maps a boss key to its section; keys without one are skipped.
 */
export function copyDefaultsToAll(bosses: Record<string, Partial<RaidplanBoard>>, defaults: RaidplanAssignment[], sections: Record<string, InheritSection>): Record<string, Partial<RaidplanBoard>> {
    const out = { ...bosses };
    for (const key of Object.keys(sections)) {
        const b = bosses[key] || {};
        if (differs(b)) continue;
        const rows = defaults.map((r) => ({ ...resolveInherited(r, sections[key]), id: newRowId(), origin: "default" }));
        out[key] = { ...b, assignments: [...(b.assignments || []), ...rows], inheritOff: defaults.map((r) => r.id) };
    }
    return out;
}
