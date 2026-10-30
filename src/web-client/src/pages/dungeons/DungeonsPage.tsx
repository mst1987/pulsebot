// "Dungeon-Bestzeiten" (/roster/dungeons, a page of the Roster family): the
// group runs and achievement points the WoW addon LevelHelper keeps and the
// sync tool uploads (POST /api/ingest/levelhelper).
//
//   Je Dungeon     a dungeon picked in the filter line, its ten fastest runs
//   Gesamtwertung  the players by medals, the dungeons with gold
//   Erfolgspunkte  the characters by achievement points
//
// Only the content switch's version (#741): the server answers one version
// (GET /api/dungeons?version=), without data the empty page names the
// versions that have some. Readable with "roster" or every member's "signup".
import { useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { getDungeonBoard, type DungeonBoardData } from "../../api";
import type { ShellContext } from "../../components/shell/Shell";
import { Badge, PageHead, RaidLoader, WowIcon } from "../../components/ui";
import { MenuRailPage } from "../../components/ui/layout/SectionRail";
import { useApi } from "../../hooks/useApi";
import { useContentVersion } from "../../hooks/useContentVersion";
import { usePersistedState } from "../../lib/ui/persistedState";
import { formatDateTime } from "../../lib/format";
import { tParts, useT } from "../../i18n";
import { DUNGEON_TABS, isDungeonTab, formatSeconds, type DungeonTab } from "./dungeonView";
import { OverallTable, PointsTable, RunsTable } from "./DungeonTables";
import "../../styles/dungeons.css";

const DUNGEON_ICON = "bestTimes";

/** Nothing stored for this version yet: where the data comes from, and which versions have some. */
function EmptyBoard({ version, others }: { version: string; others: string[] }) {
    const t = useT();
    return (
        <div className="dg-empty empty">
            <WowIcon name={DUNGEON_ICON} size={48} />
            <h2>{version ? t("dungeons.empty.versionTitle", { version }) : t("dungeons.empty.title")}</h2>
            <p>{t("dungeons.empty.text")}</p>
            {others.length > 0 && <p>{t("dungeons.empty.otherVersions", { versions: others.join(", ") })}</p>}
        </div>
    );
}

function Board({ data, versionShort }: { data: DungeonBoardData; versionShort: string }) {
    const t = useT();
    const [storedTab, setTab] = usePersistedState<DungeonTab>("dungeons-tab", "dungeons");
    const tab: DungeonTab = isDungeonTab(storedTab) ? storedTab : "dungeons";
    const [picked, setPicked] = usePersistedState<string>("dungeons-pick", "");
    const table = useMemo(() => data.dungeons.find((d) => d.dungeon === picked) || data.dungeons[0] || null, [data.dungeons, picked]);
    const counts: Record<DungeonTab, number> = { dungeons: data.dungeons.length, overall: data.players.length, points: data.characters.length };

    return (
        <>
            <PageHead
                icon={DUNGEON_ICON}
                tone="roster"
                kicker={data.updatedAt ? t("dungeons.kicker", { version: versionShort, date: formatDateTime(data.updatedAt) }) : versionShort}
                title={t("dungeons.title")}
                meta={(
                    <>
                        <Badge tip={t("dungeons.meta.runsTip")}>{tParts("dungeons.meta.runs", { count: data.totals.runs })}</Badge>
                        <Badge>{tParts("dungeons.meta.dungeons", { count: data.dungeons.length })}</Badge>
                        <Badge>{tParts("dungeons.meta.players", { count: data.players.length })}</Badge>
                    </>
                )}
            />

            <div className="tabs dg-tabs" role="tablist">
                {DUNGEON_TABS.map((id) => (
                    <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab-btn${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>
                        {t(`dungeons.tabs.${id}`)}{" "}<span className="tab-count">{counts[id]}</span>
                    </button>
                ))}
            </div>

            {tab === "dungeons" && (
                table ? (
                    <>
                        <div className="dg-filterline">
                            <label className="kicker" htmlFor="dg-pick">{t("dungeons.pick")}</label>
                            <select id="dg-pick" className="dg-pick" value={table.dungeon} onChange={(e) => setPicked(e.target.value)}>
                                {data.dungeons.map((d) => <option key={d.dungeon} value={d.dungeon}>{d.dungeon}</option>)}
                            </select>
                            <span className="dg-facts">
                                <Badge>{tParts("dungeons.facts.best", { time: formatSeconds(table.bestSeconds) })}</Badge>
                                <Badge>{tParts("dungeons.meta.runs", { count: table.runCount })}</Badge>
                                <Badge>{tParts("dungeons.facts.goldRuns", { count: table.goldRuns })}</Badge>
                            </span>
                        </div>
                        <RunsTable table={table} />
                    </>
                ) : <div className="empty">{t("dungeons.none.dungeons")}</div>
            )}
            {tab === "overall" && (
                data.players.length ? <OverallTable players={data.players} /> : <div className="empty">{t("dungeons.none.dungeons")}</div>
            )}
            {tab === "points" && (
                data.characters.length ? <PointsTable characters={data.characters} /> : <div className="empty">{t("dungeons.none.points")}</div>
            )}
        </>
    );
}

export default function DungeonsPage() {
    const t = useT();
    const { user } = useOutletContext<ShellContext>();
    const { version, mainVersion, versions } = useContentVersion();
    const board = useApi<DungeonBoardData>(() => getDungeonBoard(version), [version]);
    const shown = versions.find((v) => v.id === (board.data?.versionId || version || mainVersion));
    const versionShort = shown?.short || board.data?.versionId || "";

    let body;
    if (board.error && !board.data) body = <div className="empty">{board.error.message}</div>;
    else if (!board.data) body = <RaidLoader text={t("dungeons.loading")} />;
    else if (!board.data.totals.runs && !board.data.totals.characters) {
        body = (
            <>
                <PageHead icon={DUNGEON_ICON} tone="roster" kicker={versionShort} title={t("dungeons.title")} />
                <EmptyBoard version={versionShort} others={board.data.otherVersions} />
            </>
        );
    } else body = <Board data={board.data} versionShort={versionShort} />;

    // the Roster family's rail (MenuRailPage leaves it away for a member who may open only this page)
    return <MenuRailPage user={user} parent="roster"><div className="dg-page">{body}</div></MenuRailPage>;
}
