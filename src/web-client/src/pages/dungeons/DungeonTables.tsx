// The three tables of "Dungeon-Bestzeiten": the fastest runs of one dungeon,
// the overall medal ranking and the achievement points. Every table sorts by
// every labelled column (components/ui/DataTable + useTableSort).
import type { DungeonCharacter, DungeonPlayer, DungeonRun, DungeonTable } from "../../api";
import DataTable, { type Column } from "../../components/ui/DataTable";
import { useTableSort } from "../../lib/ui/tableSort";
import { formatDate } from "../../lib/format";
import { locale, useT } from "../../i18n";
import { Medal, MemberName } from "./DungeonParts";
import {
    formatSeconds, playerSortValue, pointsSortValue, runSortValue,
    type PlayerSortKey, type PointsSortKey, type RunSortKey,
} from "./dungeonView";

/** A number with its word ("3 Gold"), a quiet dash for 0. */
function Count({ n, word }: { n: number; word: string }) {
    if (!n) return <span className="dg-zero">–</span>;
    return <span className="dg-count"><b>{n.toLocaleString(locale())}</b> {word}</span>;
}

export function RunsTable({ table }: { table: DungeonTable }) {
    const t = useT();
    const sort = useTableSort<RunSortKey>("dungeons-runs-sort", { rank: "asc", time: "asc", medal: "desc", group: "asc", date: "desc" }, "rank");
    const columns: Column<DungeonRun, RunSortKey>[] = [
        { id: "rank", label: t("dungeons.col.rank"), sortKey: "rank", width: 72, cell: (r) => <span className="dg-rank">{t("dungeons.rank", { rank: r.rank })}</span> },
        { id: "time", label: t("dungeons.col.time"), sortKey: "time", width: 110, cell: (r) => <b className="dg-time">{formatSeconds(r.seconds)}</b> },
        { id: "medal", label: t("dungeons.col.medal"), sortKey: "medal", width: 120, cell: (r) => <Medal medal={r.medal} /> },
        {
            id: "group", label: t("dungeons.col.group"), sortKey: "group",
            cell: (r) => <span className="dg-group">{r.members.map((m) => <MemberName key={m.name} member={m} />)}</span>,
        },
        { id: "date", label: t("dungeons.col.date"), sortKey: "date", width: 120, className: "small", cell: (r) => formatDate(r.startedAt) },
    ];
    return (
        <DataTable
            rows={table.runs} columns={columns} rowKey={(r) => r.id} sort={sort} sortValue={runSortValue}
            className="idx dg-table" wrapClassName="dg-scroll"
        />
    );
}

export function OverallTable({ players }: { players: DungeonPlayer[] }) {
    const t = useT();
    const sort = useTableSort<PlayerSortKey>(
        "dungeons-overall-sort",
        { medals: "desc", name: "asc", gold: "desc", silver: "desc", bronze: "desc", goldDungeons: "desc", runs: "desc" },
        "medals",
    );
    const columns: Column<DungeonPlayer, PlayerSortKey>[] = [
        { id: "rank", label: t("dungeons.col.rank"), sortKey: "medals", width: 72, tip: t("dungeons.overall.rankTip"), cell: (p) => <span className="dg-rank">{t("dungeons.rank", { rank: p.rank })}</span> },
        { id: "name", label: t("dungeons.col.player"), sortKey: "name", cell: (p) => <MemberName member={p} icon /> },
        { id: "gold", label: t("dungeons.medal.gold"), sortKey: "gold", width: 110, cell: (p) => <Count n={p.gold} word={t("dungeons.medal.gold")} /> },
        { id: "silver", label: t("dungeons.medal.silver"), sortKey: "silver", width: 110, cell: (p) => <Count n={p.silver} word={t("dungeons.medal.silver")} /> },
        { id: "bronze", label: t("dungeons.medal.bronze"), sortKey: "bronze", width: 110, cell: (p) => <Count n={p.bronze} word={t("dungeons.medal.bronze")} /> },
        {
            id: "goldDungeons", label: t("dungeons.col.goldDungeons"), sortKey: "goldDungeons", width: 170,
            cell: (p) => (p.goldDungeons.length ? (
                <span data-tip={t("dungeons.col.goldDungeons")} data-tip-sub={p.goldDungeons.join("\n")}>
                    {t("dungeons.overall.dungeons", { count: p.goldDungeons.length })}
                </span>
            ) : <span className="dg-zero">–</span>),
        },
        { id: "runs", label: t("dungeons.col.runs"), sortKey: "runs", width: 100, cell: (p) => t("dungeons.overall.runs", { count: p.runs }) },
    ];
    return (
        <DataTable
            rows={players} columns={columns} rowKey={(p) => p.key} sort={sort} sortValue={playerSortValue} pageSize={50}
            className="idx dg-table" wrapClassName="dg-scroll"
        />
    );
}

export function PointsTable({ characters }: { characters: DungeonCharacter[] }) {
    const t = useT();
    const sort = useTableSort<PointsSortKey>(
        "dungeons-points-sort",
        { points: "desc", name: "asc", level: "desc", count: "desc", golds: "desc", read: "desc" },
        "points",
    );
    const columns: Column<DungeonCharacter, PointsSortKey>[] = [
        { id: "rank", label: t("dungeons.col.rank"), sortKey: "points", width: 72, cell: (c) => <span className="dg-rank">{t("dungeons.rank", { rank: c.rank })}</span> },
        { id: "name", label: t("dungeons.col.character"), sortKey: "name", cell: (c) => <MemberName member={c} icon /> },
        { id: "level", label: t("dungeons.col.level"), sortKey: "level", width: 100, cell: (c) => (c.level ? t("dungeons.points.level", { level: c.level }) : "–") },
        { id: "points", label: t("dungeons.col.points"), sortKey: "points", width: 150, cell: (c) => <span className="dg-count"><b>{c.points.toLocaleString(locale())}</b> {t("dungeons.points.pointsWord")}</span> },
        { id: "count", label: t("dungeons.col.achievements"), sortKey: "count", width: 130, cell: (c) => t("dungeons.points.achievements", { count: c.count }) },
        { id: "golds", label: t("dungeons.col.golds"), sortKey: "golds", width: 130, cell: (c) => <Count n={c.golds} word={t("dungeons.medal.gold")} /> },
        { id: "read", label: t("dungeons.col.read"), sortKey: "read", width: 120, className: "small", tip: t("dungeons.points.readTip"), cell: (c) => formatDate(c.readAt) },
    ];
    return (
        <DataTable
            rows={characters} columns={columns} rowKey={(c) => c.key} sort={sort} sortValue={pointsSortValue} pageSize={50}
            className="idx dg-table" wrapClassName="dg-scroll"
        />
    );
}
