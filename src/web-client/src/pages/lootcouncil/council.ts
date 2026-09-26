// The loot council's logic that is not a component: the filter the page and the
// drop check share, the verdict rules, and the simulation runner. Kept apart
// from the components so both routes (/lootcouncil and /lootcouncil/drop/:id)
// import the same rules instead of two copies drifting apart.
import { useCallback, useRef, useState } from "react";
import { runCouncilSim, type LootCouncilData, type CouncilCandidate, type SimResult, type WornItem } from "../../api";
import { useJobs } from "../../components/Jobs";
import { t, tOr } from "../../i18n";
import type { Dir } from "../../lib/tableSort";
import { wowheadItemUrl } from "../../lib/wowheadItems";

/** The part of the persisted view both routes read: who is counted, which loot, which BiS list. */
export type FilterView = {
    role: string;
    tiers: string[];
    contents: string[];
    category: string;
    bisTier: string;
};

/** The key the council's view is stored under — the drop check reads the same filters. */
export const VIEW_KEY = "lootcouncil.view";

export const FILTER_DEFAULT: FilterView = { role: "caster", tiers: [], contents: [], category: "", bisTier: "" };

// Wie die Rollen am Raider heißen, und ihr Icon im Segment. Der Name wird beim
// Rendern übersetzt (lootcouncil.role.*); eine unbekannte Rolle zeigt `fallback`.
export const roleLabel = (id: string, fallback?: string) => tOr(`lootcouncil.role.${id}`, fallback || id);
export const ROLE_ICON: Record<string, string> = { caster: "spell_holy_magicalsentry", healer: "spell_holy_guardianspirit" };

export const WOWHEAD = (id: number) => wowheadItemUrl(id);

/**
 * A raider's details, as a link: the council page opens its dialog from
 * `?raider=<name>`, so the drop check (or a message in Discord) leads straight there.
 */
export const raiderHref = (character: string) => `/lootcouncil?raider=${encodeURIComponent(character)}`;

/** The drop check for one item — its own route, so a drop can be shared as a link. */
export const dropHref = (itemId?: number) => (itemId ? `/lootcouncil/drop/${itemId}` : "/lootcouncil/drop");

/**
 * The Wowhead link for a worn piece *as worn*: with the raider's gems and
 * enchant in the url, so the widget tooltip (power.js, index.html) shows the
 * socketed, enchanted item like the in-game tooltip.
 */
export function wornWowheadUrl(item: WornItem): string {
    const params: string[] = [];
    if (item.enchantId) params.push(`ench=${item.enchantId}`);
    if (item.gemIds.length) params.push(`gems=${item.gemIds.join(":")}`);
    return wowheadItemUrl(item.itemId, params);
}

// The roster's columns and the direction each column's first click picks: names
// ascending, everything that measures "how much / how long" descending.
export type RosterSortKey = "character" | "need" | "loot" | "last" | "bis" | "dps";
export const ROSTER_SORT: Record<RosterSortKey, Dir> = {
    character: "asc", need: "desc", loot: "desc", last: "asc", bis: "asc", dps: "desc",
};

// The candidate table's columns and the direction each column's first click picks.
export type CandidateSortKey = "character" | "bis" | "slot" | "gain" | "need" | "waited" | "loot";
export const CANDIDATE_SORT: Record<CandidateSortKey, Dir> = {
    character: "asc", bis: "desc", slot: "asc", gain: "desc", need: "desc", waited: "desc", loot: "desc",
};

/**
 * The measured DPS delta of one item for one raider, or undefined when it has
 * not been simulated.
 */
export function deltaFor(sim: SimResult | null, candidate: CouncilCandidate, itemId: number): number | null | undefined {
    const entry = sim && sim[candidate.key];
    const item = entry && entry.items[String(itemId)];
    return item ? item.delta : undefined;
}

/**
 * Why a candidate has no delta: a real run that came back without a number
 * (`dps: null` — an unknown gem, a crashed binary run), or nothing at all
 * because it was never attempted. Both render as "kein Wert" if the page does
 * not ask this — a council cannot tell "try again" from "not tried yet".
 */
export function simErrorFor(sim: SimResult | null, candidate: CouncilCandidate, itemId: number): string | undefined {
    const entry = sim && sim[candidate.key];
    const item = entry && entry.items[String(itemId)];
    return item && item.dps === null ? (item.error || t("lootcouncil.sim.failed")) : undefined;
}

/**
 * What a row is ranked by: the measured delta, and nothing else. A candidate
 * without a simulated number sorts below every measured one — there is no
 * estimate to rank them by, and the need score breaks the tie.
 */
export function gainFor(sim: SimResult | null, candidate: CouncilCandidate, itemId: number): number {
    const delta = deltaFor(sim, candidate, itemId);
    return typeof delta === "number" ? delta : Number.NEGATIVE_INFINITY;
}

/**
 * Who should get an item, and on what grounds.
 *
 *   sim      — the biggest simulated gain; the one answer with a number.
 *   pending  — somebody in the list could be simulated but has not been yet:
 *              no suggestion, rather than a guess dressed up as one.
 *   need     — nobody in the list can be simulated at all (healers; WoWSims-
 *              TBC sims no healing), so the suggestion follows the need score
 *              and is labelled as exactly that.
 *   none     — nobody could take the item.
 */
export type Verdict =
    | { basis: "sim"; best: CouncilCandidate; delta: number }
    | { basis: "need"; best: CouncilCandidate; delta: null }
    | { basis: "pending" | "none"; best: null; delta: null };

export function pickVerdict(candidates: CouncilCandidate[], sim: SimResult | null, itemId: number): Verdict {
    const measured = candidates
        .map((c) => ({ c, delta: deltaFor(sim, c, itemId) }))
        .filter((x): x is { c: CouncilCandidate; delta: number } => typeof x.delta === "number")
        // A candidate the item is not BiS for counts half — in the gain and in the need.
        .sort((a, b) => b.delta * b.c.bisWeight - a.delta * a.c.bisWeight || b.c.itemNeedScore - a.c.itemNeedScore)[0];
    if (measured) return { basis: "sim", best: measured.c, delta: measured.delta };
    if (candidates.some((c) => c.simSupported && c.hasGear)) return { basis: "pending", best: null, delta: null };
    const byNeed = [...candidates].sort((a, b) => b.itemNeedScore - a.itemNeedScore)[0];
    return byNeed ? { basis: "need", best: byNeed, delta: null } : { basis: "none", best: null, delta: null };
}

/** "Letztes Item vor 34 Tagen" — the tooltip of every Tage/Zuletzt cell. */
export function waitedTip(daysSinceLoot: number | null): string {
    return daysSinceLoot === null ? t("lootcouncil.waited.never") : t("lootcouncil.waited.days", { count: daysSinceLoot });
}

/**
 * Pieces without an enchant, and empty sockets, over a worn set — a raider's
 * or a candidate's, both carry the same `WornItem[]` shape.
 */
export function gearCounts(items: WornItem[]): { noench: number; sockets: number } {
    return {
        noench: items.filter((i) => i.enchantStatus === "missing").length,
        sockets: items.reduce((n, i) => n + i.emptySockets, 0),
    };
}

type Subject = { key: string; specKey: string };

/**
 * The simulation, as one job toast with the real progress ("7 von 24") —
 * measured by the server, not estimated.
 *
 * `items` is the whole open BiS list for the overview button and a single id
 * for the drop check; `subjects` is the whole roster for the buttons and only
 * that drop's candidates when a drop is checked — the difference between
 * minutes and seconds. Results are merged, not replaced: simulating one drop
 * must not throw away the deltas of the BiS run somebody started earlier.
 */
export function useCouncilSim() {
    const jobs = useJobs();
    const [sim, setSim] = useState<SimResult | null>(null);
    const [simRunning, setSimRunning] = useState(false);
    // The same flag as a ref, so an automatic run (the drop check) cannot start
    // a second simulation while one is going.
    const simBusy = useRef(false);

    const runSim = useCallback(async (items: number[], subjects: Subject[], what = "") => {
        if (simBusy.current || !subjects.length) return;
        simBusy.current = true;
        setSimRunning(true);
        const id = `council-${Date.now()}`;
        const total = subjects.length * (1 + items.length);
        const detail = what || (items.length
            ? t("lootcouncil.sim.subjectsItems", { count: subjects.length, items: items.length })
            : t("lootcouncil.sim.subjects", { count: subjects.length }));
        const result = await jobs.run<SimResult>(
            {
                label: t("lootcouncil.sim.label"),
                detail,
                describe: (r) => ({
                    message: items.length
                        ? t("lootcouncil.sim.doneItems", { count: Object.keys(r).length, items: items.length })
                        : t("lootcouncil.sim.doneBaseline", { count: Object.keys(r).length }),
                }),
            },
            (update) => runCouncilSim(id, subjects, items, (job) => update({
                progress: job.total ? (job.progress ?? 0) / job.total : undefined,
                detail: t("lootcouncil.sim.progress", { detail, done: job.progress ?? 0, total: job.total ?? total }),
            })),
        );
        simBusy.current = false;
        setSimRunning(false);
        // A failure is on the toast already; there is nothing to merge.
        if (!result) return;
        setSim((prev) => {
            if (!prev) return result;
            const merged: SimResult = { ...prev };
            for (const [key, entry] of Object.entries(result)) {
                const old = merged[key];
                merged[key] = old ? { ...entry, items: { ...old.items, ...entry.items } } : entry;
            }
            return merged;
        });
    }, [jobs]);

    return { sim, setSim, simRunning, runSim };
}

/**
 * Why the roster is shorter than the reader expects — or empty.
 *
 * The category filter draws on three sources (the logs of that raid, the loot
 * awarded there, the maintained raider→character assignment). When it finds
 * nobody the list is empty on purpose; this says which sources were tried and
 * what to fix. Null when there is nothing to explain.
 */
export function categoryNote(data: LootCouncilData): { head: string; sub: string; empty: boolean } | null {
    const { skipped, categorySources: src, categoryId } = data.filter;
    if (!categoryId && !skipped.excluded) return null;
    const nothingFound = !!src && !src.reports && !src.loot && !src.assigned;
    const parts: string[] = [];
    if (skipped.category) parts.push(t("lootcouncil.category.skipped", { count: skipped.category }));
    if (skipped.excluded) parts.push(t("lootcouncil.category.excluded", { count: skipped.excluded }));
    if (src && !nothingFound) {
        const from = [
            src.reports ? t("lootcouncil.category.fromReports", { count: src.reports }) : "",
            src.loot ? t("lootcouncil.category.fromLoot", { count: src.loot }) : "",
            src.assigned ? t("lootcouncil.category.fromAssigned", { count: src.assigned }) : "",
        ].filter(Boolean).join(", ");
        parts.push(t("lootcouncil.category.via", { from }));
        if (!src.assigned) parts.push(t("lootcouncil.category.noAssignment"));
    }
    if (nothingFound) {
        parts.push(t("lootcouncil.category.nothingFound"));
    }
    const hidden = skipped.category + skipped.excluded;
    return {
        head: nothingFound ? t("lootcouncil.category.headEmpty") : t("lootcouncil.category.headHidden", { count: hidden }),
        sub: parts.join(" "),
        empty: nothingFound,
    };
}
