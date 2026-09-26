// The loot council's building blocks that both routes draw: a raider's
// identity, the need bar with its reasoning in the tooltip, a worn item with
// its marks, the candidate table of a drop. The page (LootCouncilPage.tsx) and
// the drop check (DropCheckPage.tsx) use these, so a raider looks the same
// wherever the council meets them.
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { BisSpec, CouncilCandidate, CouncilLootItem, SimResult, WornItem } from "../../api";
import { Badge, Bar, Button, Expand, IconButton, Popover, WowIcon } from "../../components/ui";
import { tipPlacement } from "../../lib/popoverPosition";
import { classColorProps } from "../../components/ClassSpec";
import { AlertIcon, EmptySlotIcon, ExternalIcon, RefreshIcon } from "../../components/icons";
import { ReasonBadge } from "../../components/LootBadges";
import { SortTh } from "../../components/SortTh";
import { fmtMs } from "../../lib/format";
import { itemQualityProps } from "../../lib/itemQuality";
import type { TableSort } from "../../lib/tableSort";
import { WOWHEAD, deltaFor, gainFor, gearCounts, raiderHref, simErrorFor, waitedTip, wornWowheadUrl, type CandidateSortKey } from "./council";

/** The shape `CouncilCandidate.gear` and `CouncilRaider.gear` share. */
type CouncilGear = NonNullable<CouncilCandidate["gear"]>;

/**
 * A tooltip with more than a head and a sentence — the need bar's three parts,
 * the last items behind a loot count. Same box as the shared tooltip (`.tip`),
 * drawn by the anchor itself because the shared layer only carries text.
 *
 * Portalled into the open dialog when there is one: a modal <dialog> sits in
 * the browser's top layer, and anything outside it — however high its z-index —
 * stays behind the backdrop.
 */
export function RichTip({ trigger, children, width = 300, label }: {
    trigger: ReactNode;
    children: ReactNode;
    width?: number;
    /** What a screen reader hears on the anchor. */
    label?: string;
}) {
    const anchor = useRef<HTMLSpanElement>(null);
    const [open, setOpen] = useState(false);

    // Fixed coordinates go stale the moment the page scrolls under them: the
    // Popover closes it then (follow="close"); mouse leave and blur close it too.
    return (
        <>
            <span
                ref={anchor}
                className="lc-rtip-anchor"
                tabIndex={0}
                aria-label={label}
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
            >
                {trigger}
            </span>
            {open && (
                <Popover anchor={anchor} place={tipPlacement()} host="dialog" onClose={() => setOpen(false)} dismiss={false} className="tip on lc-rtip" role="tooltip" style={{ width }}>
                    {children}
                </Popover>
            )}
        </>
    );
}

/** Everything the need bar needs, from a roster row or a candidate alike. */
export type NeedSubject = {
    needScore: number;
    needParts: { drought: number; share: number; need: number };
    daysSinceLoot: number | null;
    lootCount: number;
    bisOwned: number;
    bisTotal: number;
};

/**
 * The need score as a bar stacked in the weights the score itself uses
 * (50 / 40 / 10), with the number on it — the bar orders the list, the number
 * lets two raiders be compared out loud. What drives it sits in the tooltip.
 */
export function NeedBar({ subject, width = 150 }: { subject: NeedSubject; width?: number }) {
    const score = Math.round(subject.needScore * 100);
    const p = subject.needParts;
    const parts = [
        { cls: "s1", icon: "inv_misc_pocketwatch_02", w: p.drought * 50, max: 50,
            text: subject.daysSinceLoot === null ? "Wartezeit · noch nie etwas" : `Wartezeit · ${subject.daysSinceLoot} Tage` },
        { cls: "s2", icon: "inv_misc_bag_10", w: p.share * 40, max: 40,
            text: `Loot-Anteil · ${subject.lootCount} ${subject.lootCount === 1 ? "Item" : "Items"}` },
        { cls: "s3", icon: "inv_misc_gem_variety_02", w: p.need * 10, max: 10,
            text: subject.bisTotal ? `BiS-Lücke · ${subject.bisOwned}/${subject.bisTotal}` : "BiS-Lücke · keine Liste" },
    ];
    return (
        <RichTip
            label={`Bedarf ${score} von 100`}
            trigger={
                <span className="lc-needbar" style={{ width }}>
                    {parts.map((s) => <i key={s.cls} className={s.cls} style={{ width: `${s.w}%` }} />)}
                    <b>{score}</b>
                </span>
            }
        >
            <b>Bedarf {score} von 100</b>
            <span className="lc-need-rows">
                {parts.map((s) => (
                    <span key={s.cls} className="lc-need-row">
                        <span className={`lc-need-dot ${s.cls}`} />
                        <WowIcon name={s.icon} size={18} />
                        <span>{s.text}</span>
                        <span className="lc-need-val">{Math.round(s.w)}/{s.max}</span>
                    </span>
                ))}
            </span>
            <i>Gewichtet 50 / 40 / 10: wer lange wartet, zählt am meisten.</i>
        </RichTip>
    );
}

/**
 * A raider as spec icon on a tile in their class colour, name and spec — the
 * same identity in the list, the dialog and the drop check. With `to` the name
 * is a link (into the raider's details).
 */
export function RaiderIdent({ name, classColor, specIconUrl, className, sub, size = 34, to, big = false }: {
    name: string;
    classColor: string;
    specIconUrl?: string;
    /** The WoW class ("Warlock"), for the class icon when no spec icon is known. */
    className?: string;
    sub?: ReactNode;
    size?: number;
    to?: string;
    big?: boolean;
}) {
    const colored = classColorProps(classColor);
    const nameNode = to
        ? <Link to={to} className={`lc-id-name ${colored.className || ""}`} style={colored.style}>{name}</Link>
        : <span className={`lc-id-name ${colored.className || ""}`} style={colored.style}>{name}</span>;
    return (
        <span className={`lc-id${big ? " big" : ""}`}>
            <span className="lc-id-tile" style={{ "--cc": classColor || "var(--muted)", width: size, height: size } as CSSProperties}>
                {specIconUrl
                    ? <img src={specIconUrl} alt="" loading="lazy" style={{ width: Math.round(size * 0.7), height: Math.round(size * 0.7) }} />
                    : className ? <WowIcon name={`classicon_${className.toLowerCase().replace(/\s+/g, "")}`} size={Math.round(size * 0.7)} /> : null}
            </span>
            <span className="lc-id-text">
                {nameNode}
                {sub ? <span className="lc-id-sub">{sub}</span> : null}
            </span>
        </span>
    );
}

/**
 * Which raid a drop comes from, as a badge in that raid's own colour — the same
 * hue (`lc-h-<id>` in index.css) the content filter's buttons carry, so a raid
 * has one colour whether you switch it on or read it off a row.
 */
export function ContentBadge({ contentId, tier, label }: { contentId: string; tier?: string; label?: string }) {
    if (!contentId) return null;
    return (
        <span
            className={`lc-cbadge lc-h-${contentId}`}
            data-tip={[label || contentId.toUpperCase(), tier ? tier.toUpperCase() : ""].filter(Boolean).join(" · ")}
        >
            {contentId.toUpperCase()}
        </span>
    );
}

/** An item as icon + quality-coloured name, linked to Wowhead. */
export function ItemLink({ id, name, iconUrl, quality }: { id: number; name: string; iconUrl?: string; quality?: number | null }) {
    return (
        <a className="lc-item" href={WOWHEAD(id)} target="_blank" rel="noreferrer">
            {iconUrl ? <img src={iconUrl} alt="" loading="lazy" /> : null}
            <span {...itemQualityProps(quality ?? null)}>{name || `Item ${id}`}</span>
        </a>
    );
}

/**
 * An item as the head of a card: big icon in its quality colour, the name
 * linked to Wowhead, and under the name where it comes from.
 */
export function ItemHead({ id, name, iconUrl, quality, meta }: {
    id: number;
    name: string;
    iconUrl?: string;
    quality?: number | null;
    meta: ReactNode;
}) {
    return (
        <span className="lc-itemhead">
            {iconUrl
                ? <img src={iconUrl} alt="" loading="lazy" {...itemQualityProps(quality ?? null, "lc-itemhead-icon")} />
                : <span className="lc-itemhead-icon lc-worn-blank" />}
            <span className="lc-itemhead-text">
                <a href={WOWHEAD(id)} target="_blank" rel="noreferrer" {...itemQualityProps(quality ?? null, "lc-itemhead-name")}>
                    {name || `Item ${id}`}
                </a>
                <span className="lc-gap-meta">{meta}</span>
            </span>
        </span>
    );
}

/**
 * For which specs an item is BiS — the question "BiS" alone never answers.
 * One badge per list; a spec that borrows another's list (Fire/Frost from
 * Arcane) is folded into it as "+2" and named in the tooltip, otherwise a
 * contested item would show nine badges carrying five claims.
 */
export function BisSpecs({ specs }: { specs: BisSpec[] }) {
    if (!specs.length) return null;
    return (
        <span className="lc-bisspecs">
            {specs.map((s) => {
                const colored = classColorProps(s.classColor);
                return (
                    <Badge
                        key={s.specKey}
                        icon={s.iconUrl ? <img className="wi" src={s.iconUrl} alt="" loading="lazy" /> : undefined}
                        tip={`BiS für ${s.label}`}
                        tipSub={s.alsoFor.length
                            ? `Dieselbe Liste gilt auch für ${s.alsoFor.join(" und ")} — WoWSims führt für die keine eigene.`
                            : undefined}
                    >
                        <span className={colored.className} style={colored.style}>{s.label}</span>
                        {s.alsoFor.length ? <span className="lc-muted">+{s.alsoFor.length}</span> : null}
                    </Badge>
                );
            })}
        </span>
    );
}

// How many awards the loot tooltip shows. A peek, not the full history — the
// raider's details carry the complete list.
const TIP_ITEMS = 6;

/**
 * A loot count, with the newest items behind it in the tooltip. `total` is the
 * real count; off-spec rolls, shards and bank items are named, never counted.
 */
export function LootCount({ items, total, other = 0 }: { items: CouncilLootItem[]; total: number; other?: number }) {
    if (!total) {
        return other
            ? <span className="lc-num lc-muted" data-tip="Kein erhaltener Loot" data-tip-sub={`${other} Item(s) für Offspec, Entzaubern oder die Bank — zählen nicht als erhaltener Loot.`}>—</span>
            : <span className="lc-num lc-muted">—</span>;
    }
    const shown = items.slice(0, TIP_ITEMS);
    return (
        <RichTip width={440} label={`${total} Items`} trigger={<span className="lc-num">{total}</span>}>
            <b>Zuletzt bekommen</b>
            <span className="lc-loot-list">
                {shown.map((item, i) => (
                    <span key={`${item.itemId}-${item.awardedAt}-${i}`} className="lc-loot-row">
                        <ItemLink id={item.itemId} name={item.itemName} iconUrl={item.itemIconUrl} quality={item.itemQuality} />
                        <ContentBadge contentId={item.contentId} tier={item.tier} />
                        {item.reasonLabel ? <ReasonBadge label={item.reasonLabel} tone={item.reasonTone} /> : <span />}
                        <span className="lc-loot-date">{item.awardedAt ? fmtMs(item.awardedAt, false) : ""}</span>
                    </span>
                ))}
            </span>
            {total > shown.length ? <i>… und {total - shown.length} weitere — die volle Liste steht in den Details.</i> : null}
            {other ? <i>Dazu {other} × Offspec, Entzaubern oder Bank — zählt nicht als erhaltener Loot.</i> : null}
        </RichTip>
    );
}

/**
 * One worn piece as its icon, with Wowhead's own tooltip behind it (the link
 * carries gems and enchant). The marks a council wants without hovering keep a
 * corner each — BiS bottom right, no enchant top left, empty socket top right,
 * the comparison marks bottom left — and explain themselves in the tooltip box.
 */
export function WornIcon({ item }: { item: WornItem }) {
    const noench = item.enchantStatus === "missing";
    const marks = [
        item.isBis ? "lc-worn-bis" : "",
        noench ? "lc-worn-noench" : "",
        item.situational ? "lc-worn-sit" : "",
    ].filter(Boolean).join(" ");
    return (
        <a
            className={`lc-worn ${marks}`}
            href={wornWowheadUrl(item)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${item.itemName} (${item.slotName})`}
        >
            {item.iconUrl
                ? <img src={item.iconUrl} alt="" loading="lazy" {...itemQualityProps(item.quality, "lc-worn-img")} />
                : <span className="lc-worn-img lc-worn-blank" />}
            {item.isBis ? <span className="lc-worn-tag lc-worn-tag-bis" data-tip="BiS" data-tip-sub={`${item.itemName} steht auf der BiS-Liste dieses Raiders.`}>BiS</span> : null}
            {noench ? <span className="lc-worn-tag lc-worn-tag-noench" data-tip="Keine Verzauberung" data-tip-sub={`${item.itemName} trägt keine Verzauberung. Die Simulation rechnet das Teil so, wie es ist.`}>!</span> : null}
            {item.emptySockets > 0
                ? <span className="lc-worn-tag lc-worn-tag-socket" data-tip={`${item.emptySockets} leere${item.emptySockets === 1 ? "r" : ""} Sockel`} data-tip-sub="Die Simulation rechnet den Sockel leer." />
                : null}
            {item.situational ? (
                <span className="lc-worn-mark lc-worn-mark-sit" data-tip="Zählt im Vergleich nicht" data-tip-sub={`${item.situational.note}.`}>!</span>
            ) : null}
            {item.replacedSituational ? (
                <span
                    className="lc-worn-mark lc-worn-mark-sub"
                    data-tip={`Steht hier statt „${item.replacedSituational.itemName}“`}
                    data-tip-sub={`Das ${item.replacedSituational.note}. Gezeigt wird, was ${item.replacedSituational.sameRaid
                        ? `im selben Raid${item.replacedSituational.fight ? ` bei ${item.replacedSituational.fight}` : ""} auf dem Slot steckte`
                        : `${item.replacedSituational.reportTitle ? `„${item.replacedSituational.reportTitle}“` : "eine ältere Auswertung"} auf dem Slot zeigt`}.`}
                >
                    ↺
                </span>
            ) : null}
        </a>
    );
}

/**
 * What the raider has in every slot this item could go in — both rings, both
 * trinkets, both hands for a two-hander — with the piece that would go marked.
 */
export function SlotOptions({ candidate }: { candidate: CouncilCandidate }) {
    const options = candidate.slotOptions.length
        ? candidate.slotOptions
        : [{ slot: candidate.slot, slotName: candidate.slotName, chosen: true, item: candidate.replaces }];
    return (
        <span className="lc-slots">
            {options.map((opt) => (
                <span
                    key={opt.slot}
                    className={`lc-slot${opt.chosen ? " lc-slot-chosen" : ""}`}
                    data-tip={opt.slotName}
                    data-tip-sub={opt.chosen ? "Wird belegt." : "Bleibt, wie es ist."}
                >
                    {opt.item
                        ? <WornIcon item={opt.item} />
                        : <span className="lc-freeslot"><EmptySlotIcon /></span>}
                </span>
            ))}
            {candidate.twoHanded ? (
                <Badge count tip="Zweihandwaffe" tipSub="Belegt Waffenhand und Nebenhand, beide Teile fallen weg.">2H</Badge>
            ) : null}
        </span>
    );
}

/**
 * What the set is and what is wrong with it, as badges: the source with its
 * date, the hit cap, BiS pieces, missing enchants and sockets, and every reason
 * the set on screen is not simply the raider's normal kit. Shared by the raider
 * dialog and the drop check's gear panel — both show the same `gear` shape.
 */
export function GearBadges({ gear: g, bisOwned, bisTotal, character, roleLabel }: {
    gear: CouncilGear | null;
    bisOwned: number;
    bisTotal: number;
    /** For the "Log abgelehnt"/"Set der anderen Rolle"-Badges' tooltip. */
    character: string;
    /** "DPS-Gear"/"Heilgear" for a role mismatch — omitted where the role is not known here. */
    roleLabel?: string;
}) {
    if (!g) return null;
    const { noench, sockets } = gearCounts(g.items);
    const out: ReactNode[] = [];
    if (g.source === "armory") {
        out.push(<Badge key="src" tone="accent" icon="inv_shield_06" tip="Aus der Armory" tipSub={`Aktuelles Gear, geholt ${fmtMs(g.armoryAt, true)}.${g.unverifiedEnchants ? ` ${g.unverifiedEnchants} Teil(e) sind seit der letzten Auswertung dazugekommen — für die ist keine Verzauberung bekannt, die Simulation rechnet sie unverzaubert.` : ""}`}>Armory · {fmtMs(g.armoryAt, true)}</Badge>);
    } else if (g.source === "wcl") {
        out.push(<Badge key="src" tone="accent" icon="inv_scroll_03" tip={`Aus dem Log „${g.reportTitle}“`} tipSub={`Geladen ${fmtMs(g.wclAt, true)}. Gilt, bis eine neuere Auswertung kommt oder „Auswertung“ gewählt wird.`}>Log · {fmtMs(g.seenAt, false)}</Badge>);
    } else {
        out.push(<Badge key="src" icon="inv_misc_pocketwatch_01" tip={`Aus der Auswertung „${g.reportTitle}“`} tipSub={g.skippedReports ? `${g.skippedReports} neuere Auswertung(en) übersprungen, weil dort geheilt oder PvP-Gear getragen wurde.` : "Das Set der letzten Auswertung, in der dieser Raider in seiner Rolle stand."}>Auswertung · {fmtMs(g.seenAt, false)}</Badge>);
    }
    if (g.hitCap > 0) {
        out.push(<Badge key="hit" tone={g.spellHit >= g.hitCap ? "ok" : "mid"} tip="Zaubertrefferwertung" tipSub="Getragen / Obergrenze gegen Bosse. Über der Grenze zählt Hit im Vergleich nicht mehr.">Hit {g.spellHit}/{g.hitCap}</Badge>);
    }
    if (bisTotal) out.push(<Badge key="bis" tone="ok" tip="BiS-Teile" tipSub="Getragene Teile der BiS-Liste dieses Raiders.">BiS {bisOwned}/{bisTotal}</Badge>);
    if (noench) out.push(<Badge key="noench" tone="bad" tip="Ohne Verzauberung" tipSub="Teile ohne Verzauberung — am Icon mit ! markiert.">{noench} ohne VZ</Badge>);
    if (sockets) out.push(<Badge key="sock" tone="mid" tip="Leere Sockel" tipSub="Am Icon oben rechts markiert.">{sockets} Sockel leer</Badge>);
    if (g.unverifiedEnchants) out.push(<Badge key="unv" tone="mid" tip="Verzauberung unbekannt" tipSub="Seit der letzten Auswertung dazugekommen: Blizzards Verzauberungs-IDs sind nicht die, die WoWSims erwartet, die Simulation rechnet sie unverzaubert.">{g.unverifiedEnchants} ohne VZ-Info</Badge>);
    if (g.pvpGear) out.push(<Badge key="pvp" tone="bad" tip="PvP-Gear" tipSub="Jede der letzten Auswertungen zeigt diesen Raider in PvP-Gear. Ein anderes Set ist nicht bekannt, die Werte sind mit Vorsicht zu lesen.">PvP-Gear</Badge>);
    if (g.roleMismatch) out.push(<Badge key="role" tone="bad" icon="spell_nature_magicimmunity" tip="Andere Rolle" tipSub={`Aus „${g.reportTitle}“ — dort wurde die andere Rolle gespielt. Ein Set der eingeplanten Rolle ist nicht geloggt.`}>{roleLabel || "andere Rolle"}</Badge>);
    if (g.logRejected) out.push(<Badge key="logrej" tone={g.logRejected === "pvp" ? "bad" : "mid"} tip={g.logRejected === "pvp" ? "Log: PvP-Gear" : "Log: andere Rolle"} tipSub="Das geladene Log wurde nicht übernommen — bewertet wird weiter das Set aus der Auswertung.">Log abgelehnt</Badge>);
    if (g.armoryRejected) out.push(<Badge key="armrej" tone={g.armoryRejected === "pvp" ? "bad" : "mid"} tip={g.armoryRejected === "pvp" ? "Armory: PvP-Gear" : "Armory: andere Rolle"} tipSub="Die Armory-Antwort wurde nicht übernommen — gegen einen Boss zählt sie nicht, bewertet wird weiter das Set aus dem letzten Raid.">Armory abgelehnt</Badge>);
    if (g.situational) out.push(<Badge key="sit" tone="mid" tip="Situativ" tipSub={`${g.situational} Slot(s) tragen ein bossabhängiges Teil, und keine ältere Auswertung zeigt dort etwas anderes. Der Vergleich liest den Slot als leer.`}>{g.situational} situativ</Badge>);
    if (g.substituted) out.push(<Badge key="sub" tip="Ersetzt" tipSub={`${g.substituted} Slot(s) tragen heute ein Teil, das nur gegen bestimmte Bosse zählt — verglichen wird mit dem, was dort sonst steckt (Icon mit ↺).`}>{g.substituted}× ersetzt</Badge>);
    for (const d of g.dropped) {
        out.push(<Badge key={`drop-${d.slot}`} tone="mid" tip={`${d.slotName} leer`} tipSub={`„${d.itemName}“ ${d.note}. Der Slot zählt als leer, weil keine andere Quelle sagt, was ${character} dort sonst trägt.`}>{d.slotName} leer</Badge>);
    }
    return <>{out}</>;
}

/**
 * A raider's gear, folded out under their candidate row: the source badges,
 * every worn piece, a PvP-gear callout when that is why nothing can be
 * simulated, and the two quick reloads (a full picker lives in the raider's
 * own dialog, linked at the bottom). No estimates here either — this is the
 * same `gear` the simulation itself reads, just shown rather than run.
 */
export function CandidateGearPanel({ candidate, busy, onLoadLog, onLoadArmory }: {
    candidate: CouncilCandidate;
    /** A log/armory reload is running for this candidate right now. */
    busy: boolean;
    onLoadLog?: (character: string) => void;
    onLoadArmory?: (character: string) => void;
}) {
    const g = candidate.gear;
    return (
        <div className="lc-gearpanel">
            {g && g.pvpGear ? (
                <div className="lc-pvphint">
                    <AlertIcon />
                    <span><b>PvP-Gear — kein Boss-Set bekannt.</b> Jede der letzten Auswertungen zeigt {candidate.character} im Arena-Set; Resilienz zählt gegen einen Boss nichts. Gear aus der Armory oder einem Log laden, um zu simulieren.</span>
                </div>
            ) : null}
            <div className="lc-hints">
                <GearBadges gear={g} bisOwned={candidate.bisOwned} bisTotal={candidate.bisTotal} character={candidate.character} />
            </div>
            {g && g.items.length ? (
                <div className="lc-gearstrip">
                    {g.items.map((item) => <WornIcon key={`${item.slot}-${item.itemId}`} item={item} />)}
                </div>
            ) : (
                <div className="lc-muted">Kein Gear bekannt — in keiner Auswertung gesehen.</div>
            )}
            <div className="lc-gearpanel-act">
                {onLoadLog ? <Button variant="ghost" size="sm" icon="inv_scroll_03" running={busy} onClick={() => onLoadLog(candidate.character)}>Log laden</Button> : null}
                {onLoadArmory ? (
                    <Button variant={g && g.pvpGear ? "primary" : "ghost"} size="sm" icon="inv_shield_06" running={busy} onClick={() => onLoadArmory(candidate.character)}>
                        {g && g.pvpGear ? "Gear jetzt aus Armory holen" : "Gear aus Armory holen"}
                    </Button>
                ) : null}
                <Link className="lc-extlink" to={raiderHref(candidate.character)}>Vollständige Details<ExternalIcon /></Link>
            </div>
        </div>
    );
}

/**
 * What an item would do for one raider — measured, or nothing. A bar relative
 * to the best candidate; a raider the item is not BiS for counts half and the
 * bar is hatched. Until the drop is simulated the cell says "nicht simuliert" —
 * a real, failed attempt says "Fehler" instead, with the reason in the tooltip
 * and (when `onRetry` is wired) a button that simulates just this candidate.
 */
export function GainCell({ candidate, simDelta, simError, gainMax, onRetry, retrying }: {
    candidate: CouncilCandidate;
    simDelta: number | null | undefined;
    simError?: string;
    gainMax: number;
    onRetry?: () => void;
    retrying?: boolean;
}) {
    if (typeof simDelta !== "number") {
        if (!candidate.simSupported) {
            return <span className="lc-muted" data-tip="Keine Simulation" data-tip-sub="Für diese Spec gibt es keine Simulation — WoWSims-TBC rechnet nur Caster-DPS.">—</span>;
        }
        if (!candidate.hasGear) {
            return <span className="lc-muted" data-tip="Kein Gear bekannt" data-tip-sub="Der Raider taucht in keiner der letzten Auswertungen auf.">kein Gear</span>;
        }
        return (
            <span className="lc-gain-pending">
                <span
                    className={simError ? "lc-muted lc-gain-err" : "lc-muted"}
                    data-tip={simError ? "Simulation fehlgeschlagen" : "Noch nicht simuliert"}
                    data-tip-sub={simError || "Wird bei „Erneut simulieren“ automatisch mit einbezogen — oder einzeln über den Knopf rechts."}
                >
                    {simError ? "Fehler" : "nicht simuliert"}
                </span>
                {onRetry ? (
                    <IconButton
                        icon={<RefreshIcon />}
                        tip={simError ? "Erneut simulieren" : "Simulieren"}
                        tipSub={`Nur ${candidate.character} für dieses Item.`}
                        size="sm"
                        tone={simError ? "danger" : undefined}
                        disabled={retrying}
                        onClick={onRetry}
                    />
                ) : null}
            </span>
        );
    }
    const gain = simDelta;
    const half = candidate.bisWeight < 1;
    return (
        <span className={`lc-gain lc-gain-measured${half ? " half" : ""}`}>
            <Bar
                value={Math.max(0, gain)}
                max={gainMax}
                tone={gain < 0 ? "bad" : half ? "mid" : "ok"}
                label={`${gain > 0 ? "+" : ""}${Math.round(gain)} DPS`}
            />
            {candidate.inflatedBy.length ? (
                <Badge
                    tone="mid"
                    tip="Nicht vergleichbar"
                    tipSub={`${candidate.inflatedBy.map((b) => `„${b.itemName}“ ${b.note}`).join("; ")}. Der Zugewinn fällt dadurch höher aus als bei Raidern mit einem normalen Teil auf dem Slot.`}
                >
                    !
                </Badge>
            ) : null}
        </span>
    );
}

/** The candidate's list badge: BiS, or "kein BiS · ½". */
export function ListBadge({ candidate }: { candidate: CouncilCandidate }) {
    return candidate.isBis
        ? <Badge tone="ok" tip="BiS" tipSub="Steht auf der BiS-Liste dieses Raiders.">BiS</Badge>
        : <Badge tone="mid" tip="Kein BiS" tipSub={`Nicht auf der BiS-Liste dieses Raiders — Zugewinn und Bedarf zählen mit ${Math.round(candidate.bisWeight * 100)} %.`}>kein BiS · ½</Badge>;
}

/**
 * One row of "who should get this": two bars side by side on purpose — what the
 * item would *do* (simulated, nothing until then) and what the raider has
 * *coming to them*. Multiplying them into one number would hide the judgement a
 * council is there to make.
 *
 * `expandable` adds a fold-out chevron that opens `CandidateGearPanel` in a
 * row of its own beneath — optional, so the BiS-gap table (which wires none of
 * the reload/retry callbacks) keeps its plain look.
 */
export function CandidateRow({
    candidate, simDelta, simError, gainMax, expandable, open, onToggleOpen, onRetry, retrying, gearBusy, onLoadLog, onLoadArmory,
}: {
    candidate: CouncilCandidate;
    simDelta: number | null | undefined;
    simError?: string;
    gainMax: number;
    expandable?: boolean;
    open?: boolean;
    onToggleOpen?: () => void;
    onRetry?: () => void;
    retrying?: boolean;
    gearBusy?: boolean;
    onLoadLog?: (character: string) => void;
    onLoadArmory?: (character: string) => void;
}) {
    return (
        <>
            <tr className={open ? "lc-crow-open" : undefined}>
                {expandable ? (
                    <td className="lc-crow-exp">
                        <Expand open={!!open} onToggle={onToggleOpen || (() => {})} showLabel={false} label={`Gear von ${candidate.character}`} />
                    </td>
                ) : null}
                <td>
                    <RaiderIdent
                        name={candidate.character}
                        classColor={candidate.classColor}
                        specIconUrl={candidate.specIconUrl}
                        sub={candidate.specLabel}
                        size={30}
                        to={raiderHref(candidate.character)}
                    />
                </td>
                <td><ListBadge candidate={candidate} /></td>
                <td><SlotOptions candidate={candidate} /></td>
                <td><GainCell candidate={candidate} simDelta={simDelta} simError={simError} gainMax={gainMax} onRetry={onRetry} retrying={retrying} /></td>
                <td><NeedBar subject={candidate} width={140} /></td>
                <td><span className="lc-num" data-tip={waitedTip(candidate.daysSinceLoot)}>{candidate.daysSinceLoot === null ? "∞" : candidate.daysSinceLoot}</span></td>
                <td><LootCount items={candidate.recentItems} total={candidate.lootCount} other={candidate.otherCount} /></td>
            </tr>
            {expandable && open ? (
                <tr className="lc-crow-panel">
                    <td colSpan={7}>
                        <CandidateGearPanel candidate={candidate} busy={!!gearBusy} onLoadLog={onLoadLog} onLoadArmory={onLoadArmory} />
                    </td>
                </tr>
            ) : null}
        </>
    );
}

/**
 * The "who should get this" table — shared by the BiS cards and the drop
 * check. The drop check wires `expandable` plus the reload/retry callbacks;
 * without them the table looks exactly as it did before.
 */
export function CandidateTable({
    itemId, candidates, sim, sortState, expandable, retrying, gearBusyChar, onRetry, onLoadLog, onLoadArmory,
}: {
    itemId: number;
    candidates: CouncilCandidate[];
    sim: SimResult | null;
    sortState: TableSort<CandidateSortKey>;
    expandable?: boolean;
    /** A simulation is running — every retry button shows busy while it does. */
    retrying?: boolean;
    /** The character a log/armory reload is currently running for, if any. */
    gearBusyChar?: string | null;
    onRetry?: (candidate: CouncilCandidate) => void;
    onLoadLog?: (character: string) => void;
    onLoadArmory?: (character: string) => void;
}) {
    const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
    const rows = sortState.apply(candidates, (c, key) => {
        switch (key) {
            case "character": return c.character.toLowerCase();
            case "bis": return c.bisWeight;
            case "slot": return c.replaces ? c.replaces.itemLevel : -1;
            case "gain": return gainFor(sim, c, itemId) * c.bisWeight;
            case "need": return c.itemNeedScore;
            // Never having won anything is the longest wait there is.
            case "waited": return c.daysSinceLoot === null ? Number.MAX_SAFE_INTEGER : c.daysSinceLoot;
            case "loot": return c.lootCount;
            default: return 0;
        }
    });
    // The bars are relative to the strongest measured candidate.
    const gainMax = Math.max(0, ...candidates.map((c) => {
        const delta = deltaFor(sim, c, itemId);
        return typeof delta === "number" ? delta : 0;
    }));
    const toggle = (key: string) => setOpenKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });
    return (
        <div className="lc-tablewrap">
            <table className="idx lc-candidates">
                <thead>
                    <tr>
                        {expandable ? <th aria-hidden="true" /> : null}
                        <SortTh sortKey="character" label="Raider" {...sortState} />
                        <SortTh sortKey="bis" label="Liste" tip="BiS-Liste" tipSub="Steht das Item auf der Liste des Raiders? Wenn nicht, zählen Zugewinn und Bedarf halb." {...sortState} />
                        <SortTh sortKey="slot" label="Ersetzt" tip="Ersetzt" tipSub="Was dafür abgelegt würde — alle Slots, in die es passt; sortiert nach Itemlevel, ein freier Slot zuerst." {...sortState} />
                        <SortTh sortKey="gain" label="Zugewinn" tip="Zugewinn" tipSub="Simulierte DPS-Differenz aus WoWSims, gleicher Seed für alle. Ist das Item nicht BiS, zählt der Zugewinn halb (schraffiert). Geschätzt wird nichts: ohne Simulation bleibt die Zelle leer." {...sortState} />
                        <SortTh sortKey="need" label="Bedarf" tip="Bedarf" tipSub="Wartezeit, Loot-Anteil und BiS-Lücke, gewichtet 50 / 40 / 10 — halbiert, wenn das Item für den Raider nicht BiS ist." {...sortState} />
                        <SortTh sortKey="waited" label="Tage" tip="Tage" tipSub="Seit dem letzten Item." {...sortState} />
                        <SortTh sortKey="loot" label="Items" tip="Items" tipSub="Im aktuellen Content-Filter." {...sortState} />
                    </tr>
                </thead>
                <tbody>
                    {rows.map((c) => (
                        <CandidateRow
                            key={c.key}
                            candidate={c}
                            simDelta={deltaFor(sim, c, itemId)}
                            simError={simErrorFor(sim, c, itemId)}
                            gainMax={gainMax}
                            expandable={expandable}
                            open={openKeys.has(c.key)}
                            onToggleOpen={() => toggle(c.key)}
                            onRetry={onRetry ? () => onRetry(c) : undefined}
                            retrying={retrying}
                            gearBusy={gearBusyChar === c.character}
                            onLoadLog={onLoadLog}
                            onLoadArmory={onLoadArmory}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** A folded line with a tile, a count and names — "Nicht eingeplant", "Können es nicht tragen". */
export function FoldRow({ icon, title, count, names, open, onToggle, children }: {
    icon: string;
    title: string;
    count: number;
    names: string;
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
}) {
    return (
        <div className="lc-panel lc-fold">
            <div className="lc-fold-head">
                <span className="itile t-none" aria-hidden="true"><WowIcon name={icon} size={22} /></span>
                <b>{title}</b>
                <Badge count>{count}</Badge>
                <span className="lc-fold-names">{names}</span>
                <Expand open={open} onToggle={onToggle} />
            </div>
            {open ? <div className="lc-fold-body">{children}</div> : null}
        </div>
    );
}
