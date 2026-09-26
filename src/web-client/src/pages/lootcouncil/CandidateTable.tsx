import { useState } from "react";
import type { CouncilCandidate, SimResult } from "../../api";
import { Badge, Bar, Expand, IconButton } from "../../components/ui";
import { RefreshIcon } from "../../components/icons";
import { SortTh } from "../../components/SortTh";
import { useT } from "../../i18n";
import type { TableSort } from "../../lib/tableSort";
import { deltaFor, gainFor, raiderHref, simErrorFor, waitedTip, type CandidateSortKey } from "./council";
import { LootCount, RaiderIdent } from "./ItemBits";
import { CandidateGearPanel, SlotOptions } from "./GearBadges";
import { NeedBar } from "./NeedBar";

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
    const t = useT();
    if (typeof simDelta !== "number") {
        if (!candidate.simSupported) {
            return <span className="lc-muted" data-tip={t("lootcouncil.sim.noSim")} data-tip-sub={t("lootcouncil.candidates.noSimTipSub")}>—</span>;
        }
        if (!candidate.hasGear) {
            return <span className="lc-muted" data-tip={t("lootcouncil.candidates.noGearTip")} data-tip-sub={t("lootcouncil.candidates.noGearTipSub")}>{t("lootcouncil.candidates.noGear")}</span>;
        }
        return (
            <span className="lc-gain-pending">
                <span
                    className={simError ? "lc-muted lc-gain-err" : "lc-muted"}
                    data-tip={simError ? t("lootcouncil.sim.failedTip") : t("lootcouncil.sim.notSimulatedTip")}
                    data-tip-sub={simError || t("lootcouncil.candidates.pendingTipSub")}
                >
                    {simError ? t("common.error") : t("lootcouncil.sim.notSimulated")}
                </span>
                {onRetry ? (
                    <IconButton
                        icon={<RefreshIcon />}
                        tip={simError ? t("lootcouncil.sim.rerun") : t("lootcouncil.sim.simulate")}
                        tipSub={t("lootcouncil.candidates.retryOnly", { character: candidate.character })}
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
                    tip={t("lootcouncil.candidates.notComparableTip")}
                    tipSub={t("lootcouncil.candidates.notComparableTipSub", { list: candidate.inflatedBy.map((b) => `${t("common.quoted", { text: b.itemName })} ${b.note}`).join("; ") })}
                >
                    !
                </Badge>
            ) : null}
        </span>
    );
}

/** The candidate's list badge: BiS, or "kein BiS · ½". */
export function ListBadge({ candidate }: { candidate: CouncilCandidate }) {
    const t = useT();
    return candidate.isBis
        ? <Badge tone="ok" tip="BiS" tipSub={t("lootcouncil.candidates.bisTipSub")}>BiS</Badge>
        : <Badge tone="mid" tip={t("lootcouncil.candidates.noBisTip")} tipSub={t("lootcouncil.candidates.noBisTipSub", { pct: Math.round(candidate.bisWeight * 100) })}>{t("lootcouncil.candidates.noBis")}</Badge>;
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
    const t = useT();
    return (
        <>
            <tr className={open ? "lc-crow-open" : undefined}>
                {expandable ? (
                    <td className="lc-crow-exp">
                        <Expand open={!!open} onToggle={onToggleOpen || (() => {})} showLabel={false} label={t("lootcouncil.candidates.gearOf", { character: candidate.character })} />
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
    const t = useT();
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
                        <SortTh sortKey="character" label={t("lootcouncil.word.raider")} {...sortState} />
                        <SortTh sortKey="bis" label={t("lootcouncil.candidates.list")} tip={t("lootcouncil.candidates.listTip")} tipSub={t("lootcouncil.candidates.listTipSub")} {...sortState} />
                        <SortTh sortKey="slot" label={t("lootcouncil.word.replaces")} tip={t("lootcouncil.word.replaces")} tipSub={t("lootcouncil.candidates.replacesTipSub")} {...sortState} />
                        <SortTh sortKey="gain" label={t("lootcouncil.candidates.gain")} tip={t("lootcouncil.candidates.gain")} tipSub={t("lootcouncil.candidates.gainTipSub")} {...sortState} />
                        <SortTh sortKey="need" label={t("lootcouncil.word.need")} tip={t("lootcouncil.word.need")} tipSub={t("lootcouncil.candidates.needTipSub")} {...sortState} />
                        <SortTh sortKey="waited" label={t("lootcouncil.word.days")} tip={t("lootcouncil.word.days")} tipSub={t("lootcouncil.list.lastTipSub")} {...sortState} />
                        <SortTh sortKey="loot" label={t("lootcouncil.word.items")} tip={t("lootcouncil.word.items")} tipSub={t("lootcouncil.candidates.itemsTipSub")} {...sortState} />
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
