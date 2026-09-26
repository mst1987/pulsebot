import type { CouncilGap, LootCouncilData, SimResult } from "../../api";
import type { TableSort } from "../../lib/tableSort";
import { Button, PartHead } from "../../components/ui";
import { tParts, useT } from "../../i18n";
import type { CandidateSortKey, useCouncilSim } from "./council";
import { GapCard } from "./GapCard";

type CouncilSim = ReturnType<typeof useCouncilSim>;

/**
 * The "Offene BiS-Items" tab — "Was fehlt noch?": one card per open BiS item
 * with everyone it would suit. Which cards are open and how the candidates are
 * sorted stays with the page.
 */
export function GapsTab({ data, gaps, sim, simRunning, runSim, simulatable, expanded, setExpanded, candidateSort }: {
    data: LootCouncilData;
    gaps: CouncilGap[];
    sim: SimResult | null;
    simRunning: boolean;
    runSim: CouncilSim["runSim"];
    simulatable: { key: string; specKey: string }[];
    expanded: Set<number>;
    setExpanded: (next: Set<number>) => void;
    candidateSort: TableSort<CandidateSortKey>;
}) {
    const t = useT();
    return (
        <>
            <PartHead
                icon="inv_misc_gem_variety_02"
                crumb={t("lootcouncil.gaps.crumb")}
                title={t("lootcouncil.gaps.title")}
                tip={t("lootcouncil.tabs.gaps")}
                tipSub={t("lootcouncil.gaps.tipSub")}
                action={data.sim.available ? (
                    <Button
                        variant="run"
                        size="sm"
                        icon="inv_gizmo_02"
                        running={simRunning}
                        disabled={!simulatable.length || !gaps.length}
                        data-tip={t("lootcouncil.gaps.runAllTip")}
                        data-tip-sub={t("lootcouncil.gaps.runAllTipSub")}
                        onClick={() => runSim(gaps.map((g) => g.id), simulatable)}
                    >
                        {tParts("lootcouncil.gaps.runAll", { count: gaps.length })}
                    </Button>
                ) : undefined}
            />
            {gaps.length ? gaps.map((gap) => (
                <GapCard
                    key={gap.id}
                    gap={gap}
                    sim={sim}
                    expanded={expanded.has(gap.id)}
                    onToggle={() => {
                        const next = new Set(expanded);
                        if (next.has(gap.id)) next.delete(gap.id);
                        else next.add(gap.id);
                        setExpanded(next);
                    }}
                    sortState={candidateSort}
                />
            )) : (
                <div className="lc-panel empty">
                    {t("lootcouncil.gaps.empty")}
                </div>
            )}
        </>
    );
}
