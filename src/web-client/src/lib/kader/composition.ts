// The composition of a Kader (docs/kaderplaner.md, "Zusammensetzung"): who of
// Vorläufig and Roster plays which class, spec and role, how many of each role
// that makes, and which raid and party buffs the counted players bring. Bench and
// tentative are shown on demand and only counted when asked. With the shared draft
// ("Planspiel") a planned spec replaces the shown one and a left-out player counts
// nowhere; `planDiff` says what the draft changes. Pure.
import type { KaderClassDef, KaderData, KaderEntry, KaderPartyBuff, KaderPlan, KaderPlayer, KaderRaidBuff, KaderRole, KaderState, KaderView, KaderWish } from "../../api";
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
    /** false for bench/tentative while the switch is off and for players the draft leaves out (shown, not counted). */
    counted: boolean;
    /** The spec without the draft, set only when the draft plans another one ("vorher …"). */
    was?: KaderWish | null;
    /** With `was`: the player has no decision yet, so the draft's spec becomes the first one ("vorher: keine Entscheidung"). */
    undecided?: boolean;
    /** The draft leaves the player out. */
    excluded?: boolean;
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

/** Two picks name the same spec of the same class. */
export const sameSpec = (a: KaderWish | null | undefined, b: KaderWish | null | undefined): boolean =>
    (a ? a.spec || "" : "") === (b ? b.spec || "" : "") && classKeyOf(a || null) === classKeyOf(b || null);

/**
 * The composition of a Kader: Vorläufig + Roster, bench and tentative counted only `withExtra`.
 * With a draft (`plan`) planned specs replace the shown ones and left-out players count nowhere.
 */
export function composition(view: KaderView, kader: KaderData, withExtra: boolean, plan: KaderPlan | null = null): Composition {
    const players = new Map(view.players.map((p) => [p.userId, p]));
    const rows: CompositionRow[] = [];
    let extra = 0;
    for (const [userId, entry] of Object.entries(kader.players)) {
        const base = BASE_STATES.includes(entry.state);
        const isExtra = EXTRA_STATES.includes(entry.state);
        if (isExtra) extra += 1;
        if (!base && !isExtra) continue;
        const shown = compositionSpec(players.get(userId), entry);
        const planned = plan ? plan.specs[userId] : undefined;
        const pick = planned && !sameSpec(planned, shown) ? planned : shown;
        const excluded = !!plan && plan.excluded.includes(userId);
        const row: CompositionRow = { userId, entry, pick, role: specRole(view.classes, pick ? pick.spec : ""), counted: (base || withExtra) && !excluded };
        if (pick !== shown) row.was = shown;
        else if (planned && !decides(entry, planned)) {
            // the planned spec is the one shown (the first wish) but not yet the decision: taking over sets it, so a change
            row.was = entry.decision && entry.decision.spec ? entry.decision : null;
            if (!entry.decision || !(entry.decision.spec || entry.decision.className)) row.undecided = true;
        }
        if (excluded) row.excluded = true;
        rows.push(row);
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

/** How the draft changes one buff: now there, gone, or now brought twice where one brought it before. */
export type BuffChange = { key: string; buff: KaderRaidBuff; change: "now" | "gone" | "double" };

/** What the draft changes against the page without it ("+1 Heiler · −1 Fernkampf · Kampfrausch jetzt doppelt"). */
export type PlanDiff = {
    /** Only roles whose count changes, tank first. */
    roles: { role: KaderRole; delta: number }[];
    /** Players the draft leaves out (and that would count otherwise). */
    excluded: number;
    buffs: BuffChange[];
    /** Players with a planned spec or left out — the "3 Änderungen" of the bar. */
    changes: number;
};

/** The difference between the composition without the draft and with it (both with the same switch). */
export function planDiff(
    before: Composition, after: Composition,
    buffsBefore: { raid: BuffCover[]; party: BuffCover[] }, buffsAfter: { raid: BuffCover[]; party: BuffCover[] },
): PlanDiff {
    const roles = (Object.keys(after.roles) as KaderRole[])
        .map((role) => ({ role, delta: after.roles[role] - before.roles[role] }))
        .filter((r) => r.delta !== 0);
    const was = new Map([...buffsBefore.raid, ...buffsBefore.party].map((c) => [c.key, c.donors.length]));
    const buffs: BuffChange[] = [];
    for (const c of [...buffsAfter.raid, ...buffsAfter.party]) {
        const a = was.get(c.key) || 0;
        const b = c.donors.length;
        if (a === 0 && b > 0) buffs.push({ key: c.key, buff: c.buff, change: "now" });
        else if (a > 0 && b === 0) buffs.push({ key: c.key, buff: c.buff, change: "gone" });
        else if (a === 1 && b > 1) buffs.push({ key: c.key, buff: c.buff, change: "double" });
    }
    const excluded = after.rows.filter((r) => r.excluded && before.rows.some((x) => x.userId === r.userId && x.counted)).length;
    const changes = after.rows.filter((r) => r.was !== undefined || r.excluded).length;
    return { roles, excluded, buffs, changes };
}

/** A change of the draft the page has sent but not yet heard back about (spec null = back to the shown one). */
export type PlanEdit = { spec?: KaderWish | null; excluded?: boolean };

/**
 * The draft as the page shows it: the stored one with the own edits still on their way laid over it, so a live
 * refetch never takes back what was just picked. A first edit without a stored draft starts one by `me`. Null when
 * the result plans nothing (no spec, nobody left out).
 */
export function planWithPending(plan: KaderPlan | null | undefined, pending: Record<string, PlanEdit>, me: string, now: string): KaderPlan | null {
    const ids = Object.keys(pending);
    if (!plan && !ids.length) return null;
    const specs = { ...(plan ? plan.specs : {}) };
    const excluded = new Set(plan ? plan.excluded : []);
    for (const id of ids) {
        const edit = pending[id];
        if (edit.spec === null) delete specs[id];
        else if (edit.spec) specs[id] = edit.spec;
        if (edit.excluded === true) excluded.add(id);
        else if (edit.excluded === false) excluded.delete(id);
    }
    if (!Object.keys(specs).length && !excluded.size) return null;
    const base = plan || { by: me, at: now };
    return { ...(plan || {}), specs, excluded: [...excluded], by: base.by, at: base.at };
}

/** How many decisions taking the draft over sets: planned specs of players not left out that differ from their decision (as the server counts). */
export function planDecisions(plan: KaderPlan | null, kader: KaderData): number {
    if (!plan) return 0;
    let n = 0;
    for (const [id, pick] of Object.entries(plan.specs)) {
        const entry = kader.players[id];
        if (!entry || plan.excluded.includes(id)) continue;
        if (decides(entry, pick)) continue;
        n += 1;
    }
    return n;
}

/** The player's decision already is this pick (taking the draft over changes nothing for them). */
function decides(entry: KaderEntry, pick: KaderWish): boolean {
    return !!entry.decision && entry.decision.className === pick.className && entry.decision.spec === pick.spec;
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
