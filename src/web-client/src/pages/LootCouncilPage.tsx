// The caster loot council.
//
// One question per view, in the order a council asks them:
//   "Wer ist dran?"            — the Raider tab: one compact line per raider
//                                (need, wait, loot, BiS, DPS, a few badges);
//                                everything else about a raider opens in their
//                                details (lootcouncil/RaiderDialog.tsx)
//   "Was fehlt noch?"          — the open BiS items, each with its candidates
//   "Das ist gerade gedroppt   — its own page, /lootcouncil/drop/:itemId
//    — wer kriegt es?"           (lootcouncil/DropCheckPage.tsx), so a drop is a
//                                link and seven candidates have room
//
// Two rules run through the whole module:
//
//   Tooltips over words. A filter, a column, a number explains itself in the
//   tooltip box; the page carries no paragraphs, because a council reads it
//   under time pressure while a boss corpse cools.
//
//   Gain and fairness stay apart. What an item would *do* and what a raider has
//   *coming to them* are two different questions, shown as two bars side by
//   side. Multiplying them into one number would look like an answer and hide
//   the judgement a council is there to make.
//
// The DPS numbers come from a background simulation (wowsimcli). There are no
// estimates: a gain is shown once it has been simulated and not before. Every
// wait — a reload, the armory, a simulation — is a job toast (components/Jobs.tsx).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import {
    getLootCouncil, searchCouncilItems, setCouncilExcluded, getCouncilExport, getBisLists, refreshCouncilArmory, setCouncilRole, canAccess,
    loadCouncilLogGear,
    type ApiError, type CouncilGap, type CouncilLootItem, type CouncilRaider,
    type CouncilExport, type LootCouncilData, type SimResult,
    type BisListsData, type CouncilItemHit,
} from "../api";
import { refreshWowheadLinks } from "../lib/wowheadTooltips";
import { useJobs, useToast } from "../components/Jobs";
import type { ShellContext } from "../components/Shell";
import { fmtMs } from "../lib/format";
import { itemQualityProps } from "../lib/itemQuality";
import { usePersistedState } from "../lib/persistedState";
import { useTableSort, type TableSort } from "../lib/tableSort";
import { classColorProps, ClassSpecIcon } from "../components/ClassSpec";
import { ReasonBadge } from "../components/LootBadges";
import PageLoader from "../components/PageLoader";
import { Badge, Button, Expand, PageHead, PartHead, WowIcon, buttonClass, useConfirm } from "../components/ui";
import {
    CANDIDATE_SORT, ROLE_LABEL, ROSTER_SORT, VIEW_KEY, dropHref, pickVerdict, useCouncilSim,
    type CandidateSortKey, type RosterSortKey, type Verdict,
} from "./lootcouncil/council";
import { BisSpecs, CandidateTable, ContentBadge, FoldRow, ItemHead, ItemLink, RaiderIdent } from "./lootcouncil/parts";
import FilterBar from "./lootcouncil/FilterBar";
import RosterList from "./lootcouncil/RosterList";
import RaiderDialog, { ExportDialog } from "./lootcouncil/RaiderDialog";
import "../styles/loot-council.css";

type View = {
    role: string;
    tiers: string[];
    contents: string[];
    category: string;
    bisTier: string;
    /** "drop" is a stored value from before the drop check became its own page; it opens the Raider tab. */
    tab: "roster" | "bis" | "drop" | "bislists" | "compare";
    /** BiS-Listen: which tier's sets, which specs are switched off, what is marked. */
    listTier: string;
    listOff: string[];
    listFocus: number;
    /** Loot-Vergleich: which raiders (by key) are switched off. */
    cmpOff: string[];
};
const VIEW_DEFAULT: View = {
    role: "caster", tiers: [], contents: [], category: "", bisTier: "", tab: "roster",
    listTier: "t6", listOff: [], listFocus: 0, cmpOff: [],
};

// The tier buttons wear the hue of the raids they stand for — the same table
// the raid badges use (.lc-h-* in index.css).
const TIER_HUE: Record<string, string> = { t4: "kara", t5: "ssc", t6: "bt", t65: "swp" };
const TIER_LABEL: Record<string, string> = { t4: "T4", t5: "T5", t6: "T6", t65: "SWP" };

/**
 * One part of a tab: the tinted part head (icon tile, title, at most one
 * action) over a panel. What used to be a hint paragraph under the heading is
 * the title's tooltip.
 */
function Part({ icon, crumb, title, hint, actions, tone = "", children }: {
    icon: string;
    crumb?: string;
    title: string;
    hint?: string;
    actions?: ReactNode;
    children: ReactNode;
    /** "accent" lifts the one part that carries the answer. */
    tone?: "" | "accent";
}) {
    return (
        <section className={`lc-part${tone ? ` lc-part-${tone}` : ""}`}>
            <PartHead icon={icon} title={title} crumb={crumb} tip={hint ? title : undefined} tipSub={hint} action={actions} />
            <div className="lc-panel lc-part-body">{children}</div>
        </section>
    );
}

/** The badge next to a suggested name: measured DPS, or "höchster Bedarf". */
function VerdictGain({ verdict }: { verdict: Verdict }) {
    if (verdict.basis === "sim") {
        return <Badge tone="ok" tip="Simulierte DPS-Differenz" tipSub="WoWSims, gleicher Seed für alle Kandidaten.">{verdict.delta > 0 ? "+" : ""}{Math.round(verdict.delta)} DPS</Badge>;
    }
    if (verdict.basis === "need") {
        return <Badge tone="accent" tip="Höchster Bedarf" tipSub="Für diese Specs gibt es keine Simulation (WoWSims-TBC rechnet keine Heilung). Der Vorschlag folgt dem Bedarf — geschätzt wird kein Zugewinn.">höchster Bedarf</Badge>;
    }
    return null;
}

/** One open BiS item with everyone it would suit. */
function GapCard({ gap, sim, expanded, onToggle, sortState }: {
    gap: CouncilGap;
    sim: SimResult | null;
    expanded: boolean;
    onToggle: () => void;
    /** Shared across every card, so all of them stay ordered the same way. */
    sortState: TableSort<CandidateSortKey>;
}) {
    // The suggestion is always the biggest measured gain, whatever the table
    // is sorted by — and none at all while nothing is simulated.
    const verdict = pickVerdict(gap.candidates, sim, gap.id);
    const best = verdict.best;
    return (
        <article className={`lc-gap${expanded ? " lc-gap-open" : ""}`}>
            <div className="lc-gap-head">
                <ItemHead
                    id={gap.id}
                    name={gap.name}
                    iconUrl={gap.iconUrl}
                    quality={gap.quality}
                    meta={<>
                        <ContentBadge contentId={gap.contentId} />
                        {gap.boss ? `${gap.boss} · ` : ""}ilvl {gap.ilvl} · fehlt {gap.wantedBy.length} Raider(n)
                    </>}
                />
                <BisSpecs specs={gap.bisSpecs} />
            </div>
            <div className="lc-gap-verdict">
                <span className="kicker">Vorschlag</span>
                {best ? (
                    <>
                        <RaiderIdent name={best.character} classColor={best.classColor} specIconUrl={best.specIconUrl} size={28} />
                        <VerdictGain verdict={verdict} />
                    </>
                ) : verdict.basis === "pending" ? (
                    <Badge tip="Noch nicht simuliert" tipSub="„Als Drop prüfen“ rechnet es in Sekunden, „Alle BiS-Items durchrechnen“ die ganze Liste.">nicht simuliert</Badge>
                ) : (
                    <Badge tip="Kein Kandidat" tipSub="Für keinen der gefilterten Raider ein passender Slot.">kein Kandidat</Badge>
                )}
                <span className="lc-grow" />
                <Link className={buttonClass("ghost", "sm", true)} to={dropHref(gap.id)}>
                    <WowIcon name="inv_misc_bag_10" size={18} />Als Drop prüfen
                </Link>
                {gap.candidates.length ? <Expand open={expanded} onToggle={onToggle} label={`${gap.candidates.length} Kandidaten`} /> : null}
            </div>
            {expanded && gap.candidates.length
                ? <CandidateTable itemId={gap.id} candidates={gap.candidates} sim={sim} sortState={sortState} />
                : null}
        </article>
    );
}

/**
 * The BiS lists themselves: which gear set is best in slot for which caster DPS
 * class and spec. A matrix, because the question is a comparison: slots are
 * rows, the lists are columns. The search goes the other way through the same
 * data: name a piece, see for whom it is BiS, step into the list filtered to
 * exactly that spec.
 */
// Die Listen kommen aus zwei Quellen, und das ist keine Kleinigkeit: eine
// WoWSims-Liste ist ein simuliertes Loadout mit Sockeln und Verzauberungen, eine
// Wowhead-Liste eine geschriebene Empfehlung, die nur Items nennt. Beides als
// dasselbe darzustellen hieße, für die Heiler mehr zu behaupten, als dasteht.
const SOURCE_NOTE: Record<string, string> = {
    wowsims: "Simuliertes WoWSims-Set — mit Sockeln und Verzauberungen.",
    wowhead: "Geschriebene Wowhead-Empfehlung — nennt Items, keine Sockel und keine Verzauberungen.",
};

// Neun Spalten sind zu viele, um sie einzeln wegzuklicken, wenn man nur eine
// Hälfte sehen will.
const LIST_GROUPS = [
    { id: "", label: "Alle" },
    { id: "caster", label: "Caster" },
    { id: "healer", label: "Heiler" },
];

function BisListsTab({ view, patch }: { view: View; patch: (p: Partial<View>) => void }) {
    const [data, setData] = useState<BisListsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState("");
    const [query, setQuery] = useState("");
    const [hits, setHits] = useState<CouncilItemHit[]>([]);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        getBisLists(view.listTier)
            .then((d) => { if (alive) { setData(d); setFailed(""); } })
            .catch((e: ApiError) => { if (alive) setFailed(e.message || "Die BiS-Listen konnten nicht geladen werden."); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [view.listTier]);

    // Debounced, and against the tier on screen: "für wen ist das BiS" has a
    // different answer per tier, and answering for the wrong one would be worse
    // than not answering.
    const tier = data ? data.tier : "";
    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) { setHits([]); return undefined; }
        let alive = true;
        const handle = setTimeout(() => {
            searchCouncilItems(q, tier)
                .then((r) => { if (alive) setHits(r.items); })
                .catch(() => { if (alive) setHits([]); });
        }, 220);
        return () => { alive = false; clearTimeout(handle); };
    }, [query, tier]);

    const off = useMemo(() => new Set(view.listOff), [view.listOff]);
    const columns = useMemo(
        () => (data ? data.columns.filter((c) => c.users.some((u) => !off.has(u.key))) : []),
        [data, off],
    );

    /** From a hit into the list: only this spec, the piece marked in its column. */
    const only = (specKey: string, itemId: number) => {
        if (!data) return;
        patch({ listOff: data.specs.map((s) => s.key).filter((k) => k !== specKey), listFocus: itemId });
    };

    if (loading && !data) return <div className="hint">BiS-Listen werden geladen …</div>;
    if (failed) return <div className="empty">{failed}</div>;
    if (!data) return null;

    const searching = query.trim().length >= 2;

    return (
        <>
            <Part
                icon="inv_misc_spyglass_03"
                crumb="BiS-Listen › Suche"
                title="Item nachschlagen"
                hint="Der umgekehrte Weg: Teil eingeben, sehen für welche Specs es BiS ist — und von dort in die Liste springen, gefiltert auf genau die."
            >
                <input
                    className="lc-blsearch"
                    type="text"
                    value={query}
                    placeholder="Itemname, z. B. Skull of Gul'dan"
                    onChange={(e) => setQuery(e.target.value)}
                />
                {searching ? (
                    <div className="lc-blresults">
                        {hits.map((hit) => (
                            <div key={hit.id} className="lc-blresult">
                                {hit.iconUrl
                                    ? <img src={hit.iconUrl} alt="" loading="lazy" {...itemQualityProps(hit.quality, "lc-blicon")} />
                                    : <span className="lc-blicon lc-blnoicon" />}
                                <div className="lc-blresultbody">
                                    <div className="lc-blresulthead">
                                        <ItemLink id={hit.id} name={hit.name} quality={hit.quality} />
                                        <ContentBadge contentId={hit.contentId} label={hit.boss} />
                                        {hit.ilvl ? <span className="lc-blilvl">ilvl {hit.ilvl}</span> : null}
                                    </div>
                                    {hit.bisSpecs.length ? (
                                        <div className="lc-blresultspecs">
                                            <span className="lc-blbisfor">BiS für</span>
                                            {hit.bisSpecs.map((spec) => (
                                                <button
                                                    key={spec.specKey}
                                                    type="button"
                                                    className="lc-bllink"
                                                    style={classColorProps(spec.classColor).style}
                                                    onClick={() => only(spec.specKey, hit.id)}
                                                    data-tip={`Liste auf ${spec.label} filtern und das Teil dort hervorheben`}
                                                >
                                                    {spec.label}
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="lc-blnobis">Steht auf keiner Liste dieses Tiers.</div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {!hits.length ? <div className="lc-blnobis">Kein Item mit diesem Namen.</div> : null}
                    </div>
                ) : null}
            </Part>

            <Part
                icon="inv_misc_book_09"
                crumb="BiS-Listen › Specs"
                title="Welche Specs nebeneinander"
                hint={`${data.specs.length} Specs, ${data.columns.length} Listen. Wer keine eigene hat, spielt die einer anderen Spec — das steht an der Spalte.`}
                actions={
                    <div className="lc-blfilters">
                        {data.tiers.map((t) => (
                            <button
                                key={t.id}
                                type="button"
                                className={`lc-filter lc-h-${TIER_HUE[t.id] || "bt"}${t.id === data.tier ? " active" : ""}`}
                                onClick={() => patch({ listTier: t.id, listFocus: 0 })}
                                data-tip={t.missing.length
                                    ? `Für ${t.missing.join(" und ")} gibt es kein Set dieses Tiers`
                                    : t.label}
                            >
                                {TIER_LABEL[t.id] || t.label}
                                {t.missing.length ? <span className="lc-blgap">!</span> : null}
                            </button>
                        ))}
                    </div>
                }
            >
                <div className="lc-blgroups">
                    {LIST_GROUPS.map((group) => {
                        const inGroup = (key: string) => !group.id
                            || data.specs.find((s) => s.key === key)?.role === group.id;
                        const active = data.specs.every((s) => off.has(s.key) !== inGroup(s.key));
                        return (
                            <button
                                key={group.id || "all"}
                                type="button"
                                className={`lc-filter${active ? " active" : ""}`}
                                onClick={() => patch({
                                    listOff: data.specs.filter((s) => !inGroup(s.key)).map((s) => s.key),
                                    listFocus: 0,
                                })}
                            >
                                {group.label}
                            </button>
                        );
                    })}
                </div>
                <div className="lc-blspecs">
                    {data.specs.map((spec) => (
                        <button
                            key={spec.key}
                            type="button"
                            className={`lc-blspec${off.has(spec.key) ? " off" : ""}`}
                            style={classColorProps(spec.classColor).style}
                            onClick={() => patch({
                                listOff: off.has(spec.key)
                                    ? view.listOff.filter((k) => k !== spec.key)
                                    : [...view.listOff, spec.key],
                            })}
                            data-tip={spec.ownList ? "Eigene Liste" : "Spielt die Liste einer anderen Spec"} aria-label={spec.ownList ? "Eigene Liste" : "Spielt die Liste einer anderen Spec"}
                        >
                            <img src={spec.iconUrl} alt="" loading="lazy" />
                            <span className="class-colored">{spec.label}</span>
                            <span className="lc-blmark" />
                        </button>
                    ))}
                </div>
            </Part>

            <Part
                tone="accent"
                icon="inv_misc_gem_variety_02"
                crumb="BiS-Listen › Matrix"
                title={TIER_LABEL[data.tier] || data.tier.toUpperCase()}
                hint={`${columns.length} von ${data.columns.length} Listen · ${data.contested} Teile stehen auf mehr als einer`}
                actions={
                    <div className="lc-bllegend">
                        <span className="lc-blshare">×N</span>
                        <span className="lc-muted">steht auf mehreren Listen</span>
                    </div>
                }
            >
                {columns.length ? (
                    <div className="lc-bltable">
                        <table className="idx lc-blmatrix">
                            <thead>
                                <tr>
                                    <th className="lc-blcorner">Slot</th>
                                    {columns.map((col) => (
                                        <th key={col.key} className="lc-blcol" style={classColorProps(col.classColor).style}>
                                            <span className="lc-blcolhead">
                                                <img src={col.iconUrl} alt="" loading="lazy" />
                                                <span className="lc-blcolname class-colored">{col.label}</span>
                                            </span>
                                            {col.source === "wowhead" ? (
                                                <span className="lc-blsource" data-tip={SOURCE_NOTE[col.source]}>
                                                    {col.sourceLabel}
                                                </span>
                                            ) : null}
                                            <span className="lc-blcolusers">
                                                {col.users.filter((u) => !off.has(u.key)).map((u) => (
                                                    <span
                                                        key={u.key}
                                                        className="lc-bluser"
                                                        data-tip={u.ownList
                                                            ? "Diese Liste gehört ihm"
                                                            : "Spielt diese Liste, hat keine eigene"}
                                                    >
                                                        {u.ownList ? "eigene Liste" : u.label}
                                                    </span>
                                                ))}
                                            </span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.map((row) => (
                                    <tr key={row.slot}>
                                        <th scope="row" className="lc-blslot">{row.slotName}</th>
                                        {columns.map((col) => {
                                            const cell = row.cells.find((c) => c.column === col.key);
                                            return (
                                                <BisListCell
                                                    key={col.key}
                                                    cell={cell}
                                                    source={col.source}
                                                    focused={!!cell && !!cell.item && cell.item.id === view.listFocus}
                                                />
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="empty">Keine Spec ausgewählt — oben wieder eine zuschalten.</div>
                )}
            </Part>
        </>
    );
}

/** One position of one list: the item, where it drops, how it is socketed. */
function BisListCell({ cell, source, focused }: {
    cell?: BisListsData["rows"][number]["cells"][number];
    source: string;
    focused: boolean;
}) {
    if (!cell || !cell.item) return <td className="lc-blcell"><span className="lc-blfree">frei</span></td>;
    const item = cell.item;
    const shared = cell.shared || 1;
    // Nur ein simuliertes Set weiß etwas über Sockel und Verzauberungen. Bei
    // einer geschriebenen Liste "keine Sockel" zu melden wäre eine Aussage über
    // das Item statt über die Quelle — und damit falsch.
    const reference = source === "wowsims"
        ? `WoWSims-Referenz: ${cell.gems ? `${cell.gems} Sockel` : "keine Sockel"}, ${cell.enchanted ? "verzaubert" : "keine Verzauberung"}`
        : SOURCE_NOTE[source] || "";
    return (
        <td
            className={`lc-blcell${shared > 1 ? " shared" : ""}${focused ? " focused" : ""}`}
            data-tip={[reference, shared > 1 ? `steht auf ${shared} Listen` : ""].filter(Boolean).join(" · ")}
        >
            <span className="lc-blitem">
                <img src={item.iconUrl} alt="" loading="lazy" {...itemQualityProps(item.quality, "lc-blicon")} />
                <span>
                    <ItemLink id={item.id} name={item.name} quality={item.quality} />
                    <span className="lc-blmeta">
                        <ContentBadge contentId={item.contentId} label={item.boss} />
                        <span className="lc-blilvl">{item.ilvl}</span>
                        {shared > 1 ? <span className="lc-blshare">×{shared}</span> : null}
                    </span>
                </span>
            </span>
        </td>
    );
}

// ── Loot-Vergleich ───────────────────────────────────────────────────────────
// Rows = items, columns = raiders. The roster tab answers "was hat der schon"
// one hover at a time; a council deciding between three warlocks wants the
// three side by side, and the same item in the same row for each of them.

/** Character-sheet order for the rows: armour, jewellery, weapons. */
const SHEET_ORDER = [0, 1, 2, 14, 4, 8, 9, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17];

type CompareRow = {
    itemId: number;
    name: string;
    iconUrl: string;
    quality: number | null;
    boss: string;
    slot: number;
    slotName: string;
    /** Every award of this item, per raider key, newest first. */
    awards: Map<string, CouncilLootItem[]>;
};
type CompareGroup = { contentId: string; label: string; tier: string; rows: CompareRow[] };

/**
 * The matrix's rows out of the raiders' own loot lists: one row per item and
 * raid, grouped by raid in the filter's order and ordered like a character
 * sheet inside a raid — so a row down is "wer hat den Helm" and a column down
 * is one raider's haul.
 *
 * The item lists are the ones the roster already carries, so the matrix obeys
 * the same content filter and the same "what counts as loot" rule (no
 * off-spec, no shards) without a second request.
 */
function buildCompare(raiders: CouncilRaider[], contents: { id: string; label: string; tier: string }[]): CompareGroup[] {
    const groups = new Map<string, CompareGroup>();
    const rowsByKey = new Map<string, CompareRow>();
    for (const r of raiders) {
        for (const it of r.items) {
            const cid = it.contentId || "";
            let group = groups.get(cid);
            if (!group) {
                const meta = contents.find((c) => c.id === cid);
                group = { contentId: cid, label: meta ? meta.label : "Ohne Raid-Zuordnung", tier: it.tier || (meta ? meta.tier : ""), rows: [] };
                groups.set(cid, group);
            }
            const rowKey = `${cid}:${it.itemId}`;
            let row = rowsByKey.get(rowKey);
            if (!row) {
                row = {
                    itemId: it.itemId, name: it.itemName, iconUrl: it.itemIconUrl, quality: it.itemQuality,
                    boss: it.boss, slot: it.slot, slotName: it.slotName, awards: new Map(),
                };
                rowsByKey.set(rowKey, row);
                group.rows.push(row);
            }
            const list = row.awards.get(r.key) || [];
            list.push(it);
            row.awards.set(r.key, list);
        }
    }
    const order = new Map(contents.map((c, i) => [c.id, i]));
    const slotRank = (slot: number) => {
        const i = SHEET_ORDER.indexOf(slot);
        return i < 0 ? SHEET_ORDER.length : i;
    };
    const out = [...groups.values()];
    for (const group of out) {
        group.rows.sort((a, b) => slotRank(a.slot) - slotRank(b.slot) || a.name.localeCompare(b.name));
        for (const row of group.rows) {
            for (const list of row.awards.values()) list.sort((a, b) => (b.awardedAt || 0) - (a.awardedAt || 0));
        }
    }
    // An item the content table does not know goes last, not into a wrong raid.
    out.sort((a, b) => (order.get(a.contentId) ?? contents.length) - (order.get(b.contentId) ?? contents.length));
    return out;
}

/**
 * One cell of the comparison: what this raider got of this item, or — when
 * nothing — whether it is still open on their BiS list. A blank cell would
 * only say "not this one"; "BiS offen" says why the row matters to them.
 */
function CompareCell({ raider, row, awards }: { raider: CouncilRaider; row: CompareRow; awards: CouncilLootItem[] }) {
    const entry = raider.bis.items.find((b) => b.id === row.itemId);
    if (!awards.length) {
        if (!entry) return <td className="lc-blcell lc-cmpcell"><span className="lc-blfree">—</span></td>;
        // On their list but never awarded here: either still open, or worn
        // from somewhere the history does not cover (an older import, a PUG).
        return (
            <td className={`lc-blcell lc-cmpcell${entry.owned ? "" : " wants"}`}>
                <span
                    className={`lc-cmpwant${entry.owned ? " worn" : ""}`}
                    data-tip={entry.owned
                        ? "Steht auf der BiS-Liste und wird getragen — nur nicht in diesem Loot vergeben"
                        : "Steht auf der BiS-Liste und fehlt noch"}
                >
                    {entry.owned ? "trägt es" : "BiS offen"}
                </span>
            </td>
        );
    }
    return (
        <td className="lc-blcell lc-cmpcell got" data-tip={awards.map((a) => a.eventLabel).filter(Boolean).join(" · ")}>
            {awards.map((a, i) => (
                <span key={`${a.awardedAt}-${i}`} className="lc-cmpaward">
                    <span className="lc-cmpdate">{a.awardedAt ? fmtMs(a.awardedAt, false) : "erhalten"}</span>
                    {a.reasonLabel ? <ReasonBadge label={a.reasonLabel} tone={a.reasonTone} title={a.reason} /> : null}
                </span>
            ))}
            {entry ? <span className="lc-cmpbis" data-tip="Steht auf der BiS-Liste dieses Raiders">BiS</span> : null}
        </td>
    );
}

function CompareTab({ roster, view, patch, contents }: {
    roster: CouncilRaider[];
    view: View;
    patch: (p: Partial<View>) => void;
    contents: { id: string; label: string; tier: string }[];
}) {
    const off = useMemo(() => new Set(view.cmpOff), [view.cmpOff]);
    const active = useMemo(() => roster.filter((r) => !off.has(r.key)), [roster, off]);
    const groups = useMemo(() => buildCompare(active, contents), [active, contents]);
    const itemCount = groups.reduce((n, g) => n + g.rows.length, 0);
    // The switches in name order: the roster's need order changes with every
    // import, and a row of switches somebody scans for a name should not.
    const byName = useMemo(() => [...roster].sort((a, b) => a.character.localeCompare(b.character)), [roster]);

    const toggle = (key: string) => patch({
        cmpOff: off.has(key) ? view.cmpOff.filter((k) => k !== key) : [...view.cmpOff, key],
    });

    return (
        <>
            <Part
                icon="achievement_guildperk_everybodysfriend"
                crumb="Loot-Vergleich › Raider"
                title="Welche Raider nebeneinander"
                hint={`${active.length} von ${roster.length} Raidern aus dem Filter oben. Welcher Loot zählt, bestimmt der Content-Filter — Offspec, Entzaubern und Bank stehen hier nicht.`}
                actions={
                    <div className="lc-blfilters">
                        <button type="button" className={`lc-filter${!view.cmpOff.length ? " active" : ""}`} onClick={() => patch({ cmpOff: [] })}>
                            Alle
                        </button>
                        <button
                            type="button"
                            className={`lc-filter${roster.length && !active.length ? " active" : ""}`}
                            onClick={() => patch({ cmpOff: roster.map((r) => r.key) })}
                        >
                            Keiner
                        </button>
                    </div>
                }
            >
                {roster.length ? (
                    <div className="lc-blspecs">
                        {byName.map((r) => (
                            <button
                                key={r.key}
                                type="button"
                                className={`lc-blspec${off.has(r.key) ? " off" : ""}`}
                                style={classColorProps(r.classColor).style}
                                onClick={() => toggle(r.key)}
                                data-tip={`${r.specLabel} · ${r.lootCount} Items im Filter`} aria-label={`${r.specLabel} · ${r.lootCount} Items im Filter`}
                            >
                                <ClassSpecIcon iconUrl={r.specIconUrl} />
                                <span className="class-colored">{r.character}</span>
                                <span className="lc-cmpcount">{r.lootCount}</span>
                                <span className="lc-blmark" />
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="empty">Keine passenden Raider im Filter.</div>
                )}
            </Part>

            <Part
                tone="accent"
                icon="inv_misc_bag_10"
                crumb="Loot-Vergleich › Matrix"
                title="Loot-Vergleich"
                hint={`${itemCount} Items in ${groups.length} Raid(s) · Zeilen wie ein Charakterbogen, Spalten sind die Raider — wer am längsten nichts bekommen hat, steht links.`}
                actions={
                    <div className="lc-bllegend">
                        <span className="lc-cmpwant">BiS offen</span>
                        <span className="lc-muted">steht auf seiner Liste und fehlt noch</span>
                    </div>
                }
            >
                {!active.length ? (
                    <div className="empty">Kein Raider ausgewählt — oben wieder einen zuschalten.</div>
                ) : !itemCount ? (
                    <div className="empty">Keiner der gewählten Raider hat im aktuellen Content-Filter etwas bekommen.</div>
                ) : (
                    <div className="lc-bltable">
                        <table className="idx lc-blmatrix lc-cmpmatrix">
                            <thead>
                                <tr>
                                    <th className="lc-blcorner lc-cmpitem">Item</th>
                                    {active.map((r) => (
                                        <th key={r.key} className="lc-blcol lc-cmpcol" style={classColorProps(r.classColor).style}>
                                            <span className="lc-blcolhead">
                                                <ClassSpecIcon iconUrl={r.specIconUrl} />
                                                <span className="lc-blcolname class-colored">{r.character}</span>
                                            </span>
                                            <span className="lc-cmpcolsub">
                                                {r.lootCount} Items · BiS {r.bis.owned}/{r.bis.total}
                                            </span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {groups.map((group) => (
                                    <Fragment key={group.contentId || "none"}>
                                        <tr className="lc-cmpgroup">
                                            <th scope="rowgroup" colSpan={active.length + 1}>
                                                <ContentBadge contentId={group.contentId} tier={group.tier} />
                                                <span>{group.label}</span>
                                                <span className="lc-muted">{group.rows.length} Items</span>
                                            </th>
                                        </tr>
                                        {group.rows.map((row) => (
                                            <tr key={row.itemId}>
                                                <th scope="row" className="lc-blslot lc-cmpitem">
                                                    <span className="lc-blitem">
                                                        {row.iconUrl
                                                            ? <img src={row.iconUrl} alt="" loading="lazy" {...itemQualityProps(row.quality, "lc-blicon")} />
                                                            : <span className="lc-blicon lc-blnoicon" />}
                                                        <span>
                                                            <ItemLink id={row.itemId} name={row.name} quality={row.quality} />
                                                            <span className="lc-blmeta">
                                                                {row.slotName ? <span className="lc-cmpslot">{row.slotName}</span> : null}
                                                                {row.boss ? <span className="lc-blilvl">{row.boss}</span> : null}
                                                            </span>
                                                        </span>
                                                    </span>
                                                </th>
                                                {active.map((r) => (
                                                    <CompareCell key={r.key} raider={r} row={row} awards={row.awards.get(r.key) || []} />
                                                ))}
                                            </tr>
                                        ))}
                                    </Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Part>
        </>
    );
}

export default function LootCouncilPage() {
    const { user } = useOutletContext<ShellContext>();
    // Setting a raider aside is an action on the server, so it takes write.
    const canWrite = canAccess(user, "lootcouncil", "write");
    const navigate = useNavigate();
    const ask = useConfirm();
    const [view, setView] = usePersistedState<View>(VIEW_KEY, VIEW_DEFAULT);
    // A stored "drop" tab is from before the drop check had its own page.
    const tab = view.tab === "drop" ? "roster" : view.tab;
    const [data, setData] = useState<LootCouncilData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [loading, setLoading] = useState(true);
    const jobs = useJobs();
    const toast = useToast();
    // Whether a first load has landed — after it, reloads run as quiet jobs
    // (the full-page loader would lose the reader's place).
    const loaded = useRef(false);
    // Sim results live next to the data, not in it: the page is complete
    // without them and they are only ever an improvement laid over the top.
    const { sim, setSim, simRunning, runSim } = useCouncilSim();
    // The open WoWSims export, if any — one raider at a time.
    const [exportData, setExportData] = useState<CouncilExport | null>(null);
    // Which per-raider actions are in flight, as "action:character" — two
    // raiders can be worked on at once, each button shows only its own spinner.
    const [busy, setBusy] = useState<Set<string>>(new Set());
    const [expanded, setExpanded] = useState<Set<number>>(new Set());
    const [excludedOpen, setExcludedOpen] = useState(false);
    const rosterSort = useTableSort<RosterSortKey>("lootcouncil.roster-sort", ROSTER_SORT, "need");
    // One sort for every candidate table, so the cards stay comparable.
    const candidateSort = useTableSort<CandidateSortKey>("lootcouncil.candidate-sort", CANDIDATE_SORT, "gain");
    // The raider whose details are open lives in the url (?raider=<name>), so a
    // link from the drop check or from Discord leads straight there.
    const [params, setParams] = useSearchParams();
    const openName = (params.get("raider") || "").toLowerCase();

    // Returns the promise (resolving with the fresh data, or null) so an action
    // that reloads afterwards can keep its spinner until the new list is on
    // screen — and can report on what it sees there.
    const load = useCallback((): Promise<LootCouncilData | null> => {
        setLoading(true);
        const fetchData = () => getLootCouncil({
            role: view.role,
            tiers: view.tiers,
            contents: view.contents,
            category: view.category,
            bisTier: view.bisTier,
        });
        const request = loaded.current
            ? jobs.run({ label: "Loot-Council wird geladen", quiet: true }, fetchData)
            : fetchData().catch((err: ApiError) => { setError(err); return null; });
        return request
            .then((d) => {
                if (d) { setData(d); setError(null); loaded.current = true; }
                return d;
            })
            .finally(() => setLoading(false));
    }, [view.role, view.tiers, view.contents, view.category, view.bisTier, jobs]);

    /** Everything that depends on the raiders' data — every gear-changing action goes through here. */
    const reloadAll = useCallback(async () => load(), [load]);

    // Wrapped rather than passed directly: `load` returns a promise, and a
    // promise handed to useEffect would be mistaken for a cleanup function.
    useEffect(() => { load(); }, [load]);

    // A changed filter changes which raiders and items were simulated, so the
    // old results no longer describe what is on screen.
    useEffect(() => { setSim(null); }, [view.role, view.tiers, view.contents, view.category, view.bisTier, setSim]);

    const patch = (next: Partial<View>) => setView({ ...view, ...next });

    const roster = useMemo(() => (data ? data.roster : []), [data]);
    const gaps = data ? data.gaps : [];
    const simulatable = useMemo(
        () => roster.filter((r) => r.simSupported && r.gear).map((r) => ({ key: r.key, specKey: r.specKey })),
        [roster],
    );
    const armoryCount = roster.filter((r) => r.gear && r.gear.source === "armory").length;
    const simulated = simulatable.filter((s) => sim && sim[s.key] && sim[s.key].baseline !== null).length;

    // The list opens on the server's own order (most overdue first); every other column is one click.
    const sortedRoster = rosterSort.apply(roster, (r, key) => {
        switch (key) {
            case "character": return r.character.toLowerCase();
            case "need": return r.needScore;
            case "loot": return r.lootCount;
            // Never having won anything is further back than any date.
            case "last": return r.lastAwardAt || 0;
            case "bis": return r.bis.total ? r.bis.owned / r.bis.total : -1;
            case "dps": return (sim && sim[r.key] && sim[r.key].baseline) || 0;
            default: return 0;
        }
    });
    const openIndex = openName ? sortedRoster.findIndex((r) => r.character.toLowerCase() === openName) : -1;
    const openRaider: CouncilRaider | null = openIndex >= 0 ? sortedRoster[openIndex] : null;

    const openDetails = (character: string) => setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("raider", character);
        return next;
    });
    const closeDetails = () => setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("raider");
        return next;
    });

    /**
     * Run one per-raider action with a visible busy state. Without feedback a
     * row simply sits there and the natural response is to click again, which
     * fires the request twice.
     */
    const runFor = async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
        if (busy.has(key)) return;
        setBusy((prev) => new Set(prev).add(key));
        try {
            return await fn();
        } catch (err) {
            toast((err as ApiError).message || "Die Aktion ist fehlgeschlagen.", "err");
            return undefined;
        } finally {
            setBusy((prev) => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        }
    };

    /** That raider's loadout as a WoWSims import, to check our number with. */
    const showExport = (character: string) => runFor(
        `export:${character}`,
        async () => setExportData(await getCouncilExport(character)),
    );

    /** Als was ein Raider eingeplant wird — reicht bis ins Gear durch, also danach alles neu. */
    const setRole = (character: string, role: "" | "caster" | "healer") => runFor(
        `role:${character}`,
        async () => {
            await setCouncilRole(character, role);
            await reloadAll();
            toast(role
                ? `${character} wird als ${ROLE_LABEL[role] || role} eingeplant.`
                : `Festlegung für ${character} zurückgenommen — es gilt wieder, was die Daten sagen.`);
        },
    );

    /**
     * Fetch current gear from the armory, then reload — and report what the
     * reload shows: the armory regularly answers with an arena set, which the
     * server refuses, and then the button looks as if it had done nothing.
     */
    const loadArmory = (characters: string[], key: string) => runFor(key, async () => {
        const result = await jobs.run(
            { label: "Armory wird geladen", detail: characters.length === 1 ? characters[0] : `${characters.length} Raider`, quiet: true },
            () => refreshCouncilArmory(characters),
        );
        // A failure is already on the toast.
        if (!result) return;
        const fresh = await reloadAll();
        if (!result.answered) {
            toast(characters.length === 1
                ? `Die Armory kennt ${characters[0]} nicht (oder antwortet gerade nicht) — es bleibt beim Stand der letzten Auswertung.`
                : "Die Armory hat für niemanden geantwortet — es bleibt beim Stand der letzten Auswertung.", "err");
            return;
        }
        const asked = new Set(characters.map((c) => c.toLowerCase()));
        const rows = fresh ? fresh.roster.filter((r) => asked.has(r.character.toLowerCase())) : [];
        const taken = rows.filter((r) => r.gear && r.gear.source === "armory").length;
        const pvp = rows.filter((r) => r.gear && r.gear.armoryRejected === "pvp").map((r) => r.character);
        const wrongRole = rows.filter((r) => r.gear && r.gear.armoryRejected === "role").map((r) => r.character);
        const parts = [`Armory geladen: ${taken} von ${characters.length} Raider(n) mit aktuellem Gear.`];
        if (pvp.length) parts.push(`${pvp.join(", ")}: die Armory zeigt PvP-Gear — es bleibt beim Set aus dem letzten Raid.`);
        if (wrongRole.length) parts.push(`${wrongRole.join(", ")}: die Armory zeigt ein Set der anderen Rolle — es bleibt beim Set aus dem letzten Raid.`);
        toast(parts.join(" "), taken ? "ok" : "err");
    });

    /**
     * Gear aus einem Log laden — eines der letzten Logs des Bots, ein Link,
     * oder ohne beides das neueste Log, in dem der Raider steht. Resolves true
     * when the set was taken, so the dialog can close its log panel.
     */
    const loadLogGear = async (character: string, pick: { reportId?: string; link?: string }) => !!(await runFor(`loggear:${character}`, async () => {
        const result = await jobs.run(
            { label: "Log wird geladen", detail: character, quiet: true },
            () => loadCouncilLogGear({ character, ...pick }),
        );
        // A failure ("steht nicht in diesem Log") is already on the toast.
        if (!result) return false;
        const fresh = await reloadAll();
        const row = fresh ? fresh.roster.find((r) => r.character.toLowerCase() === character.toLowerCase()) : null;
        const when = result.reportStart ? ` (${fmtMs(result.reportStart, false)})` : "";
        const from = `„${result.reportTitle || result.reportId}“${when}`;
        if (row && row.gear && row.gear.logRejected === "pvp") {
            toast(`${character} trägt in ${from} PvP-Gear — es bleibt beim Set aus der Auswertung.`, "err");
            return false;
        }
        if (row && row.gear && row.gear.logRejected === "role") {
            toast(`${character} trägt in ${from} ein Set der anderen Rolle — es bleibt beim Set aus der Auswertung.`, "err");
            return false;
        }
        toast(`Gear von ${character} aus ${from} geladen: ${result.items} Teile.`);
        return true;
    }));

    /** Zurück zum Set aus der Auswertung: geladenes Log und Armory-Antwort vergessen. */
    const useEvaluation = (character: string) => runFor(`loggear:${character}`, async () => {
        await loadCouncilLogGear({ character, clear: true });
        await reloadAll();
        toast(`${character} wird wieder nach der letzten Auswertung bewertet.`);
    });

    // Wowheads Tooltip-Widget hat die Seite vor React gescannt — nach jedem
    // Render mit neuem Gear die Item-Links nachmelden.
    useEffect(() => { refreshWowheadLinks(); }, [data, view.tab]);

    /**
     * Set a raider aside, or take them back in. Reloads afterwards: the need
     * score is relative to the group, so removing one raider changes
     * everybody else's number.
     */
    const setExcluded = (character: string, excluded: boolean) => runFor(
        `exclude:${character}`,
        async () => {
            await setCouncilExcluded(character, excluded);
            await reloadAll();
            toast(excluded ? `${character} wird nicht mehr eingeplant.` : `${character} wird wieder eingeplant.`);
        },
    );

    /** "Nicht einplanen" from the details — destructive enough to ask first. */
    const excludeFromDialog = async (character: string) => {
        const ok = await ask({
            title: `${character} nicht einplanen?`,
            text: "Bleibt in der Historie und lässt sich jederzeit wieder einplanen — verschwindet nur aus dieser Liste, und die Bedarfswerte der anderen verschieben sich.",
            action: "Nicht einplanen",
            tone: "danger",
            icon: "ability_rogue_feigndeath",
        });
        if (!ok) return;
        closeDetails();
        await setExcluded(character, true);
    };

    if (loading && !data) return <PageLoader show text="Loot-Council wird geladen" />;
    if (error) return <div className="empty">{error.message}</div>;
    if (!data) return null;

    const o = data.options;
    const kicker = [
        o.bisTiers.find((t) => t.id === data.filter.bisTier)?.label || "",
        [...o.tiers.filter((t) => view.tiers.includes(t.id)), ...o.contents.filter((c) => view.contents.includes(c.id))]
            .map((c) => c.label).join(" + ") || "Aller Loot",
        o.categories.find((c) => c.id === view.category)?.name || "Alle Raids",
    ].filter(Boolean).join(" · ");

    return (
        <>
            <PageHead
                icon="inv_misc_coin_02"
                tone="lootcouncil"
                kicker={kicker}
                title="Loot-Council"
                action={<Button icon="inv_misc_bag_10" onClick={() => navigate(dropHref())}>Drop prüfen</Button>}
            />

            <FilterBar
                data={data}
                view={view}
                patch={patch}
                armoryCount={armoryCount}
                simulated={simulated}
                simulatable={simulatable.length}
            />

            <div className="tabs lc-tabs">
                <button type="button" className={`tab-btn${tab === "roster" ? " active" : ""}`} onClick={() => patch({ tab: "roster" })}>
                    Raider <span className="tab-count">{roster.length}</span>
                </button>
                <button type="button" className={`tab-btn${tab === "bis" ? " active" : ""}`} onClick={() => patch({ tab: "bis" })}>
                    Offene BiS-Items <span className="tab-count">{gaps.length}</span>
                </button>
                <button type="button" className={`tab-btn${tab === "bislists" ? " active" : ""}`} onClick={() => patch({ tab: "bislists" })}>
                    BiS-Listen
                </button>
                <button type="button" className={`tab-btn${tab === "compare" ? " active" : ""}`} onClick={() => patch({ tab: "compare" })}>
                    Loot-Vergleich
                </button>
            </div>

            {tab === "roster" ? (
                <>
                    <PartHead
                        icon="achievement_guildperk_everybodysfriend"
                        crumb="Loot-Council › Raider"
                        title="Wer ist dran?"
                        tip="Wer ist dran?"
                        tipSub="Wer am längsten nichts bekommen hat, steht oben. Die Details eines Raiders zeigen Gear, BiS-Lücken und Loot."
                        action={data.sim.available ? (
                            <Button
                                variant="run"
                                size="sm"
                                icon="inv_gizmo_02"
                                running={simRunning}
                                disabled={!simulatable.length}
                                onClick={() => runSim([], simulatable)}
                            >
                                DPS berechnen
                            </Button>
                        ) : undefined}
                    />
                    {roster.length ? (
                        <RosterList
                            rows={sortedRoster}
                            sim={sim}
                            sort={rosterSort}
                            openKey={openRaider ? openRaider.key : ""}
                            onOpen={openDetails}
                        />
                    ) : (
                        <div className="lc-panel empty">
                            Keine passenden Raider. Der Loot-Council liest Klasse und Spec aus den Loot-Importen und den
                            CLA-Auswertungen — ohne die bleibt die Liste leer.
                        </div>
                    )}
                    {data.excluded.length ? (
                        <FoldRow
                            icon="ability_rogue_feigndeath"
                            title="Nicht eingeplant"
                            count={data.excluded.length}
                            names={data.excluded.map((e) => e.character).join(", ")}
                            open={excludedOpen}
                            onToggle={() => setExcludedOpen((v) => !v)}
                        >
                            <div className="lc-dlist">
                                {data.excluded.map((e) => (
                                    <div key={e.key} className="lc-dlist-row">
                                        <b>{e.character}</b>
                                        <span className="lc-muted">seit {fmtMs(e.at, false)}{e.by ? ` · ${e.by}` : ""}</span>
                                        {canWrite ? (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="lc-dlist-act"
                                                running={busy.has(`exclude:${e.character}`)}
                                                disabled={busy.has(`exclude:${e.character}`)}
                                                onClick={() => setExcluded(e.character, false)}
                                            >
                                                Wieder einplanen
                                            </Button>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </FoldRow>
                    ) : null}
                </>
            ) : null}

            {tab === "bis" ? (
                <>
                    <PartHead
                        icon="inv_misc_gem_variety_02"
                        crumb="Loot-Council › Offene BiS-Items"
                        title="Was fehlt noch?"
                        tip="Offene BiS-Items"
                        tipSub="Items, die auf mindestens einer BiS-Liste stehen und noch niemand aus der gefilterten Gruppe trägt — sortiert danach, wie viele darauf warten. Der Vorschlag ist der größte Zugewinn, nicht der längste Wartende: wer dran ist, entscheidet ihr."
                        action={data.sim.available ? (
                            <Button
                                variant="run"
                                size="sm"
                                icon="inv_gizmo_02"
                                running={simRunning}
                                disabled={!simulatable.length || !gaps.length}
                                data-tip="Alle BiS-Items durchrechnen"
                                data-tip-sub="Rechnet jedes offene BiS-Item gegen jeden Raider durch — gründlich, aber minutenlang. Für ein einzelnes Item ist „Drop prüfen“ schneller."
                                onClick={() => runSim(gaps.map((g) => g.id), simulatable)}
                            >
                                Alle BiS-Items durchrechnen ({gaps.length})
                            </Button>
                        ) : undefined}
                    />
                    {gaps.length ? gaps.map((gap) => (
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
                        />
                    )) : (
                        <div className="lc-panel empty">
                            Keine offenen BiS-Items im gewählten Filter — entweder trägt die Gruppe schon alles,
                            oder für ihre Specs gibt es zu diesem Tier keine BiS-Liste.
                        </div>
                    )}
                </>
            ) : null}

            {/* Die Listen selbst — die einzige Ansicht hier, die nicht von den
                Raidern und ihrem Loot abhängt, sondern nur von WoWSims. */}
            {tab === "bislists" ? <BisListsTab view={view} patch={patch} /> : null}

            {/* Wer hat was bekommen, nebeneinander: dieselben Raider und derselbe
                Loot wie im Raider-Tab, nur als Matrix statt als Tooltip je Zeile. */}
            {view.tab === "compare" ? <CompareTab roster={roster} view={view} patch={patch} contents={o.contents} /> : null}

            {openRaider ? (
                <RaiderDialog
                    key={openRaider.key}
                    raider={openRaider}
                    rank={openIndex + 1}
                    total={sortedRoster.length}
                    sim={sim}
                    canWrite={canWrite}
                    busy={busy}
                    logs={data.recentLogs || []}
                    onClose={closeDetails}
                    onRole={setRole}
                    onArmory={(character) => loadArmory([character], `armory:${character}`)}
                    onLogLoad={loadLogGear}
                    onEvaluation={useEvaluation}
                    onExport={showExport}
                    onExclude={excludeFromDialog}
                />
            ) : null}
            <ExportDialog data={exportData} onClose={() => setExportData(null)} />
        </>
    );
}
