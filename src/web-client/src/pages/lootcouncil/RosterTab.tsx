import type { CouncilRaider, LootCouncilData, SimResult } from "../../api";
import { fmtMs } from "../../lib/format";
import type { TableSort } from "../../lib/tableSort";
import { Button, PartHead } from "../../components/ui";
import type { RosterSortKey, useCouncilSim } from "./council";
import { FoldRow } from "./ItemBits";
import RosterList from "./RosterList";

type CouncilSim = ReturnType<typeof useCouncilSim>;

/**
 * The Raider tab — "Wer ist dran?": one compact line per raider, the raiders
 * set aside folded in below. The page keeps the state (sort, busy keys, the
 * fold), so switching tabs loses nothing.
 */
export function RosterTab({ data, roster, sortedRoster, sim, rosterSort, openRaider, openDetails, simRunning, runSim, simulatable, excludedOpen, setExcludedOpen, canWrite, busy, setExcluded }: {
    data: LootCouncilData;
    roster: CouncilRaider[];
    sortedRoster: CouncilRaider[];
    sim: SimResult | null;
    rosterSort: TableSort<RosterSortKey>;
    openRaider: CouncilRaider | null;
    openDetails: (character: string) => void;
    simRunning: boolean;
    runSim: CouncilSim["runSim"];
    simulatable: { key: string; specKey: string }[];
    excludedOpen: boolean;
    setExcludedOpen: (update: (open: boolean) => boolean) => void;
    canWrite: boolean;
    busy: Set<string>;
    setExcluded: (character: string, excluded: boolean) => void;
}) {
    return (
        <>
            <PartHead
                icon="achievement_guildperk_everybodysfriend"
                crumb="Loot-Council › Raider"
                title="Wer ist dran?"
                tip="Wer ist dran?"
                tipSub="Wer am längsten nichts bekommen hat, steht oben. Die Details eines Raiders zeigen Gear, BiS-Lücken und Loot."
                action={data.sim.available ? (
                    <Button
                        variant="run"
                        size="sm"
                        icon="inv_gizmo_02"
                        running={simRunning}
                        disabled={!simulatable.length}
                        onClick={() => runSim([], simulatable)}
                    >
                        DPS berechnen
                    </Button>
                ) : undefined}
            />
            {roster.length ? (
                <RosterList
                    rows={sortedRoster}
                    sim={sim}
                    sort={rosterSort}
                    openKey={openRaider ? openRaider.key : ""}
                    onOpen={openDetails}
                />
            ) : (
                <div className="lc-panel empty">
                    Keine passenden Raider. Der Loot-Council liest Klasse und Spec aus den Loot-Importen und den
                    CLA-Auswertungen — ohne die bleibt die Liste leer.
                </div>
            )}
            {data.excluded.length ? (
                <FoldRow
                    icon="ability_rogue_feigndeath"
                    title="Nicht eingeplant"
                    count={data.excluded.length}
                    names={data.excluded.map((e) => e.character).join(", ")}
                    open={excludedOpen}
                    onToggle={() => setExcludedOpen((v) => !v)}
                >
                    <div className="lc-dlist">
                        {data.excluded.map((e) => (
                            <div key={e.key} className="lc-dlist-row">
                                <b>{e.character}</b>
                                <span className="lc-muted">seit {fmtMs(e.at, false)}{e.by ? ` · ${e.by}` : ""}</span>
                                {canWrite ? (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="lc-dlist-act"
                                        running={busy.has(`exclude:${e.character}`)}
                                        disabled={busy.has(`exclude:${e.character}`)}
                                        onClick={() => setExcluded(e.character, false)}
                                    >
                                        Wieder einplanen
                                    </Button>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </FoldRow>
            ) : null}
        </>
    );
}
