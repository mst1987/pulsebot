import { Link } from "react-router-dom";
import type { CouncilGap, SimResult } from "../../api";
import type { TableSort } from "../../lib/tableSort";
import { Badge, Expand, WowIcon, buttonClass } from "../../components/ui";
import { dropHref, pickVerdict, type CandidateSortKey, type Verdict } from "./council";
import { BisSpecs, ContentBadge, ItemHead, RaiderIdent } from "./ItemBits";
import { CandidateTable } from "./CandidateTable";

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
export function GapCard({ gap, sim, expanded, onToggle, sortState }: {
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
