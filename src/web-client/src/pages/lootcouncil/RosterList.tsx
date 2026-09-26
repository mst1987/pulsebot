// "Wer ist dran?" — one compact line per raider. Everything that used to sit in
// the raider's block at once (the gear band with sixteen icons, the source
// pill, the log panel, the export) lives in the raider's details now; the line
// keeps what a council compares down the list: need, wait, loot, BiS, DPS, and
// a few badges for what makes a raider's numbers special.
import type { CouncilRaider, SimResult } from "../../api";
import { Badge, Bar, Button } from "../../components/ui";
import { ChevronRightIcon } from "../../components/icons";
import { SortLabel, ariaSort } from "../../components/SortTh";
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
    const g = raider.gear;
    const out = [];
    if (!g) {
        out.push(<Badge key="nogear" tip="Kein Gear bekannt" tipSub="Der Raider taucht in keiner der letzten Auswertungen auf — in den Details lässt sich ein Log laden oder die Armory holen.">kein Gear</Badge>);
    } else {
        if (g.source === "armory") {
            out.push(<Badge key="src" tone="accent" icon="inv_shield_06" tip="Gear aus der Armory" tipSub={`Der Stand von jetzt, geholt ${fmtMs(g.armoryAt, true)}.`}>Armory</Badge>);
        } else if (g.source === "wcl") {
            out.push(<Badge key="src" tone="accent" icon="inv_scroll_03" tip="Gear aus einem Log" tipSub={`„${g.reportTitle}“, geladen ${fmtMs(g.wclAt, true)}.`}>Log</Badge>);
        }
        if (g.pvpGear) {
            out.push(<Badge key="pvp" tone="bad" tip="PvP-Gear" tipSub="Jede der letzten Auswertungen zeigt diesen Raider in PvP-Gear. Die Werte sind mit Vorsicht zu lesen.">PvP-Gear</Badge>);
        }
        if (g.roleMismatch) {
            const label = raider.role === "healer" ? "DPS-Gear" : "Heilgear";
            out.push(<Badge key="role" tone="bad" icon="spell_nature_magicimmunity" tip={label} tipSub={`Kein Set der eingeplanten Rolle geloggt — bewertet wird „${g.reportTitle}“, dort wurde die andere Rolle gespielt.`}>{label}</Badge>);
        }
        const { noench } = gearCounts(g.items);
        if (noench) {
            out.push(<Badge key="noench" tone="mid" tip="Ohne Verzauberung" tipSub={`${noench} Teil(e) tragen keine Verzauberung.`}>{noench} ohne VZ</Badge>);
        }
        if (g.situational) {
            out.push(<Badge key="sit" tone="mid" tip="Situative Teile" tipSub={`${g.situational} Slot(s) tragen ein bossabhängiges Teil — der Vergleich liest den Slot als leer.`}>{g.situational} situativ</Badge>);
        }
    }
    if (raider.bis.borrowedFrom) {
        out.push(<Badge key="list" tip="Geliehene BiS-Liste" tipSub={`Für ${raider.specLabel} gibt es keine eigene Liste — gemessen wird gegen ${raider.bis.borrowedFrom}.`}>Liste: {raider.bis.borrowedFrom}</Badge>);
    }
    return <span className="lc-hints">{out}</span>;
}

/** The DPS a raider's current gear is worth, once simulated — never a placeholder number. */
function DpsCell({ raider, sim }: { raider: CouncilRaider; sim: SimResult | null }) {
    const entry = sim && sim[raider.key];
    if (!raider.simSupported) return <span className="lc-muted" data-tip="Keine Simulation" data-tip-sub="WoWSims-TBC simuliert diese Spec nicht.">—</span>;
    if (!raider.gear) return <span className="lc-muted" data-tip="Kein Gear bekannt" data-tip-sub="Ohne Gear gibt es nichts zu simulieren.">—</span>;
    if (!entry) return <span className="lc-muted" data-tip="Nicht simuliert" data-tip-sub="„DPS berechnen“ rechnet die ganze Liste.">—</span>;
    if (entry.baseline === null) return <span className="lc-muted" data-tip="Simulation fehlgeschlagen" data-tip-sub={entry.error || ""}>Fehler</span>;
    return <span className="lc-num">{Math.round(entry.baseline)}</span>;
}

/** The BiS share as a bar, with the notes about the list in the tooltip. */
export function BisBar({ raider }: { raider: CouncilRaider }) {
    if (!raider.bis.total) {
        return <span className="lc-muted" data-tip="Keine BiS-Liste" data-tip-sub="Für diese Spec und dieses Tier gibt es keine BiS-Liste.">keine Liste</span>;
    }
    const notes = [
        raider.bis.source === "wowhead" ? "Geschriebene Wowhead-Liste: nennt Items, keine Sockel und keine Verzauberungen." : "",
        raider.bis.borrowedFrom ? `Liste von ${raider.bis.borrowedFrom} (für diese Spec gibt es keine eigene).` : "",
        !raider.bis.exact && raider.bis.tier ? `Neueste verfügbare Liste: ${raider.bis.tier.toUpperCase()}.` : "",
    ].filter(Boolean);
    return (
        <span className="lc-bisbar" data-tip={`BiS ${raider.bis.owned} von ${raider.bis.total}`} data-tip-sub={notes.join(" ") || "Getragene Teile der BiS-Liste."}>
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
    return (
        <div className="lc-list" role="table" aria-label="Raider">
            <div className="lc-lrow lc-lhead" role="row">
                <span role="columnheader">#</span>
                <Head sortKey="character" label="Raider" tipSub="Spec-Icon, Name und Spec." sort={sort} />
                <Head sortKey="need" label="Bedarf" tipSub="Wartezeit, Loot-Anteil und BiS-Lücke, gewichtet 50 / 40 / 10. Wer am längsten nichts bekommen hat, steht oben." sort={sort} />
                <Head sortKey="last" label="Tage" tipSub="Seit dem letzten Item." sort={sort} />
                <Head sortKey="loot" label="Items" tipSub="Im aktuellen Content-Filter — die letzten stehen im Tooltip." sort={sort} />
                <Head sortKey="bis" label="BiS" tipSub="Getragene Teile der BiS-Liste." sort={sort} />
                <Head sortKey="dps" label="DPS" tipSub="Simuliert mit WoWSims — leer, solange nicht gerechnet wurde." sort={sort} />
                <span role="columnheader">Hinweise</span>
                <span role="columnheader" aria-label="Aktion" />
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
                        data-tip={r.lastAwardAt ? `Letztes Item am ${fmtMs(r.lastAwardAt, false)}` : waitedTip(null)}
                    >
                        {r.lastAwardAt ? r.daysSinceLoot : "∞"}<span className="lc-unit"> T</span>
                    </span>
                    <LootCount items={r.items} total={r.lootCount} other={r.otherCount} />
                    <BisBar raider={r} />
                    <DpsCell raider={r} sim={sim} />
                    <RaiderHints raider={r} />
                    <span className="lc-lrow-act">
                        <Button variant="ghost" size="sm" onClick={() => onOpen(r.character)} aria-label={`Details zu ${r.character}`}>
                            Details <ChevronRightIcon />
                        </Button>
                    </span>
                </div>
            ))}
        </div>
    );
}
