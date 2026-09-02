// The caster loot council.
//
// It answers the three questions a council actually asks, in that order:
//   "Wer war zuletzt dran?"      — the roster table: what each caster got in the
//                                  selected content, how long ago, and how far
//                                  their gear still is from BiS
//   "Wer sollte mal wieder?"     — the same table sorted by need, with the
//                                  reasoning spelled out instead of hidden in a
//                                  score
//   "Wem bringt DAS hier am     — the BiS list: per open item, who would gain
//    meisten?"                     most, by simulated DPS where possible and by
//                                  stat weights otherwise
//
// The DPS numbers come from a background simulation (wowsimcli) that the user
// starts deliberately — it costs seconds of CPU per raider, and the page is
// fully usable without it. Everything a simulation can improve is labelled, so
// a stat-weight estimate is never mistaken for a measured number.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
    getLootCouncil, runCouncilSim, searchCouncilItems,
    type ApiError, type CouncilCandidate, type CouncilGap, type CouncilItem, type CouncilRaider,
    type ItemSearchResult, type LootCouncilData, type SimJob, type SimResult,
} from "../api";
import ItemSearchPicker from "../components/ItemSearchPicker";
import type { ShellContext } from "../components/Shell";
import { fmtMs } from "../lib/format";
import { itemQualityProps } from "../lib/itemQuality";
import { usePersistedState } from "../lib/persistedState";
import { useTableSort, type Dir, type TableSort } from "../lib/tableSort";
import { SortTh } from "../components/SortTh";
import { classColorProps, ClassSpecIcon } from "../components/ClassSpec";
import { ReasonBadge } from "../components/LootBadges";
import { HoverPanel } from "../components/HoverPanel";
import PageLoader from "../components/PageLoader";

type View = {
    role: string;
    tiers: string[];
    contents: string[];
    category: string;
    bisTier: string;
    tab: "roster" | "bis" | "drop";
    /** The item the "Drop prüfen" tab is asking about (0 = none picked). */
    dropItem: number;
};
const VIEW_DEFAULT: View = { role: "caster", tiers: [], contents: [], category: "", bisTier: "", tab: "roster", dropItem: 0 };

// The direction each column's first click picks: names ascending, everything
// that measures "how much / how long" descending, because that is the end
// somebody clicking it is looking for.
type RosterSortKey = "character" | "spec" | "need" | "loot" | "last" | "bis" | "dps" | "gear";
const ROSTER_SORT: Record<RosterSortKey, Dir> = {
    character: "asc", spec: "asc", need: "desc", loot: "desc",
    last: "asc", bis: "asc", dps: "desc", gear: "desc",
};

type CandidateSortKey = "character" | "spec" | "slot" | "gain" | "loot";
const CANDIDATE_SORT: Record<CandidateSortKey, Dir> = {
    character: "asc", spec: "asc", slot: "asc", gain: "desc", loot: "desc",
};

const WOWHEAD = (id: number) => `https://www.wowhead.com/tbc/item=${id}`;

/** A tier's readable name ("Tier 6"), falling back to its id. */
function tierLabel(tiers: { id: string; label: string }[], id: string): string {
    const tier = tiers.find((t) => t.id === id);
    return tier ? tier.label : id.toUpperCase();
}

/** A raider's name in their class colour. */
function RaiderName({ raider }: { raider: CouncilRaider }) {
    return <b {...classColorProps(raider.classColor)}>{raider.character}</b>;
}

/**
 * The spec, as its icon alone in a narrow column of its own.
 *
 * The icon says the spec to anyone who plays the game, so a second column
 * spelling it out was only taking width from the columns that carry numbers.
 * The name stays reachable as the title, and the column still sorts by it.
 */
function SpecCell({ specLabel, iconUrl, assumed }: { specLabel: string; iconUrl?: string; assumed?: boolean }) {
    const title = assumed ? `${specLabel} — aus der Klasse abgeleitet, nicht aus einem Log` : specLabel;
    if (!iconUrl) return <span className="sub" title={title}>{specLabel.slice(0, 2)}</span>;
    return (
        <span className={`lc-spec${assumed ? " lc-spec-assumed" : ""}`} title={title}>
            <ClassSpecIcon iconUrl={iconUrl} />
        </span>
    );
}

/** An item as icon + quality-coloured name, linked to Wowhead. */
function ItemLink({ id, name, iconUrl, quality }: { id: number; name: string; iconUrl?: string; quality?: number | null }) {
    return (
        <a className="lc-item" href={WOWHEAD(id)} target="_blank" rel="noreferrer">
            {iconUrl ? <img src={iconUrl} alt="" loading="lazy" /> : null}
            <span {...itemQualityProps(quality ?? null)}>{name || `Item ${id}`}</span>
        </a>
    );
}

/**
 * The need score, with its parts behind a hover.
 *
 * Shown as a bar rather than a number because the number itself means nothing
 * to a reader — what matters is the ordering and what drives it, and the hover
 * says exactly that in words.
 */
function NeedBar({ raider }: { raider: CouncilRaider }) {
    const pct = Math.round(raider.needScore * 100);
    const parts = raider.needParts;
    return (
        <HoverPanel
            trigger={
                <span className="lc-need" aria-label={`Bedarf ${pct} Prozent`}>
                    <span className="lc-need-fill" style={{ width: `${pct}%` }} />
                </span>
            }
        >
            <div className="lc-need-detail">
                <div><b>Bedarf {pct} %</b></div>
                <div>Wartezeit: {Math.round(parts.drought * 100)} % {raider.daysSinceLoot === null ? "(noch nie etwas bekommen)" : `(${raider.daysSinceLoot} Tage her)`}</div>
                <div>Anteil am Loot: {Math.round(parts.share * 100)} % ({raider.lootCount} Items im Filter)</div>
                <div>BiS-Lücke: {Math.round(parts.need * 100)} % ({raider.bis.owned}/{raider.bis.total} BiS getragen)</div>
                <div className="hint" style={{ marginTop: 6 }}>
                    Gewichtung: 40 % Wartezeit, 30 % Loot-Anteil, 30 % BiS-Lücke.
                </div>
            </div>
        </HoverPanel>
    );
}

/** What the BiS column says, including why a list may not fit exactly. */
function BisCell({ raider }: { raider: CouncilRaider }) {
    if (!raider.bis.total) {
        return (
            <span className="sub" title="WoWSims-TBC liefert für diese Spec keine BiS-Liste (alle Heiler-Sets sind dort leer).">
                keine Liste
            </span>
        );
    }
    const notes = [
        raider.bis.borrowedFrom ? `Liste von ${raider.bis.borrowedFrom} (WoWSims hat für diese Spec keine eigene)` : "",
        !raider.bis.exact && raider.bis.tier ? `Neueste verfügbare Liste: ${raider.bis.tier.toUpperCase()}` : "",
    ].filter(Boolean);
    return (
        <span title={notes.join(" · ")}>
            {raider.bis.owned}/{raider.bis.total}
            {notes.length ? <span className="sub"> *</span> : null}
        </span>
    );
}

// How many awards the hover shows. A peek, not the full history: past this the
// panel would need to scroll, and a tooltip you have to scroll is one you
// cannot read at a glance. The character page has the complete list.
const HOVER_ITEMS = 8;

/** The loot a raider got in the filter, newest first, behind a hover. */
function LootCell({ raider }: { raider: CouncilRaider }) {
    if (!raider.lootCount) return <span className="sub">—</span>;
    return (
        // Wide enough that item name, raid, reason and date fit on one line —
        // at the default width the row overflowed and the panel grew a
        // horizontal scrollbar.
        <HoverPanel width={560} trigger={<span className="lc-count">{raider.lootCount}</span>}>
            <div className="lc-loot-list">
                {raider.items.slice(0, HOVER_ITEMS).map((item, i) => (
                    <div key={`${item.itemId}-${item.awardedAt}-${i}`} className="lc-loot-row">
                        <ItemLink id={item.itemId} name={item.itemName} iconUrl={item.itemIconUrl} quality={item.itemQuality} />
                        <span className="sub lc-loot-raid">{item.contentId ? item.contentId.toUpperCase() : ""}</span>
                        {item.reasonLabel ? <ReasonBadge label={item.reasonLabel} tone={item.reasonTone} title={item.reason} /> : null}
                        <span className="sub lc-loot-date">{item.awardedAt ? fmtMs(item.awardedAt, false) : ""}</span>
                    </div>
                ))}
                {raider.items.length > HOVER_ITEMS
                    ? <div className="hint">… und {raider.items.length - HOVER_ITEMS} ältere</div>
                    : null}
            </div>
        </HoverPanel>
    );
}

/**
 * The DPS a raider's current gear is worth, once simulated.
 *
 * Deliberately shows nothing at all rather than a placeholder number when there
 * is no result: an invented DPS in a column that elsewhere holds a measured one
 * is the single most misleading thing this page could do.
 */
function SimCell({ raider, sim }: { raider: CouncilRaider; sim: SimResult | null }) {
    const entry = sim && sim[raider.key];
    if (!raider.simSupported) return <span className="sub" title="WoWSims-TBC simuliert diese Spec nicht.">—</span>;
    if (!raider.gear) return <span className="sub" title="Kein Gear bekannt: der Raider taucht in keiner der letzten CLA-Auswertungen auf.">kein Gear</span>;
    if (!entry) return <span className="sub">nicht simuliert</span>;
    if (entry.baseline === null) return <span className="sub" title={entry.error || ""}>fehlgeschlagen</span>;
    return <b>{Math.round(entry.baseline)}</b>;
}

/** One row of the "who would gain most" list under an item. */
function CandidateRow({ candidate, simDelta }: { candidate: CouncilCandidate; simDelta: number | null | undefined }) {
    const measured = typeof simDelta === "number";
    return (
        <tr>
            <td><SpecCell specLabel={candidate.specLabel} iconUrl={candidate.specIconUrl} /></td>
            <td>
                <b {...classColorProps(candidate.classColor)}>{candidate.character}</b>
                {candidate.isBis ? <span className="lbadge lbadge-ok" title="Steht auf der BiS-Liste dieses Raiders" style={{ marginLeft: 6 }}>BiS</span> : null}
            </td>
            <td>
                {candidate.replaces
                    ? <span className="sub">ersetzt {candidate.replaces.itemName || `Item ${candidate.replaces.itemId}`} (ilvl {candidate.replaces.itemLevel})</span>
                    : <span className="lbadge lbadge-ok">freier Slot</span>}
            </td>
            <td className={measured ? "" : "sub"}>
                {measured
                    ? <b title="Simulierte DPS-Differenz (wowsimcli)">{simDelta > 0 ? "+" : ""}{Math.round(simDelta as number)} DPS</b>
                    : <span title="Schätzung aus Stat-Gewichten — noch nicht simuliert">{candidate.value > 0 ? "+" : ""}{candidate.value}</span>}
            </td>
            <td className="sub">
                {candidate.daysSinceLoot === null ? "noch nie" : `vor ${candidate.daysSinceLoot} T`} · {candidate.lootCount} Items
            </td>
        </tr>
    );
}

/**
 * The measured DPS delta of one item for one raider, or undefined when it has
 * not been simulated.
 */
function deltaFor(sim: SimResult | null, candidate: CouncilCandidate, itemId: number): number | null | undefined {
    const entry = sim && sim[candidate.key];
    const item = entry && entry.items[String(itemId)];
    return item ? item.delta : undefined;
}

/**
 * What a row is ranked by: the measured delta once it exists, the stat-weight
 * estimate until then. A guess must never outrank a simulated result, so the
 * measured ones are lifted clear above the whole estimate range.
 */
function gainFor(sim: SimResult | null, candidate: CouncilCandidate, itemId: number): number {
    const delta = deltaFor(sim, candidate, itemId);
    return typeof delta === "number" ? delta + 1e6 : candidate.value;
}

/** The "who should get this" table — shared by the BiS cards and the drop check. */
function CandidateTable({ itemId, candidates, sim, sortState }: {
    itemId: number;
    candidates: CouncilCandidate[];
    sim: SimResult | null;
    sortState: TableSort<CandidateSortKey>;
}) {
    const rows = sortState.apply(candidates, (c, key) => {
        switch (key) {
            case "character": return c.character.toLowerCase();
            case "spec": return c.specLabel.toLowerCase();
            case "slot": return c.replaces ? c.replaces.itemLevel : -1;
            case "gain": return gainFor(sim, c, itemId);
            case "loot": return c.daysSinceLoot === null ? Number.MAX_SAFE_INTEGER : c.daysSinceLoot;
            default: return 0;
        }
    });
    return (
        <table className="idx" style={{ marginTop: 8 }}>
            <thead>
                <tr>
                    <SortTh sortKey="spec" label="Spec" title="Nach Spec sortieren" style={{ width: 52 }} {...sortState} />
                    <SortTh sortKey="character" label="Raider" {...sortState} />
                    <SortTh sortKey="slot" label="Slot" title="Nach dem Itemlevel des Stücks, das ersetzt würde — ein freier Slot zuerst" {...sortState} />
                    <SortTh sortKey="gain" label="Zugewinn" {...sortState} />
                    <SortTh sortKey="loot" label="Zuletzt Loot" {...sortState} />
                </tr>
            </thead>
            <tbody>
                {rows.map((c) => <CandidateRow key={c.key} candidate={c} simDelta={deltaFor(sim, c, itemId)} />)}
            </tbody>
        </table>
    );
}

/** One open BiS item with everyone it would suit. */
function GapCard({ gap, sim, expanded, onToggle, sortState, onCheck }: {
    gap: CouncilGap;
    sim: SimResult | null;
    expanded: boolean;
    onToggle: () => void;
    /** Shared across every card, so all of them stay ordered the same way. */
    sortState: TableSort<CandidateSortKey>;
    /** Opens this item in the drop check, where it can be simulated on its own. */
    onCheck: () => void;
}) {
    const deltaOf = (c: CouncilCandidate) => deltaFor(sim, c, gap.id);
    // The suggestion is always the biggest gain, whatever the table is sorted by.
    const best = [...gap.candidates].sort((a, b) => gainFor(sim, b, gap.id) - gainFor(sim, a, gap.id))[0];

    return (
        <div className="sheetcard lc-gap">
            <div className="row-actions" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <h3 style={{ margin: 0 }}>
                    <ItemLink id={gap.id} name={gap.name} iconUrl={gap.iconUrl} quality={gap.quality} />
                </h3>
                <span className="hint">
                    {gap.contentId ? `${gap.contentId.toUpperCase()}${gap.boss ? ` · ${gap.boss}` : ""} · ` : ""}
                    ilvl {gap.ilvl} · fehlt {gap.wantedBy.length} Raider(n)
                </span>
            </div>
            {best ? (
                <p className="hint" style={{ marginTop: 2 }}>
                    Vorschlag: <b>{best.character}</b>
                    {typeof deltaOf(best) === "number"
                        ? <> — simuliert <b>{(deltaOf(best) as number) > 0 ? "+" : ""}{Math.round(deltaOf(best) as number)} DPS</b></>
                        : <> — geschätzter Zugewinn {best.value > 0 ? "+" : ""}{best.value} (Stat-Gewichte)</>}
                </p>
            ) : (
                <p className="hint" style={{ marginTop: 2 }}>Für keinen der gefilterten Raider ein passender Slot.</p>
            )}
            <div className="row-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle}>
                    {expanded ? "Kandidaten ausblenden" : `Alle ${gap.candidates.length} Kandidaten`}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onCheck}>
                    Als Drop prüfen
                </button>
            </div>
            {expanded && gap.candidates.length
                ? <CandidateTable itemId={gap.id} candidates={gap.candidates} sim={sim} sortState={sortState} />
                : null}
        </div>
    );
}

/**
 * "Das ist gerade gedroppt — wer soll es bekommen?"
 *
 * The one question a council asks under time pressure, so it gets its own tab
 * instead of being buried in the BiS list: pick the item, see everyone it fits
 * ranked by what it would actually gain them, and simulate exactly that one
 * item rather than the whole gap list (five raiders instead of a hundred runs —
 * seconds, not minutes).
 */
function DropPanel({ focus, sim, sortState, simAvailable, simRunning, onPick, onClear, onSimulate }: {
    focus: { item: CouncilItem; candidates: CouncilCandidate[] } | null;
    sim: SimResult | null;
    sortState: TableSort<CandidateSortKey>;
    simAvailable: boolean;
    simRunning: boolean;
    onPick: (item: ItemSearchResult) => void;
    onClear: () => void;
    onSimulate: () => void;
}) {
    const best = focus && focus.candidates.length
        ? [...focus.candidates].sort((a, b) => gainFor(sim, b, focus.item.id) - gainFor(sim, a, focus.item.id))[0]
        : null;
    const measured = best ? deltaFor(sim, best, focus!.item.id) : undefined;

    return (
        <>
            <div className="card-form">
                <div className="field" style={{ marginBottom: 0 }}>
                    <label>Welches Item ist gedroppt?</label>
                    <ItemSearchPicker
                        search={searchCouncilItems}
                        onPick={onPick}
                        placeholder="Item-Namen tippen, z. B. Zhar'doom …"
                    />
                    <div className="hint">
                        Gesucht wird in der Caster-Itemliste des Bots — angeboten wird nur, was ein Caster
                        auch tragen kann.
                    </div>
                </div>
            </div>

            {!focus ? (
                <div className="empty">Noch kein Item gewählt.</div>
            ) : (
                <div className="sheetcard lc-gap">
                    <div className="row-actions" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                        <h3 style={{ margin: 0 }}>
                            <ItemLink id={focus.item.id} name={focus.item.name} iconUrl={focus.item.iconUrl} quality={focus.item.quality} />
                        </h3>
                        <span className="hint">
                            {focus.item.contentId ? `${focus.item.contentId.toUpperCase()}${focus.item.boss ? ` · ${focus.item.boss}` : ""} · ` : ""}
                            ilvl {focus.item.ilvl}
                        </span>
                    </div>

                    {best ? (
                        <p className="hint" style={{ marginTop: 2 }}>
                            Größter Zugewinn: <b>{best.character}</b>
                            {typeof measured === "number"
                                ? <> — simuliert <b>{measured > 0 ? "+" : ""}{Math.round(measured)} DPS</b></>
                                : <> — geschätzt {best.value > 0 ? "+" : ""}{best.value} (Stat-Gewichte; für echte DPS unten simulieren)</>}
                        </p>
                    ) : (
                        <p className="hint" style={{ marginTop: 2 }}>
                            Für keinen Raider im aktuellen Filter ein passender Slot — Rolle oder Filter oben prüfen.
                        </p>
                    )}

                    <div className="row-actions">
                        {simAvailable && focus.candidates.length ? (
                            <button type="button" className="btn btn-sm" disabled={simRunning} onClick={onSimulate}>
                                DPS-Gewinn für dieses Item simulieren
                            </button>
                        ) : null}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>Anderes Item</button>
                    </div>

                    {focus.candidates.length
                        ? <CandidateTable itemId={focus.item.id} candidates={focus.candidates} sim={sim} sortState={sortState} />
                        : null}
                </div>
            )}
        </>
    );
}

export default function LootCouncilPage() {
    const { csrfToken } = useOutletContext<ShellContext>();
    const [view, setView] = usePersistedState<View>("lootcouncil.view", VIEW_DEFAULT);
    const [data, setData] = useState<LootCouncilData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [loading, setLoading] = useState(true);
    // Sim results live next to the data, not in it: the page is complete
    // without them and they are only ever an improvement laid over the top.
    const [sim, setSim] = useState<SimResult | null>(null);
    const [simJob, setSimJob] = useState<SimJob | null>(null);
    const [simError, setSimError] = useState<string>("");
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const rosterSort = useTableSort<RosterSortKey>("lootcouncil.roster-sort", ROSTER_SORT, "need");
    // One sort for every candidate table, so the cards stay comparable.
    const candidateSort = useTableSort<CandidateSortKey>("lootcouncil.candidate-sort", CANDIDATE_SORT, "gain");

    const load = useCallback(() => {
        setLoading(true);
        getLootCouncil({
            role: view.role,
            tiers: view.tiers,
            contents: view.contents,
            category: view.category,
            bisTier: view.bisTier,
        })
            .then((d) => { setData(d); setError(null); })
            .catch((e: ApiError) => setError(e))
            .finally(() => setLoading(false));
    }, [view.role, view.tiers, view.contents, view.category, view.bisTier]);

    // The picked drop is fetched on its own rather than filtered out of the
    // page's data: which slot it lands in and what it would replace is decided
    // per raider on the server, and a dropped item is regularly one that is on
    // nobody's BiS list and therefore in no payload the page already holds.
    const [focus, setFocus] = useState<{ item: CouncilItem; candidates: CouncilCandidate[] } | null>(null);
    useEffect(() => {
        if (!view.dropItem) { setFocus(null); return; }
        let alive = true;
        getLootCouncil({
            role: view.role,
            tiers: view.tiers,
            contents: view.contents,
            category: view.category,
            bisTier: view.bisTier,
            item: view.dropItem,
        })
            .then((d) => { if (alive) setFocus(d.focus); })
            .catch(() => { if (alive) setFocus(null); });
        return () => { alive = false; };
    }, [view.dropItem, view.role, view.tiers, view.contents, view.category, view.bisTier]);

    useEffect(load, [load]);

    // A changed filter changes which raiders and items were simulated, so the
    // old results no longer describe what is on screen. Dropping them is the
    // honest move — a stale delta under a new filter is worse than none.
    useEffect(() => { setSim(null); setSimJob(null); }, [view.role, view.tiers, view.contents, view.category, view.bisTier]);

    const patch = (next: Partial<View>) => setView({ ...view, ...next });

    const toggleIn = (list: string[], id: string) =>
        (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

    // Held stable across renders, so the memo below does not rebuild (and the
    // sim's subject list does not change identity) on every keystroke.
    const roster = useMemo(() => (data ? data.roster : []), [data]);
    const gaps = data ? data.gaps : [];
    const simulatable = useMemo(
        () => roster.filter((r) => r.simSupported && r.gear).map((r) => ({ key: r.key, specKey: r.specKey })),
        [roster],
    );

    // The table opens on the server's own order (most overdue first), which is
    // the question the page is here to answer; every other column is one click.
    const sortedRoster = rosterSort.apply(roster, (r, key) => {
        switch (key) {
            case "character": return r.character.toLowerCase();
            case "spec": return r.specLabel.toLowerCase();
            case "need": return r.needScore;
            case "loot": return r.lootCount;
            // Never having won anything is not "long ago", it is further back
            // than any date — so it sorts to the overdue end, not the fresh one.
            case "last": return r.lastAwardAt || 0;
            case "bis": return r.bis.total ? r.bis.owned / r.bis.total : -1;
            case "dps": return (sim && sim[r.key] && sim[r.key].baseline) || 0;
            case "gear": return r.gear ? r.gear.seenAt : 0;
            default: return 0;
        }
    });

    /**
     * Simulate the roster's baselines plus the given items.
     *
     * `items` is the whole open BiS list for the overview button and a single
     * id for the drop check — the difference between minutes and seconds, which
     * is why the drop check has its own button at all.
     */
    const runSim = async (items: number[]) => {
        if (!data || !simulatable.length) return;
        setSimError("");
        const id = `council-${Date.now()}`;
        setSimJob({ status: "running", progress: 0, total: simulatable.length * (1 + items.length) });
        try {
            const result = await runCouncilSim(csrfToken, id, simulatable, items, setSimJob);
            // Merged, not replaced: simulating one drop must not throw away the
            // deltas of the BiS run somebody kicked off five minutes ago.
            setSim((prev) => {
                if (!prev) return result;
                const merged: SimResult = { ...prev };
                for (const [key, entry] of Object.entries(result)) {
                    const old = merged[key];
                    merged[key] = old ? { ...entry, items: { ...old.items, ...entry.items } } : entry;
                }
                return merged;
            });
        } catch (e) {
            setSimError((e as ApiError).message);
        } finally {
            setSimJob(null);
        }
    };

    if (loading && !data) return <PageLoader show text="Loot-Council wird geladen" />;
    if (error) return <div className="empty">{error.message}</div>;
    if (!data) return null;

    const o = data.options;
    const simRunning = !!simJob && simJob.status === "running";

    return (
        <>
            <PageLoader show={loading && !!data} text="Wird aktualisiert" />

            <div className="card-form">
                <div className="field">
                    <label>Rolle</label>
                    <div className="row-actions">
                        {o.roles.map((r) => (
                            <button
                                key={r.id}
                                type="button"
                                className={`btn btn-sm ${view.role === r.id ? "" : "btn-ghost"}`}
                                onClick={() => patch({ role: r.id })}
                            >
                                {r.label}
                            </button>
                        ))}
                        <button
                            type="button"
                            className={`btn btn-sm ${view.role === "" ? "" : "btn-ghost"}`}
                            onClick={() => patch({ role: "" })}
                        >
                            Alle
                        </button>
                    </div>
                </div>

                <div className="field">
                    <label>Content — welche Raids beim Loot zählen</label>
                    <div className="row-actions" style={{ flexWrap: "wrap" }}>
                        {o.tiers.map((t) => (
                            <button
                                key={t.id}
                                type="button"
                                className={`btn btn-sm ${view.tiers.includes(t.id) ? "" : "btn-ghost"}`}
                                onClick={() => patch({ tiers: toggleIn(view.tiers, t.id) })}
                            >
                                {t.label}
                            </button>
                        ))}
                        <span className="sub" style={{ margin: "0 6px" }}>|</span>
                        {o.contents.map((c) => (
                            <button
                                key={c.id}
                                type="button"
                                className={`btn btn-sm ${view.contents.includes(c.id) ? "" : "btn-ghost"}`}
                                title={c.label}
                                onClick={() => patch({ contents: toggleIn(view.contents, c.id) })}
                            >
                                {c.short}
                            </button>
                        ))}
                        {(view.tiers.length || view.contents.length) ? (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => patch({ tiers: [], contents: [] })}>
                                Filter zurücksetzen
                            </button>
                        ) : null}
                    </div>
                    <div className="hint">
                        Ohne Auswahl zählt aller Loot. Tiers und einzelne Raids lassen sich kombinieren
                        („T5 plus Hyjal"), wenn die Gilde gerade wechselt.
                    </div>
                </div>

                <div className="row-actions" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
                    <div className="field" style={{ marginBottom: 0 }}>
                        <label>Raid-Kategorie</label>
                        <select value={view.category} onChange={(e) => patch({ category: e.target.value })}>
                            <option value="">Alle Raids</option>
                            {o.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                        <label>BiS-Liste für</label>
                        <select value={view.bisTier} onChange={(e) => patch({ bisTier: e.target.value })}>
                            <option value="">Automatisch</option>
                            {o.bisTiers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                        {data.filter.bisTierDerived ? (
                            <div className="hint">
                                Aus dem neuesten Loot abgeleitet: {tierLabel(o.tiers, data.filter.bisTier)}.
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>

            <div className="card-form lc-simbar">
                <div>
                    {data.sim.available
                        ? <span className="hint">WoWSims {data.sim.version} — {simulatable.length} von {roster.length} Raider(n) simulierbar.</span>
                        : <span className="hint">{data.sim.hint}</span>}
                    {simRunning && simJob
                        ? <div className="hint">Simulation läuft … {simJob.progress ?? 0} von {simJob.total ?? 0}</div>
                        : null}
                    {simError ? <div className="hint err">{simError}</div> : null}
                </div>
                {data.sim.available ? (
                    <div className="row-actions">
                        <button type="button" className="btn btn-sm" disabled={simRunning || !simulatable.length} onClick={() => runSim([])}>
                            DPS der Raider berechnen
                        </button>
                        <button
                            type="button"
                            className="btn btn-sm"
                            disabled={simRunning || !simulatable.length || !gaps.length}
                            title="Rechnet jedes offene BiS-Item gegen jeden Raider durch — gründlich, aber minutenlang. Für ein einzelnes Item ist „Drop prüfen“ schneller."
                            onClick={() => runSim(gaps.map((g) => g.id))}
                        >
                            Alle BiS-Items durchrechnen ({gaps.length})
                        </button>
                    </div>
                ) : null}
            </div>

            <div className="tabs">
                <button type="button" className={`tab-btn${view.tab === "roster" ? " active" : ""}`} onClick={() => patch({ tab: "roster" })}>
                    Raider ({roster.length})
                </button>
                <button type="button" className={`tab-btn${view.tab === "bis" ? " active" : ""}`} onClick={() => patch({ tab: "bis" })}>
                    Offene BiS-Items ({gaps.length})
                </button>
                <button type="button" className={`tab-btn${view.tab === "drop" ? " active" : ""}`} onClick={() => patch({ tab: "drop" })}>
                    Drop prüfen
                </button>
            </div>

            {view.tab === "roster" ? (
                roster.length ? (
                    <table className="idx lc-roster">
                        <thead>
                            <tr>
                                <SortTh sortKey="spec" label="Spec" title="Nach Spec sortieren" style={{ width: 52 }} {...rosterSort} />
                                <SortTh sortKey="character" label="Raider" {...rosterSort} />
                                <SortTh sortKey="need" label="Bedarf" title="Wartezeit, Loot-Anteil und BiS-Lücke zusammengenommen" {...rosterSort} />
                                <SortTh sortKey="loot" label="Items" {...rosterSort} />
                                <SortTh sortKey="last" label="Zuletzt" {...rosterSort} />
                                <SortTh sortKey="bis" label="BiS" title="Anteil der getragenen BiS-Teile" {...rosterSort} />
                                <SortTh sortKey="dps" label="DPS" {...rosterSort} />
                                <SortTh sortKey="gear" label="Gear-Stand" title="Wann der Raider zuletzt in einer Auswertung auftauchte" {...rosterSort} />
                            </tr>
                        </thead>
                        <tbody>
                            {sortedRoster.map((r) => (
                                <tr key={r.key}>
                                    <td><SpecCell specLabel={r.specLabel} iconUrl={r.specIconUrl} assumed={r.specAssumed} /></td>
                                    <td><RaiderName raider={r} /></td>
                                    <td><NeedBar raider={r} /></td>
                                    <td><LootCell raider={r} /></td>
                                    <td className="sub">
                                        {r.lastAwardAt ? `${fmtMs(r.lastAwardAt, false)} (vor ${r.daysSinceLoot} T)` : "noch nie"}
                                    </td>
                                    <td><BisCell raider={r} /></td>
                                    <td><SimCell raider={r} sim={sim} /></td>
                                    <td className="sub">
                                        {r.gear
                                            ? <span title={`Aus der Auswertung „${r.gear.reportTitle}"`}>
                                                {fmtMs(r.gear.seenAt, false)}
                                                {r.gear.hitCap > 0
                                                    ? ` · Trefferwertung ${r.gear.spellHit}/${r.gear.hitCap}`
                                                    : ""}
                                            </span>
                                            : "—"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div className="empty">
                        Keine passenden Raider. Der Loot-Council liest Klasse und Spec aus den Loot-Importen und den
                        CLA-Auswertungen — ohne die bleibt die Liste leer.
                    </div>
                )
            ) : null}

            {view.tab === "bis" ? (
                gaps.length ? (
                    <>
                        <p className="hint">
                            Items, die auf mindestens einer BiS-Liste stehen und noch niemand aus der gefilterten
                            Gruppe trägt — sortiert danach, wie viele darauf warten. Der Vorschlag ist der größte
                            Zugewinn, nicht der längste Wartende: wer dran ist, entscheidet ihr.
                        </p>
                        {gaps.map((gap) => (
                            <GapCard
                                key={gap.id}
                                gap={gap}
                                sim={sim}
                                expanded={expanded.has(gap.id)}
                                onToggle={() => {
                                    const next = new Set(expanded);
                                    if (next.has(gap.id)) next.delete(gap.id);
                                    else next.add(gap.id);
                                    setExpanded(next);
                                }}
                                sortState={candidateSort}
                                onCheck={() => patch({ tab: "drop", dropItem: gap.id })}
                            />
                        ))}
                    </>
                ) : (
                    <div className="empty">
                        Keine offenen BiS-Items im gewählten Filter — entweder trägt die Gruppe schon alles,
                        oder für ihre Specs gibt es in WoWSims-TBC keine BiS-Listen (das gilt für alle Heiler).
                    </div>
                )
            ) : null}

            {view.tab === "drop" ? (
                <DropPanel
                    focus={focus}
                    sim={sim}
                    sortState={candidateSort}
                    simAvailable={data.sim.available}
                    simRunning={simRunning}
                    onPick={(item: ItemSearchResult) => patch({ dropItem: item.id })}
                    onClear={() => patch({ dropItem: 0 })}
                    onSimulate={() => runSim([view.dropItem])}
                />
            ) : null}
        </>
    );
}
