import { useState } from "react";
import type { CouncilCandidate, SimResult } from "../../api";
import { Badge, Bar, Expand, IconButton } from "../../components/ui";
import { RefreshIcon } from "../../components/icons";
import { SortTh } from "../../components/SortTh";
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
