import { useState } from "react";
import type { CouncilOutsider, CouncilRaider, LootCouncilData, SimResult } from "../../api";
import { fmtMs } from "../../lib/format";
import type { TableSort } from "../../lib/ui/tableSort";
import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import { waitedTip, type RosterSortKey, type useCouncilSim } from "./council";
import { FoldRow, LootCount, RaiderIdent } from "./ItemBits";
import RosterList from "./RosterList";

type CouncilSim = ReturnType<typeof useCouncilSim>;

/**
 * "Nicht im Roster (n)" (#667): who stood in this category's logs or loot
 * without being in its roster — stand-ins. Folded, one plain line each, no
 * rank and no need bar: they count neither for the ranking nor for the addon.
 */
function OutsiderFold({ outsiders }: { outsiders: CouncilOutsider[] }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    if (!outsiders.length) return null;
    return (
        <FoldRow
            icon="inv_misc_groupneedmore"
            title={t("lootcouncil.roster.outsidersTitle")}
            count={outsiders.length}
            names={outsiders.map((o) => o.character).join(", ")}
            open={open}
            onToggle={() => setOpen((v) => !v)}
        >
            <p className="lc-muted lc-fold-note">{t("lootcouncil.roster.outsidersNote")}</p>
            <div className="lc-dlist">
                {outsiders.map((o) => (
                    <div key={o.key} className="lc-dlist-row">
                        <RaiderIdent
                            name={o.character}
                            classColor={o.classColor}
                            specIconUrl={o.specIconUrl}
                            className={o.className}
                            size={26}
                            sub={o.specLabel}
                        />
                        <span className="lc-dlist-act lc-muted" data-tip={waitedTip(o.daysSinceLoot)}>
                            {t("lootcouncil.list.lastItem")}: {o.lastAwardAt ? t("lootcouncil.list.ago", { count: o.daysSinceLoot ?? 0 }) : t("lootcouncil.word.never")}
                        </span>
                        <span className="lc-outsider-loot">
                            <LootCount items={o.items} total={o.lootCount} other={o.otherCount} /> <small className="lc-muted">{t("lootcouncil.word.items")}</small>
                        </span>
                    </div>
                ))}
            </div>
        </FoldRow>
    );
}

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
    const t = useT();
    return (
        <>
            {/* No card header repeating the tab: just the rule the list is
                ordered by, and the one job this tab starts. */}
            <div className="lc-rosterbar">
                <span className="lc-muted tipped" tabIndex={0} data-tip={t("lootcouncil.roster.title")} data-tip-sub={t("lootcouncil.roster.tipSub")}>
                    {t("lootcouncil.roster.hint")}
                </span>
                {data.sim.available ? (
                    <Button
                        variant="run"
                        size="sm"
                        icon="inv_gizmo_02"
                        running={simRunning}
                        disabled={!simulatable.length}
                        onClick={() => runSim([], simulatable)}
                    >
                        {t("lootcouncil.roster.simulate")}
                    </Button>
                ) : undefined}
            </div>
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
                    {data.filter.roster ? t("lootcouncil.roster.emptyRoster", { name: data.filter.roster.name }) : t("lootcouncil.roster.empty")}
                </div>
            )}
            <OutsiderFold outsiders={data.outsiders || []} />
            {data.excluded.length ? (
                <FoldRow
                    icon="ability_rogue_feigndeath"
                    title={t("lootcouncil.roster.excludedTitle")}
                    count={data.excluded.length}
                    names={data.excluded.map((e) => e.character).join(", ")}
                    open={excludedOpen}
                    onToggle={() => setExcludedOpen((v) => !v)}
                >
                    <div className="lc-dlist">
                        {data.excluded.map((e) => (
                            <div key={e.key} className="lc-dlist-row">
                                <b>{e.character}</b>
                                <span className="lc-muted">{t("lootcouncil.roster.since", { date: fmtMs(e.at, false) })}{e.by ? ` · ${e.by}` : ""}</span>
                                {canWrite ? (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="lc-dlist-act"
                                        running={busy.has(`exclude:${e.character}`)}
                                        disabled={busy.has(`exclude:${e.character}`)}
                                        onClick={() => setExcluded(e.character, false)}
                                    >
                                        {t("lootcouncil.roster.includeAgain")}
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
