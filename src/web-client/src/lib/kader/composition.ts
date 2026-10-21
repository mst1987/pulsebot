// The composition of a Kader (docs/kaderplaner.md, "Zusammensetzung"): who of
// Vorläufig and Roster plays which class, spec and role, how many of each role
// that makes, and which raid and party buffs the counted players bring. Bench and
// tentative are shown on demand and only counted when asked. Read-only and pure.
import type { KaderClassDef, KaderData, KaderEntry, KaderPartyBuff, KaderPlayer, KaderRaidBuff, KaderRole, KaderState, KaderView, KaderWish } from "../../api";
import { classDef, classOfSpec, specRole } from "./model";

/** The states always counted, and the ones the switch adds. */
export const BASE_STATES: KaderState[] = ["roster", "provisional"];
export const EXTRA_STATES: KaderState[] = ["bench", "tentative"];

/** One player of the composition: the pick it is counted with, its role (null = no spec or unknown). */
export type CompositionRow = {
    userId: string;
    entry: KaderEntry;
    pick: KaderWish | null;
    role: KaderRole | null;
    /** false for bench/tentative while the switch is off (shown, not counted). */
    counted: boolean;
};

/** A class block of the table; `classKey` "" collects the players without a class. */
export type CompositionClass = { classKey: string; rows: CompositionRow[]; counted: number; shown: number };

export type Composition = {
    rows: CompositionRow[];
    classes: CompositionClass[];
    roles: Record<KaderRole, number>;
    /** Counted players, with or without spec. */
    total: number;
    /** Counted players without a spec (not in the role counts). */
    noSpec: number;
    /** Bench + tentative, whatever the switch says (for its label). */
    extra: number;
};

/**
 * The spec a player is counted with: the decision, else the first wish, else the
 * prefilled character. A pick without a spec (class only) still names the class.
 */
export function compositionSpec(player: KaderPlayer | undefined, entry: KaderEntry): KaderWish | null {
    if (entry.decision && (entry.decision.spec || entry.decision.className)) return entry.decision;
    if (entry.wishes.length) return entry.wishes[0];
    if (player && player.prefill && player.prefill.className) return { className: player.prefill.className, spec: player.prefill.spec || "" };
    return null;
}

const classKeyOf = (pick: KaderWish | null): string => (pick ? pick.className || (pick.spec ? classOfSpec(pick.spec) : "") : "");

/** The composition of a Kader: Vorläufig + Roster, bench and tentative counted only `withExtra`. */
export function composition(view: KaderView, kader: KaderData, withExtra: boolean): Composition {
    const players = new Map(view.players.map((p) => [p.userId, p]));
    const rows: CompositionRow[] = [];
    let extra = 0;
    for (const [userId, entry] of Object.entries(kader.players)) {
        const base = BASE_STATES.includes(entry.state);
        const isExtra = EXTRA_STATES.includes(entry.state);
        if (isExtra) extra += 1;
        if (!base && !isExtra) continue;
        const pick = compositionSpec(players.get(userId), entry);
        rows.push({ userId, entry, pick, role: specRole(view.classes, pick ? pick.spec : ""), counted: base || withExtra });
    }
    const roles: Record<KaderRole, number> = { tank: 0, healer: 0, melee: 0, ranged: 0 };
    let total = 0;
    let noSpec = 0;
    for (const r of rows) {
        if (!r.counted) continue;
        total += 1;
        if (r.role) roles[r.role] += 1;
        else noSpec += 1;
    }
    const order = view.classes.map((c) => c.key);
    const byClass = new Map<string, CompositionRow[]>();
    for (const r of rows) {
        const key = classKeyOf(r.pick);
        const k = classDef(view.classes, key) ? key : "";
        byClass.set(k, [...(byClass.get(k) || []), r]);
    }
    const rank = (k: string) => (k ? order.indexOf(k) : order.length);
    const classes = [...byClass.entries()]
        .sort(([a], [b]) => rank(a) - rank(b))
        .map(([classKey, list]) => ({ classKey, rows: list, counted: list.filter((r) => r.counted).length, shown: list.length }));
    return { rows, classes, roles, total, noSpec, extra };
}

/** One buff and who brings it among the counted players. */
export type BuffCover = { key: string; buff: KaderRaidBuff; providers: string[]; donors: string[] };

/** The raid and party buffs of the version, each with the counted players bringing it (user ids, spec order of the table). */
export function buffCoverage(view: KaderView, rows: CompositionRow[]): { raid: BuffCover[]; party: BuffCover[] } {
    const counted = rows.filter((r) => r.counted && r.pick && r.pick.spec);
    const cover = (buff: KaderRaidBuff | KaderPartyBuff): BuffCover => ({
        key: buff.key,
        buff,
        providers: buff.providers,
        donors: counted.filter((r) => buff.providers.includes((r.pick as KaderWish).spec)).map((r) => r.userId),
    });
    return { raid: (view.buffs?.raid || []).map(cover), party: (view.buffs?.party || []).map(cover) };
}

/**
 * Who can bring a buff, by class: `{ classKey }` when every spec of the class
 * provides it, `{ classKey, specs }` when only some do. In the class order of the
 * rule set; specs of classes it does not know are left out.
 */
export function buffSources(classes: KaderClassDef[], providers: string[]): { classKey: string; specs: string[] | null }[] {
    const out: { classKey: string; specs: string[] | null }[] = [];
    for (const c of classes) {
        const own = c.specs.filter((s) => providers.includes(s.key)).map((s) => s.key);
        if (!own.length) continue;
        out.push({ classKey: c.key, specs: own.length === c.specs.length ? null : own });
    }
    return out;
}

/** The setup size a number of players is closest to (the smaller on a tie), null without sizes. */
export function nearestSize(sizes: number[], n: number): number | null {
    if (!sizes.length) return null;
    return [...sizes].sort((a, b) => a - b).reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best));
}
