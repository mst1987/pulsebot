import { useEffect, useMemo, useState } from "react";
import { searchCouncilItems, getBisLists, type ApiError, type BisListsData, type CouncilItemHit } from "../../api";
import { itemQualityProps } from "../../lib/itemQuality";
import { classColorProps } from "../../components/ClassSpec";
import { ContentBadge, ItemLink } from "./ItemBits";
import type { View } from "./view";
import { Part } from "./Part";

// The tier buttons wear the hue of the raids they stand for — the same table
// the raid badges use (.lc-h-* in index.css).
const TIER_HUE: Record<string, string> = { t4: "kara", t5: "ssc", t6: "bt", t65: "swp" };

const TIER_LABEL: Record<string, string> = { t4: "T4", t5: "T5", t6: "T6", t65: "SWP" };

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

export function BisListsTab({ view, patch }: { view: View; patch: (p: Partial<View>) => void }) {
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
