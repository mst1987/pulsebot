import { get } from "../client";

// ── Dungeon-Bestzeiten ───────────────────────────────────────────────────────
// The LevelHelper addon's group runs and achievement points the sync tool
// uploads (src/web/apiRoutes/system/dungeons.js, services/dungeons/dungeonBoard.js),
// one game version at a time.

export type DungeonMedal = "gold" | "silver" | "bronze";

/** A player as the rule set of the version names its class ("" = unknown). */
export type DungeonMember = { name: string; classId: string; color: string; icon: string };

export type DungeonRun = {
    rank: number;
    id: string;
    dungeon: string;
    seconds: number;
    medal: DungeonMedal | null;
    /** ms */
    startedAt: number;
    finishedAt: number;
    members: DungeonMember[];
};

export type DungeonTable = {
    dungeon: string;
    runCount: number;
    goldRuns: number;
    bestSeconds: number;
    /** The ten fastest, fastest first. */
    runs: DungeonRun[];
};

export type DungeonPlayer = DungeonMember & {
    rank: number;
    key: string;
    gold: number;
    silver: number;
    bronze: number;
    runs: number;
    /** The dungeons with a gold run of the player, by name. */
    goldDungeons: string[];
};

export type DungeonCharacter = DungeonMember & {
    rank: number;
    key: string;
    realm: string;
    level: number;
    /** achievement points */
    points: number;
    /** achievements */
    count: number;
    /** gold medals, as the addon counts them */
    golds: number;
    /** ms of the addon's reading */
    readAt: number;
};

export type DungeonBoardData = {
    versionId: string;
    dungeons: DungeonTable[];
    players: DungeonPlayer[];
    characters: DungeonCharacter[];
    totals: { runs: number; characters: number };
    /** ms of the last upload, 0 = none */
    updatedAt: number;
    /** Short names of the other versions that have data (for the empty page). */
    otherVersions: string[];
};

export function getDungeonBoard(version = ""): Promise<DungeonBoardData> {
    return get<DungeonBoardData>(`/api/dungeons${version ? `?version=${encodeURIComponent(version)}` : ""}`);
}
