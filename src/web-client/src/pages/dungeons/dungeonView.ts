// The pure half of the page "Dungeon-Bestzeiten": the tabs, the time format
// and the sort values of the three tables.
import type { DungeonCharacter, DungeonMedal, DungeonPlayer, DungeonRun } from "../../api";

export const DUNGEON_TABS = ["dungeons", "overall", "points"] as const;
export type DungeonTab = (typeof DUNGEON_TABS)[number];

export function isDungeonTab(value: unknown): value is DungeonTab {
    return typeof value === "string" && (DUNGEON_TABS as readonly string[]).includes(value);
}

/** "31:42", "1:02:05" — the same as the bot writes it (services/dungeons/dungeonBoard.formatSeconds). */
export function formatSeconds(seconds: number): string {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rest = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

const MEDAL_RANK: Record<DungeonMedal, number> = { gold: 3, silver: 2, bronze: 1 };

/** A medal as a number to sort by (gold highest, none 0). */
export function medalRank(medal: DungeonMedal | null): number {
    return medal ? MEDAL_RANK[medal] : 0;
}

export type RunSortKey = "rank" | "time" | "medal" | "group" | "date";
export type PlayerSortKey = "medals" | "name" | "gold" | "silver" | "bronze" | "goldDungeons" | "runs";
export type PointsSortKey = "points" | "name" | "level" | "count" | "golds" | "read";

export function runSortValue(r: DungeonRun, key: RunSortKey): string | number {
    if (key === "time") return r.seconds;
    if (key === "medal") return medalRank(r.medal);
    if (key === "group") return r.members.map((m) => m.name).join(", ").toLowerCase();
    if (key === "date") return r.startedAt;
    return r.rank;
}

/** "medals" is the ranking itself: golds, then silvers, then bronzes. */
export function playerSortValue(p: DungeonPlayer, key: PlayerSortKey): string | number {
    if (key === "name") return p.name.toLowerCase();
    if (key === "gold") return p.gold;
    if (key === "silver") return p.silver;
    if (key === "bronze") return p.bronze;
    if (key === "goldDungeons") return p.goldDungeons.length;
    if (key === "runs") return p.runs;
    return p.gold * 1e8 + p.silver * 1e4 + p.bronze;
}

export function pointsSortValue(c: DungeonCharacter, key: PointsSortKey): string | number {
    if (key === "name") return c.name.toLowerCase();
    if (key === "level") return c.level;
    if (key === "count") return c.count;
    if (key === "golds") return c.golds;
    if (key === "read") return c.readAt;
    return c.points;
}
