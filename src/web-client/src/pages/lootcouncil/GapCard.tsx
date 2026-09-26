import { Link } from "react-router-dom";
import type { CouncilGap, SimResult } from "../../api";
import type { TableSort } from "../../lib/tableSort";
import { Badge, Expand, WowIcon, buttonClass } from "../../components/ui";
import { useT } from "../../i18n";
import { dropHref, pickVerdict, type CandidateSortKey, type Verdict } from "./council";
import { BisSpecs, ContentBadge, ItemHead, RaiderIdent } from "./ItemBits";
import { CandidateTable } from "./CandidateTable";

/** The badge next to a suggested name: measured DPS, or "höchster Bedarf". */
function VerdictGain({ verdict }: { verdict: Verdict }) {
    const t = useT();
    if (verdict.basis === "sim") {
        return <Badge tone="ok" tip={t("lootcouncil.sim.diffTip")} tipSub={t("lootcouncil.sim.diffTipSub")}>{verdict.delta > 0 ? "+" : ""}{Math.round(verdict.delta)} DPS</Badge>;
    }
    if (verdict.basis === "need") {
        return <Badge tone="accent" tip={t("lootcouncil.sim.highestNeedTip")} tipSub={t("lootcouncil.gaps.needTipSub")}>{t("lootcouncil.sim.highestNeed")}</Badge>;
    }
    return null;
}

/** One open BiS item with everyone it would suit. */
export function GapCard({ gap, sim, expanded, onToggle, sortState }: {
    gap: CouncilGap;
    sim: SimResult | null;
    expanded: boolean;
    onToggle: () => void;
    /** Shared across every card, so all of them stay ordered the same way. */
    sortState: TableSort<CandidateSortKey>;
}) {
    const t = useT();
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
                        {gap.boss ? `${gap.boss} · ` : ""}{t("lootcouncil.gaps.meta", { ilvl: gap.ilvl, count: gap.wantedBy.length })}
                    </>}
                />
                <BisSpecs specs={gap.bisSpecs} />
            </div>
            <div className="lc-gap-verdict">
                <span className="kicker">{t("lootcouncil.gaps.proposal")}</span>
                {best ? (
                    <>
                        <RaiderIdent name={best.character} classColor={best.classColor} specIconUrl={best.specIconUrl} size={28} />
                        <VerdictGain verdict={verdict} />
                    </>
                ) : verdict.basis === "pending" ? (
                    <Badge tip={t("lootcouncil.sim.notSimulatedTip")} tipSub={t("lootcouncil.gaps.pendingTipSub")}>{t("lootcouncil.sim.notSimulated")}</Badge>
                ) : (
                    <Badge tip={t("lootcouncil.gaps.noneTip")} tipSub={t("lootcouncil.gaps.noneTipSub")}>{t("lootcouncil.gaps.none")}</Badge>
                )}
                <span className="lc-grow" />
                <Link className={buttonClass("ghost", "sm", true)} to={dropHref(gap.id)}>
                    <WowIcon name="inv_misc_bag_10" size={18} />{t("lootcouncil.word.checkAsDrop")}
                </Link>
                {gap.candidates.length ? <Expand open={expanded} onToggle={onToggle} label={t("lootcouncil.gaps.candidates", { count: gap.candidates.length })} /> : null}
            </div>
            {expanded && gap.candidates.length
                ? <CandidateTable itemId={gap.id} candidates={gap.candidates} sim={sim} sortState={sortState} />
                : null}
        </article>
    );
}
