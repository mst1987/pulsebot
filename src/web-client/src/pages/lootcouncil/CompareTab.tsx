import { Fragment, useMemo } from "react";
import type { CouncilLootItem, CouncilRaider } from "../../api";
import { fmtMs } from "../../lib/format";
import { itemQualityProps } from "../../lib/itemQuality";
import { classColorProps, ClassSpecIcon } from "../../components/ClassSpec";
import { ReasonBadge } from "../../components/loot/LootBadges";
import { ContentBadge, ItemLink } from "./ItemBits";
import type { View } from "./view";
import { Part } from "./Part";

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

export function CompareTab({ roster, view, patch, contents }: {
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
