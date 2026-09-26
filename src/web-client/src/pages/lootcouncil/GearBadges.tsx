import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CouncilCandidate, WornItem } from "../../api";
import { Badge, Button } from "../../components/ui";
import { AlertIcon, EmptySlotIcon, ExternalIcon } from "../../components/icons";
import { useT } from "../../i18n";
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
    const t = useT();
    const noench = item.enchantStatus === "missing";
    const marks = [
        item.isBis ? "lc-worn-bis" : "",
        noench ? "lc-worn-noench" : "",
        item.situational ? "lc-worn-sit" : "",
    ].filter(Boolean).join(" ");
    const sub = item.replacedSituational;
    const subSource = sub && !sub.sameRaid
        ? (sub.reportTitle ? t("common.quoted", { text: sub.reportTitle }) : t("lootcouncil.gear.olderEvaluation"))
        : "";
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
            {item.isBis ? <span className="lc-worn-tag lc-worn-tag-bis" data-tip="BiS" data-tip-sub={t("lootcouncil.gear.wornBisTipSub", { item: item.itemName })}>BiS</span> : null}
            {noench ? <span className="lc-worn-tag lc-worn-tag-noench" data-tip={t("lootcouncil.gear.wornNoEnchTip")} data-tip-sub={t("lootcouncil.gear.wornNoEnchTipSub", { item: item.itemName })}>!</span> : null}
            {item.emptySockets > 0
                ? <span className="lc-worn-tag lc-worn-tag-socket" data-tip={t("lootcouncil.gear.emptySockets", { count: item.emptySockets })} data-tip-sub={t("lootcouncil.gear.emptySocketsTipSub")} />
                : null}
            {item.situational ? (
                <span className="lc-worn-mark lc-worn-mark-sit" data-tip={t("lootcouncil.gear.sitMarkTip")} data-tip-sub={`${item.situational.note}.`}>!</span>
            ) : null}
            {sub ? (
                <span
                    className="lc-worn-mark lc-worn-mark-sub"
                    data-tip={t("lootcouncil.gear.replacedTip", { item: sub.itemName })}
                    data-tip-sub={sub.sameRaid
                        ? (sub.fight
                            ? t("lootcouncil.gear.replacedSameRaidFight", { note: sub.note, fight: sub.fight })
                            : t("lootcouncil.gear.replacedSameRaid", { note: sub.note }))
                        : t("lootcouncil.gear.replacedOlder", { note: sub.note, source: subSource })}
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
    const t = useT();
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
                    data-tip-sub={opt.chosen ? t("lootcouncil.gear.slotChosen") : t("lootcouncil.gear.slotStays")}
                >
                    {opt.item
                        ? <WornIcon item={opt.item} />
                        : <span className="lc-freeslot"><EmptySlotIcon /></span>}
                </span>
            ))}
            {candidate.twoHanded ? (
                <Badge count tip={t("lootcouncil.gear.twoHandTip")} tipSub={t("lootcouncil.gear.twoHandTipSub")}>2H</Badge>
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
    const t = useT();
    if (!g) return null;
    const { noench, sockets } = gearCounts(g.items);
    const out: ReactNode[] = [];
    if (g.source === "armory") {
        out.push(<Badge key="src" tone="accent" icon="inv_shield_06" tip={t("lootcouncil.gear.armoryTip")} tipSub={`${t("lootcouncil.gear.armoryTipSub", { date: fmtMs(g.armoryAt, true) })}${g.unverifiedEnchants ? ` ${t("lootcouncil.gear.armoryUnverified", { count: g.unverifiedEnchants })}` : ""}`}>Armory · {fmtMs(g.armoryAt, true)}</Badge>);
    } else if (g.source === "wcl") {
        out.push(<Badge key="src" tone="accent" icon="inv_scroll_03" tip={t("lootcouncil.gear.wclTip", { title: g.reportTitle })} tipSub={t("lootcouncil.gear.wclTipSub", { date: fmtMs(g.wclAt, true) })}>Log · {fmtMs(g.seenAt, false)}</Badge>);
    } else {
        out.push(<Badge key="src" icon="inv_misc_pocketwatch_01" tip={t("lootcouncil.gear.logTip", { title: g.reportTitle })} tipSub={g.skippedReports ? t("lootcouncil.gear.logSkipped", { count: g.skippedReports }) : t("lootcouncil.gear.logDefault")}>{t("lootcouncil.gear.evaluation")} · {fmtMs(g.seenAt, false)}</Badge>);
    }
    if (g.hitCap > 0) {
        out.push(<Badge key="hit" tone={g.spellHit >= g.hitCap ? "ok" : "mid"} tip={t("lootcouncil.gear.hitTip")} tipSub={t("lootcouncil.gear.hitTipSub")}>Hit {g.spellHit}/{g.hitCap}</Badge>);
    }
    if (bisTotal) out.push(<Badge key="bis" tone="ok" tip={t("lootcouncil.gear.bisTip")} tipSub={t("lootcouncil.gear.bisTipSub")}>BiS {bisOwned}/{bisTotal}</Badge>);
    if (noench) out.push(<Badge key="noench" tone="bad" tip={t("lootcouncil.gear.noEnchTip")} tipSub={t("lootcouncil.gear.noEnchTipSub")}>{t("lootcouncil.gear.noEnchCount", { count: noench })}</Badge>);
    if (sockets) out.push(<Badge key="sock" tone="mid" tip={t("lootcouncil.gear.socketsTip")} tipSub={t("lootcouncil.gear.socketsTipSub")}>{t("lootcouncil.gear.socketsCount", { count: sockets })}</Badge>);
    if (g.unverifiedEnchants) out.push(<Badge key="unv" tone="mid" tip={t("lootcouncil.gear.unverifiedTip")} tipSub={t("lootcouncil.gear.unverifiedTipSub")}>{t("lootcouncil.gear.unverifiedCount", { count: g.unverifiedEnchants })}</Badge>);
    if (g.pvpGear) out.push(<Badge key="pvp" tone="bad" tip={t("lootcouncil.gear.pvpGear")} tipSub={t("lootcouncil.gear.pvpTipSub")}>{t("lootcouncil.gear.pvpGear")}</Badge>);
    if (g.roleMismatch) out.push(<Badge key="role" tone="bad" icon="spell_nature_magicimmunity" tip={t("lootcouncil.gear.otherRoleTip")} tipSub={t("lootcouncil.gear.otherRoleTipSub", { title: g.reportTitle })}>{roleLabel || t("lootcouncil.gear.otherRole")}</Badge>);
    if (g.logRejected) out.push(<Badge key="logrej" tone={g.logRejected === "pvp" ? "bad" : "mid"} tip={g.logRejected === "pvp" ? t("lootcouncil.gear.logPvpTip") : t("lootcouncil.gear.logRoleTip")} tipSub={t("lootcouncil.gear.logRejectedTipSub")}>{t("lootcouncil.gear.logRejected")}</Badge>);
    if (g.armoryRejected) out.push(<Badge key="armrej" tone={g.armoryRejected === "pvp" ? "bad" : "mid"} tip={g.armoryRejected === "pvp" ? t("lootcouncil.gear.armoryPvpTip") : t("lootcouncil.gear.armoryRoleTip")} tipSub={t("lootcouncil.gear.armoryRejectedTipSub")}>{t("lootcouncil.gear.armoryRejected")}</Badge>);
    if (g.situational) out.push(<Badge key="sit" tone="mid" tip={t("lootcouncil.gear.sitTip")} tipSub={t("lootcouncil.gear.sitTipSub", { count: g.situational })}>{t("lootcouncil.gear.situationalCount", { count: g.situational })}</Badge>);
    if (g.substituted) out.push(<Badge key="sub" tip={t("lootcouncil.gear.subTip")} tipSub={t("lootcouncil.gear.subTipSub", { count: g.substituted })}>{t("lootcouncil.gear.subCount", { count: g.substituted })}</Badge>);
    for (const d of g.dropped) {
        out.push(<Badge key={`drop-${d.slot}`} tone="mid" tip={t("lootcouncil.gear.slotEmpty", { slot: d.slotName })} tipSub={t("lootcouncil.gear.droppedTipSub", { item: d.itemName, note: d.note, character })}>{t("lootcouncil.gear.slotEmpty", { slot: d.slotName })}</Badge>);
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
    const t = useT();
    const g = candidate.gear;
    return (
        <div className="lc-gearpanel">
            {g && g.pvpGear ? (
                <div className="lc-pvphint">
                    <AlertIcon />
                    <span><b>{t("lootcouncil.gear.pvpHintHead")}</b> {t("lootcouncil.gear.pvpHint", { character: candidate.character })}</span>
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
                <div className="lc-muted">{t("lootcouncil.gear.noGear")}</div>
            )}
            <div className="lc-gearpanel-act">
                {onLoadLog ? <Button variant="ghost" size="sm" icon="inv_scroll_03" running={busy} onClick={() => onLoadLog(candidate.character)}>{t("lootcouncil.gear.loadLog")}</Button> : null}
                {onLoadArmory ? (
                    <Button variant={g && g.pvpGear ? "primary" : "ghost"} size="sm" icon="inv_shield_06" running={busy} onClick={() => onLoadArmory(candidate.character)}>
                        {g && g.pvpGear ? t("lootcouncil.gear.armoryFetchNow") : t("lootcouncil.gear.armoryFetch")}
                    </Button>
                ) : null}
                <Link className="lc-extlink" to={raiderHref(candidate.character)}>{t("lootcouncil.gear.fullDetails")}<ExternalIcon /></Link>
            </div>
        </div>
    );
}
