// "Gruppen im Plan" (#529): which raiders of the setup the raid plan picks from. The client twin of the server's
// src/services/raidplan/raidplanGroups.js (the same cases in planGroups.test.ts against the server module): the plan stores the setup
// groups it takes (`includedGroups`, group numbers plus optionally "bench"), `null` = the groups up to the raid's size (25 = 1..5)
// without the bench. The pool ("Angemeldet", #517) is never in the lineup the plan reads.
//
// The editor reads the roster ONCE through `splitRoster` (RaidplanTab): what the plan picks from goes to every consumer as `roster`
// (Besetzung, class references and priorities, suggestions, auto tokens, "Nicht platziert", group markers); the rest only names a raider
// a row already holds (`outOfPlan`: the chip warns "nicht im Plan").
import type { IncludedGroups, RaidplanPlayer } from "../../api";

export const BENCH = "bench";
/** 40 players = 8 groups: no raid has more */
export const MAX_GROUPS = 8;

/** The groups a raid of `groupCount` groups plans with by default: 1..groupCount, no bench. */
export function defaultIncludedGroups(groupCount: number): IncludedGroups {
    const n = Math.max(1, Math.min(MAX_GROUPS, Math.floor(Number(groupCount) || 0) || 1));
    return Array.from({ length: n }, (_, i) => i + 1);
}

/** A stored value, cleaned like the server does: group numbers 1..8 (each once, ascending) and "bench"; not a list = null (the default). */
export function cleanIncludedGroups(raw: unknown): IncludedGroups | null {
    if (!Array.isArray(raw)) return null;
    const nums = new Set<number>();
    let bench = false;
    for (const v of raw.slice(0, 20)) {
        if (v === BENCH) { bench = true; continue; }
        const n = typeof v === "number" || (typeof v === "string" && /^\d{1,2}$/.test(v)) ? Number(v) : NaN;
        if (Number.isInteger(n) && n >= 1 && n <= MAX_GROUPS) nums.add(n);
    }
    const out: IncludedGroups = [...nums].sort((a, b) => a - b);
    return bench ? [...out, BENCH] : out;
}

/** The groups a plan works with: what it stores, else the default for its size. */
export function includedGroups(stored: unknown, groupCount: number): IncludedGroups {
    const clean = cleanIncludedGroups(stored);
    return clean === null ? defaultIncludedGroups(groupCount) : clean;
}

/** Whether a raider is part of the plan: a bench raider only with "bench", a raider of a group only when it is on (gone / no group: stays). */
export function inPlan(player: RaidplanPlayer, included: IncludedGroups): boolean {
    if (player.gone) return true;
    if (player.bench) return included.indexOf(BENCH) >= 0;
    const g = Number(player.group) || 0;
    return g === 0 || included.indexOf(g) >= 0;
}

/** The raiders the plan picks from, in setup order. */
export function planRoster(roster: RaidplanPlayer[], included: IncludedGroups): RaidplanPlayer[] {
    return roster.filter((p) => inPlan(p, included));
}

/** The raiders outside the plan, marked `outOfPlan`. */
export function outOfPlanRoster(roster: RaidplanPlayer[], included: IncludedGroups): RaidplanPlayer[] {
    return roster.filter((p) => !inPlan(p, included)).map((p) => ({ ...p, outOfPlan: true }));
}

/** Both at once: `roster` for every consumer that picks, `outside` for naming a raider a row still holds. */
export function splitRoster(roster: RaidplanPlayer[], included: IncludedGroups): { roster: RaidplanPlayer[]; outside: RaidplanPlayer[] } {
    return { roster: planRoster(roster, included), outside: outOfPlanRoster(roster, included) };
}

/** One chip switched: on -> off, off -> on (kept in the stored order: numbers ascending, "bench" last). */
export function toggleIncluded(included: IncludedGroups, key: number | "bench"): IncludedGroups {
    const on = included.indexOf(key) >= 0;
    return cleanIncludedGroups(on ? included.filter((v) => v !== key) : [...included, key]) || [];
}

/** Whether a selection is the default for the raid's size (the chips show "Standard" then, and the reset arrow hides). */
export function isDefaultSelection(included: IncludedGroups, groupCount: number): boolean {
    const def = defaultIncludedGroups(groupCount);
    return included.length === def.length && def.every((v, i) => included[i] === v);
}

/**
 * The chips "Gruppen im Plan" offers: the groups of the raid's size, and any further group the lineup has (a setup with a 6th group), each
 * with how many raiders it holds; "bench" with its count when the setup has a bench.
 */
export function groupChoices(roster: RaidplanPlayer[], groupCount: number): { key: number | "bench"; count: number }[] {
    const max = Math.min(MAX_GROUPS, Math.max(groupCount, ...roster.filter((p) => !p.bench).map((p) => Number(p.group) || 0)));
    const out: { key: number | "bench"; count: number }[] = [];
    for (let g = 1; g <= max; g += 1) out.push({ key: g, count: roster.filter((p) => !p.bench && !p.gone && p.group === g).length });
    const bench = roster.filter((p) => p.bench).length;
    if (bench > 0) out.push({ key: BENCH, count: bench });
    return out;
}
