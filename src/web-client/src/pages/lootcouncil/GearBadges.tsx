import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CouncilCandidate, WornItem } from "../../api";
import { Badge, Button } from "../../components/ui";
import { AlertIcon, EmptySlotIcon, ExternalIcon } from "../../components/icons";
import { fmtMs } from "../../lib/format";
import { itemQualityProps } from "../../lib/itemQuality";
import { gearCounts, raiderHref, wornWowheadUrl } from "./council";

/** The shape `CouncilCandidate.gear` and `CouncilRaider.gear` share. */
type CouncilGear = NonNullable<CouncilCandidate["gear"]>;

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
