import type { CouncilGap, LootCouncilData, SimResult } from "../../api";
import type { TableSort } from "../../lib/tableSort";
import { Button, PartHead } from "../../components/ui";
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
    return (
        <>
            <PartHead
                icon="inv_misc_gem_variety_02"
                crumb="Loot-Council › Offene BiS-Items"
                title="Was fehlt noch?"
                tip="Offene BiS-Items"
                tipSub="Items, die auf mindestens einer BiS-Liste stehen und noch niemand aus der gefilterten Gruppe trägt — sortiert danach, wie viele darauf warten. Der Vorschlag ist der größte Zugewinn, nicht der längste Wartende: wer dran ist, entscheidet ihr."
                action={data.sim.available ? (
                    <Button
                        variant="run"
                        size="sm"
                        icon="inv_gizmo_02"
                        running={simRunning}
                        disabled={!simulatable.length || !gaps.length}
                        data-tip="Alle BiS-Items durchrechnen"
                        data-tip-sub="Rechnet jedes offene BiS-Item gegen jeden Raider durch — gründlich, aber minutenlang. Für ein einzelnes Item ist „Drop prüfen“ schneller."
                        onClick={() => runSim(gaps.map((g) => g.id), simulatable)}
                    >
                        Alle BiS-Items durchrechnen ({gaps.length})
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
                    Keine offenen BiS-Items im gewählten Filter — entweder trägt die Gruppe schon alles,
                    oder für ihre Specs gibt es zu diesem Tier keine BiS-Liste.
                </div>
            )}
        </>
    );
}
