// What the dungeon page (Dungeon-Bestzeiten, GET /api/dungeons) and /bestzeiten
// read from the stored LevelHelper runs (stores/roster/dungeonRunStore.js) — one game
// version at a time (#741):
//
//   dungeonTables   per dungeon its fastest group runs (time, medal, members, date)
//   playerTable     the overall ranking: medals per player over every stored run,
//                   and the dungeons in which the player has a gold run
//   characterTable  the characters by achievement points (the addon's reading)
//
// Members carry their class as the rule set of the version names it (id,
// colour, icon), so the web colours them like everywhere else. A player is
// recognised by guid, else by lower-case name; a name-only member joins the
// guid player of the same name.
const store = require("../../stores/roster/dungeonRunStore");
const { rulesFor } = require("../../config/gameVersions");

const MEDAL_RANK = { gold: 3, silver: 2, bronze: 1 };
/** Runs per dungeon on the page. */
const TOP_RUNS = 10;

const squash = (s) => String(s || "").toUpperCase().replace(/[^A-Z]/g, "");

/**
 * The class of a WoW class token ("PALADIN", "DEATHKNIGHT") in a version's
 * rule set: `{ classId, color, icon }`, empty strings when it knows none.
 */
function classOf(versionId, token) {
    const key = squash(token);
    const rules = rulesFor(versionId);
    const hit = key && rules ? rules.classes.find((c) => squash(c.id) === key || squash(c.labelEn) === key) : null;
    return hit ? { classId: hit.id, color: hit.color || "", icon: hit.icon || "" } : { classId: "", color: "", icon: "" };
}

const ms = (unixSeconds) => (Number(unixSeconds) > 0 ? Math.round(Number(unixSeconds) * 1000) : 0);

/** Fastest first; the same time: the earlier run first. */
function byTime(a, b) {
    return a.seconds - b.seconds || a.start - b.start;
}

/** One run as the page and the bot show it. */
function runView(run) {
    return {
        id: run.id,
        dungeon: run.dungeon,
        seconds: run.seconds,
        medal: run.medal,
        startedAt: ms(run.start),
        finishedAt: ms(run.at),
        members: run.members.map((m) => ({ name: m.name, ...classOf(run.versionId, m.class) })),
    };
}

/**
 * Per dungeon (by name) its `limit` fastest runs plus how many runs and gold
 * runs are stored and the best time.
 */
function dungeonTables(runs, { limit = TOP_RUNS } = {}) {
    const byDungeon = new Map();
    for (const r of runs) {
        if (!byDungeon.has(r.dungeon)) byDungeon.set(r.dungeon, []);
        byDungeon.get(r.dungeon).push(r);
    }
    return [...byDungeon.entries()]
        .map(([dungeon, list]) => {
            const sorted = list.slice().sort(byTime);
            return {
                dungeon,
                runCount: list.length,
                goldRuns: list.filter((r) => r.medal === "gold").length,
                bestSeconds: sorted[0].seconds,
                runs: sorted.slice(0, limit).map((r, i) => ({ rank: i + 1, ...runView(r) })),
            };
        })
        .sort((a, b) => a.dungeon.localeCompare(b.dungeon, "en"));
}

/** More golds first, then more silvers, more bronzes, more dungeons with gold, then by name. */
function byMedals(a, b) {
    return b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || b.goldDungeons.length - a.goldDungeons.length
        || a.name.localeCompare(b.name, "de");
}

/**
 * The overall ranking: every player of the stored runs with the medals of the
 * runs they were in, their runs and the dungeons with a gold run.
 */
function playerTable(runs) {
    const players = new Map();
    const guidOfName = new Map();
    // the guid players first, so a name-only member can join the one of its name
    for (const r of runs) for (const m of r.members) if (m.guid) guidOfName.set(m.name.toLowerCase(), m.guid);
    const sorted = runs.slice().sort((a, b) => a.at - b.at);
    for (const r of sorted) {
        for (const m of r.members) {
            const guid = m.guid || guidOfName.get(m.name.toLowerCase()) || "";
            const key = guid ? `g:${guid}` : `n:${m.name.toLowerCase()}`;
            if (!players.has(key)) {
                players.set(key, { key, name: m.name, classToken: "", gold: 0, silver: 0, bronze: 0, runs: 0, goldSet: new Set(), versionId: r.versionId });
            }
            const p = players.get(key);
            p.name = m.name;
            if (m.class) p.classToken = m.class;
            p.runs += 1;
            if (r.medal) p[r.medal] += 1;
            if (r.medal === "gold") p.goldSet.add(r.dungeon);
        }
    }
    return [...players.values()]
        .map((p) => ({
            key: p.key, name: p.name, ...classOf(p.versionId, p.classToken),
            gold: p.gold, silver: p.silver, bronze: p.bronze, runs: p.runs,
            goldDungeons: [...p.goldSet].sort((a, b) => a.localeCompare(b, "en")),
        }))
        .sort(byMedals)
        .map((p, i) => ({ rank: i + 1, ...p }));
}

/** The characters by achievement points (most first), with their class. */
function characterTable(characters) {
    return characters
        .map((c) => ({
            key: c.key, name: c.name, realm: c.realm, ...classOf(c.versionId, c.class),
            level: c.level, points: c.points, count: c.count, golds: c.golds, readAt: ms(c.at),
        }))
        .sort((a, b) => b.points - a.points || b.count - a.count || a.name.localeCompare(b.name, "de"))
        .map((c, i) => ({ rank: i + 1, ...c }));
}

/** Every table of one version, plus its counts. */
function dungeonBoard(versionId) {
    const runs = store.listRuns(versionId);
    const characters = store.listCharacters(versionId);
    return {
        versionId,
        dungeons: dungeonTables(runs),
        players: playerTable(runs),
        characters: characterTable(characters),
        totals: { runs: runs.length, characters: characters.length },
        updatedAt: Math.max(0, ...runs.map((r) => r.updatedAt || r.receivedAt || 0), ...characters.map((c) => c.receivedAt || 0)),
    };
}

/** The versions that have stored runs or characters (for the empty page's hint). */
function versionsWithData() {
    return [...new Set([...store.listRuns().map((r) => r.versionId), ...store.listCharacters().map((c) => c.versionId)])];
}

/** The dungeon names of a version, for the bot's autocomplete. */
function dungeonNames(versionId) {
    return [...new Set(store.listRuns(versionId).map((r) => r.dungeon))].sort((a, b) => a.localeCompare(b, "en"));
}

/** "31:42" or "1:02:05" — a time of seconds as the page and the bot write it. */
function formatSeconds(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rest = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

module.exports = {
    classOf, runView, dungeonTables, playerTable, characterTable, dungeonBoard, versionsWithData, dungeonNames, formatSeconds,
    MEDAL_RANK, TOP_RUNS,
};
