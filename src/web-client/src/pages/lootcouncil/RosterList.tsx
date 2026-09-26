// "Wer ist dran?" — one compact line per raider. Everything that used to sit in
// the raider's block at once (the gear band with sixteen icons, the source
// pill, the log panel, the export) lives in the raider's details now; the line
// keeps what a council compares down the list: need, wait, loot, BiS, DPS, and
// a few badges for what makes a raider's numbers special.
import type { CouncilRaider, SimResult } from "../../api";
import { Badge, Bar, Button } from "../../components/ui";
import { ChevronRightIcon } from "../../components/icons";
import { SortLabel, ariaSort } from "../../components/SortTh";
import { tParts, useT } from "../../i18n";
import { fmtMs } from "../../lib/format";
import type { TableSort } from "../../lib/tableSort";
import { gearCounts, raiderHref, waitedTip, type RosterSortKey } from "./council";
import { LootCount, RaiderIdent } from "./ItemBits";
import { NeedBar } from "./NeedBar";

/** A sortable column head of the list, with its meaning in the tooltip. */
function Head({ sortKey, label, tipSub, sort }: {
    sortKey: RosterSortKey;
    label: string;
    tipSub: string;
    sort: TableSort<RosterSortKey>;
}) {
    return (
        <span role="columnheader" aria-sort={ariaSort(sortKey, sort.sort, sort.dir)}>
            <SortLabel sortKey={sortKey} label={label} tip={label} tipSub={tipSub} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} />
        </span>
    );
}

/**
 * The badges that make a raider's numbers special — where the gear comes from
 * when it is not the evaluation, what is wrong with it, whose list they are
 * measured against. At most a handful; the details say the rest.
 */
export function RaiderHints({ raider }: { raider: CouncilRaider }) {
    const t = useT();
    const g = raider.gear;
    const out = [];
    if (!g) {
        out.push(<Badge key="nogear" tip={t("lootcouncil.candidates.noGearTip")} tipSub={t("lootcouncil.list.noGearTipSub")}>{t("lootcouncil.candidates.noGear")}</Badge>);
    } else {
        if (g.source === "armory") {
            out.push(<Badge key="src" tone="accent" icon="inv_shield_06" tip={t("lootcouncil.list.armoryTip")} tipSub={t("lootcouncil.list.armoryTipSub", { date: fmtMs(g.armoryAt, true) })}>Armory</Badge>);
        } else if (g.source === "wcl") {
            out.push(<Badge key="src" tone="accent" icon="inv_scroll_03" tip={t("lootcouncil.list.logTip")} tipSub={t("lootcouncil.list.logTipSub", { title: t("common.quoted", { text: g.reportTitle }), date: fmtMs(g.wclAt, true) })}>Log</Badge>);
        }
        if (g.pvpGear) {
            out.push(<Badge key="pvp" tone="bad" tip={t("lootcouncil.gear.pvpGear")} tipSub={t("lootcouncil.list.pvpTipSub")}>{t("lootcouncil.gear.pvpGear")}</Badge>);
        }
        if (g.roleMismatch) {
            const label = raider.role === "healer" ? t("lootcouncil.gear.dpsGear") : t("lootcouncil.gear.healGear");
            out.push(<Badge key="role" tone="bad" icon="spell_nature_magicimmunity" tip={label} tipSub={t("lootcouncil.list.roleTipSub", { title: t("common.quoted", { text: g.reportTitle }) })}>{label}</Badge>);
        }
        const { noench } = gearCounts(g.items);
        if (noench) {
            out.push(<Badge key="noench" tone="mid" tip={t("lootcouncil.gear.noEnchTip")} tipSub={t("lootcouncil.list.noEnchTipSub", { count: noench })}>{tParts("lootcouncil.gear.noEnchCount", { count: noench })}</Badge>);
        }
        if (g.situational) {
            out.push(<Badge key="sit" tone="mid" tip={t("lootcouncil.list.sitTip")} tipSub={t("lootcouncil.list.sitTipSub", { count: g.situational })}>{tParts("lootcouncil.gear.situationalCount", { count: g.situational })}</Badge>);
        }
    }
    if (raider.bis.borrowedFrom) {
        out.push(<Badge key="list" tip={t("lootcouncil.list.borrowedTip")} tipSub={t("lootcouncil.list.borrowedTipSub", { spec: raider.specLabel, from: raider.bis.borrowedFrom })}>{tParts("lootcouncil.list.borrowed", { from: raider.bis.borrowedFrom })}</Badge>);
    }
    return <span className="lc-hints">{out}</span>;
}

/** The DPS a raider's current gear is worth, once simulated — never a placeholder number. */
function DpsCell({ raider, sim }: { raider: CouncilRaider; sim: SimResult | null }) {
    const t = useT();
    const entry = sim && sim[raider.key];
    if (!raider.simSupported) return <span className="lc-muted" data-tip={t("lootcouncil.sim.noSim")} data-tip-sub={t("lootcouncil.list.dpsNoSimTipSub")}>—</span>;
    if (!raider.gear) return <span className="lc-muted" data-tip={t("lootcouncil.candidates.noGearTip")} data-tip-sub={t("lootcouncil.list.dpsNoGearTipSub")}>—</span>;
    if (!entry) return <span className="lc-muted" data-tip={t("lootcouncil.list.dpsNotSimTip")} data-tip-sub={t("lootcouncil.list.dpsNotSimTipSub")}>—</span>;
    if (entry.baseline === null) return <span className="lc-muted" data-tip={t("lootcouncil.sim.failedTip")} data-tip-sub={entry.error || ""}>{t("common.error")}</span>;
    return <span className="lc-num">{Math.round(entry.baseline)}</span>;
}

/** The BiS share as a bar, with the notes about the list in the tooltip. */
export function BisBar({ raider }: { raider: CouncilRaider }) {
    const t = useT();
    if (!raider.bis.total) {
        return <span className="lc-muted" data-tip={t("lootcouncil.list.noBisTip")} data-tip-sub={t("lootcouncil.dialog.noBisList")}>{t("lootcouncil.word.noList")}</span>;
    }
    const notes = [
        raider.bis.source === "wowhead" ? t("lootcouncil.dialog.wowheadNote") : "",
        raider.bis.borrowedFrom ? t("lootcouncil.list.bisBorrowed", { from: raider.bis.borrowedFrom }) : "",
        !raider.bis.exact && raider.bis.tier ? t("lootcouncil.list.bisOlder", { tier: raider.bis.tier.toUpperCase() }) : "",
    ].filter(Boolean);
    return (
        <span className="lc-bisbar" data-tip={t("lootcouncil.list.bisTip", { owned: raider.bis.owned, total: raider.bis.total })} data-tip-sub={notes.join(" ") || t("lootcouncil.list.bisTipSub")}>
            <Bar value={raider.bis.owned} max={raider.bis.total} label={`${raider.bis.owned}/${raider.bis.total}`} />
        </span>
    );
}

export default function RosterList({ rows, sim, sort, openKey, onOpen }: {
    /** The roster in display order; the rank is the position. */
    rows: CouncilRaider[];
    sim: SimResult | null;
    sort: TableSort<RosterSortKey>;
    /** The raider whose details are open, highlighted in the list. */
    openKey: string;
    onOpen: (character: string) => void;
}) {
    const t = useT();
    return (
        <div className="lc-list" role="table" aria-label={t("lootcouncil.word.raider")}>
            <div className="lc-lrow lc-lhead" role="row">
                <span role="columnheader">#</span>
                <Head sortKey="character" label={t("lootcouncil.word.raider")} tipSub={t("lootcouncil.list.characterTipSub")} sort={sort} />
                <Head sortKey="need" label={t("lootcouncil.word.need")} tipSub={t("lootcouncil.list.needTipSub")} sort={sort} />
                <Head sortKey="last" label={t("lootcouncil.word.days")} tipSub={t("lootcouncil.list.lastTipSub")} sort={sort} />
                <Head sortKey="loot" label={t("lootcouncil.word.items")} tipSub={t("lootcouncil.list.lootTipSub")} sort={sort} />
                <Head sortKey="bis" label="BiS" tipSub={t("lootcouncil.list.bisTipSub")} sort={sort} />
                <Head sortKey="dps" label="DPS" tipSub={t("lootcouncil.list.dpsTipSub")} sort={sort} />
                <span role="columnheader">{t("lootcouncil.list.hints")}</span>
                <span role="columnheader" aria-label={t("lootcouncil.list.action")} />
            </div>
            {rows.map((r, i) => (
                <div key={r.key} className={`lc-lrow${r.key === openKey ? " open" : ""}`} role="row">
                    <span className={`lc-rank${i === 0 ? " top" : ""}`}>{i + 1}</span>
                    <RaiderIdent
                        name={r.character}
                        classColor={r.classColor}
                        specIconUrl={r.specIconUrl}
                        className={r.className}
                        sub={`${r.specLabel}${r.className ? ` · ${r.className}` : ""}${r.specAssumed ? " *" : ""}`}
                        to={raiderHref(r.character)}
                    />
                    <NeedBar subject={{
                        needScore: r.needScore, needParts: r.needParts, daysSinceLoot: r.daysSinceLoot,
                        lootCount: r.lootCount, bisOwned: r.bis.owned, bisTotal: r.bis.total,
                    }}
                    />
                    <span
                        className="lc-num"
                        data-tip={r.lastAwardAt ? t("lootcouncil.waited.lastAward", { date: fmtMs(r.lastAwardAt, false) }) : waitedTip(null)}
                    >
                        {r.lastAwardAt ? r.daysSinceLoot : "∞"}<span className="lc-unit"> {t("lootcouncil.list.dayUnit")}</span>
                    </span>
                    <LootCount items={r.items} total={r.lootCount} other={r.otherCount} />
                    <BisBar raider={r} />
                    <DpsCell raider={r} sim={sim} />
                    <RaiderHints raider={r} />
                    <span className="lc-lrow-act">
                        <Button variant="ghost" size="sm" onClick={() => onOpen(r.character)} aria-label={t("lootcouncil.list.detailsAria", { character: r.character })}>
                            {t("lootcouncil.list.details")} <ChevronRightIcon />
                        </Button>
                    </span>
                </div>
            ))}
        </div>
    );
}
