// The council's entry (Oct 2026, "erstmal Kacheln mit allen Raids, die Loot-Council
// als Lootsystem haben"): one tile per roster whose loot system is Loot-Council and
// per raid category without roster that runs as Loot-Council — nothing else, a raid
// on Softres has no council. A tile opens the council for that pick
// (`/lootcouncil?roster=<id>` / `?category=<id>`, councilHref). The tiles follow the
// roster overview's cards (pages/roster/RostersPage.tsx): name, version, how many
// stand in the roster, the next raid, the Loot-Council profile.
import { Link } from "react-router-dom";
import { getLootCouncilOverview, type CouncilOverviewTile } from "../../api";
import { useApi } from "../../hooks/useApi";
import { useContentVersion } from "../../hooks/useContentVersion";
import { useT } from "../../i18n";
import { fmtMs } from "../../lib/format";
import RaidLoader from "../../components/ui/layout/RaidLoader";
import { IconTile, PageHead, buttonClass } from "../../components/ui";
import { councilHref } from "./model/council";
import "../../styles/loot-council.css";

function Tile({ tile }: { tile: CouncilOverviewTile }) {
    const t = useT();
    const roster = tile.kind === "roster";
    const parts = [tile.versionLabel, roster ? (tile.categoryName || t("lootcouncil.overview.noCategory")) : t("lootcouncil.overview.withoutRoster")];
    return (
        <li>
            <Link className="lc-ov-card" to={councilHref(roster ? { roster: tile.id } : { category: tile.id })}>
                <div className="lc-ov-top">
                    <IconTile icon={roster ? "lootcouncil" : "raids"} tone={roster ? "lootcouncil" : "none"} size="lg" />
                    <div className="lc-ov-title">
                        <b>{tile.name}</b>
                        {/* the version dot and line, as the roster cards draw them */}
                        <span className="lc-ov-ver">
                            <i className={`ver-dot ver-${tile.versionId}`} aria-hidden="true" />
                            {parts.filter(Boolean).join(" · ")}
                        </span>
                    </div>
                </div>
                <div className="lc-ov-nums">
                    <div>
                        <div className="lc-ov-kick">{t("lootcouncil.overview.inRoster")}</div>
                        {tile.members ? (
                            <>
                                <div className="lc-ov-big">{tile.members.roster}<small>{t("lootcouncil.overview.persons", { count: tile.members.roster })}</small></div>
                                {tile.members.bench ? <div className="lc-ov-sub">{t("lootcouncil.overview.bench", { count: tile.members.bench })}</div> : null}
                            </>
                        ) : (
                            <>
                                <div className="lc-ov-big lc-ov-none">–</div>
                                <div className="lc-ov-sub">{t("lootcouncil.overview.noRoster")}</div>
                            </>
                        )}
                    </div>
                    <div className="lc-ov-next">
                        <div className="lc-ov-kick">{t("lootcouncil.overview.nextRaid")}</div>
                        {tile.nextRaid ? (
                            <>
                                <div className="lc-ov-when">{fmtMs(tile.nextRaid.startTime * 1000)}</div>
                                <div className="lc-ov-sub">{tile.nextRaid.title}</div>
                            </>
                        ) : <div className="lc-ov-sub">{t("lootcouncil.overview.noRaid")}</div>}
                    </div>
                </div>
                <div className="lc-ov-foot">
                    <span className="lc-ov-profile" data-tip={t("lootcouncil.overview.profileTip")}>
                        <span className="lc-ov-kick">{t("lootcouncil.head.profile")}</span> {tile.profileName}
                    </span>
                    <span className={buttonClass("ghost", "sm", false, "lc-ov-open")}>{t("lootcouncil.overview.open")}</span>
                </div>
            </Link>
        </li>
    );
}

export default function CouncilOverview() {
    const t = useT();
    // The rosters and categories of the menu's version (#741); a switch loads again.
    const { version } = useContentVersion();
    const state = useApi(() => getLootCouncilOverview(version), [version]);
    if (state.error) return <div className="empty">{state.error.message}</div>;
    const data = state.data;
    if (!data) return <RaidLoader text={t("lootcouncil.overview.loading")} />;
    return (
        <>
            <PageHead
                icon="lootcouncil"
                tone="lootcouncil"
                kicker={t("lootcouncil.overview.kicker", { count: data.tiles.length })}
                title={t("lootcouncil.title")}
            />
            {data.tiles.length ? (
                <ul className="lc-ov-cards" aria-label={t("lootcouncil.overview.cardsAria")}>
                    {data.tiles.map((tile) => <Tile key={`${tile.kind}:${tile.id}`} tile={tile} />)}
                </ul>
            ) : (
                <div className="lc-panel empty lc-ov-empty" role="note">
                    <b>{t("lootcouncil.overview.empty")}</b>
                    <p>{t("lootcouncil.overview.emptyHint")}</p>
                </div>
            )}
        </>
    );
}
