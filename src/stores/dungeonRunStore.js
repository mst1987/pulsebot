// Dungeon runs and achievement points the WoW addon LevelHelper reports
// through the sync tool (POST /api/ingest/levelhelper,
// utils/dungeons/levelHelperUpload.js). What is read from them — the best
// times per dungeon, the medal table, the achievement points — is
// services/dungeons/dungeonBoard.js; the merging of a report into what is
// stored is services/dungeons/dungeonRuns.js.
//
// `data/settings/dungeon-runs.json` = { runs: [run], characters: [character] }
//
//   run = { id           "dr_<hex>" — our own id; the addon's ids are `addonIds`
//           versionId    the game version of the install it came from (version first, #741)
//           guild        the guild name the addon stored ("" = unknown)
//           dungeon      ForeverDungeonJournal key (English), "The Deadmines"
//           seconds      the group's time; start (unix s), at (unix s, finished/reported)
//           instance     the instance id the addon saw, null without one
//           medal        "gold" | "silver" | "bronze" | null
//           members      [{ guid, name, class }] — 1..5, guid "" when the addon had none
//           addonIds     every addon run id this run was reported under (one per reporting PC)
//           receivedAt, updatedAt (ms), uploadedBy (token name), account (uploader's account)
//           recordPostedAt (ms) — its "new guild record" post went out, 0 = never }
//
//   character = { key          "<versionId>:g:<guid>" or "<versionId>:n:<lower name>"
//                 versionId, guid, name, realm, class, level,
//                 points       achievement points; count = achievements, golds = gold medals (addon's count)
//                 at           unix s of the addon's reading; receivedAt (ms) }
//
// Nothing here is sensitive: names, classes and times the guild sees in game.
const { settingsPath } = require("../config/paths");
const { createJsonStore } = require("./jsonStore");

/** A cap against an endless file; far above what a guild runs in a season. */
const MAX_STORED_RUNS = 20000;

const store = createJsonStore({
    file: settingsPath("dungeon-runs.json"),
    defaults: () => ({ runs: [], characters: [] }),
    normalize: (data) => ({
        runs: Array.isArray(data && data.runs) ? data.runs.filter((r) => r && typeof r === "object" && r.id && r.versionId).map(completeRun) : [],
        characters: Array.isArray(data && data.characters)
            ? data.characters.filter((c) => c && typeof c === "object" && c.key && c.versionId).map(completeCharacter)
            : [],
    }),
    cache: true,
});

/** Tests point the store at a file of their own; null = the default again. */
const useFile = store.useFile;

const str = (v, max = 200) => String(v === undefined || v === null ? "" : v).trim().slice(0, max);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const MEDALS = ["gold", "silver", "bronze"];

function completeMember(m) {
    const o = m && typeof m === "object" ? m : {};
    return { guid: str(o.guid, 64), name: str(o.name, 48), class: str(o.class, 20) };
}

function completeRun(r) {
    return {
        id: str(r.id, 40),
        versionId: str(r.versionId, 30),
        guild: str(r.guild, 60),
        dungeon: str(r.dungeon, 80),
        seconds: Math.max(0, Math.round(num(r.seconds))),
        start: num(r.start),
        at: num(r.at),
        instance: r.instance === null || r.instance === undefined || !Number.isInteger(Number(r.instance)) ? null : Number(r.instance),
        medal: MEDALS.includes(r.medal) ? r.medal : null,
        members: (Array.isArray(r.members) ? r.members : []).map(completeMember).filter((m) => m.name),
        addonIds: (Array.isArray(r.addonIds) ? r.addonIds : []).map((id) => str(id, 64)).filter(Boolean),
        receivedAt: num(r.receivedAt),
        updatedAt: num(r.updatedAt),
        uploadedBy: str(r.uploadedBy, 80),
        account: str(r.account, 64),
        recordPostedAt: num(r.recordPostedAt),
    };
}

function completeCharacter(c) {
    return {
        key: str(c.key, 160),
        versionId: str(c.versionId, 30),
        guid: str(c.guid, 64),
        name: str(c.name, 48),
        realm: str(c.realm, 60),
        class: str(c.class, 20),
        level: Math.max(0, Math.floor(num(c.level))),
        points: Math.max(0, Math.floor(num(c.points))),
        count: Math.max(0, Math.floor(num(c.count))),
        golds: Math.max(0, Math.floor(num(c.golds))),
        at: num(c.at),
        receivedAt: num(c.receivedAt),
    };
}

/** The stored runs of one version (every version without `versionId`) — copies. */
function listRuns(versionId = "") {
    const runs = store.read().runs;
    return versionId ? runs.filter((r) => r.versionId === versionId) : runs;
}

/** The stored characters of one version (every version without `versionId`) — copies. */
function listCharacters(versionId = "") {
    const characters = store.read().characters;
    return versionId ? characters.filter((c) => c.versionId === versionId) : characters;
}

/**
 * Read, change, write: `fn({ runs, characters })` changes the document (or
 * returns a new one). The oldest runs beyond MAX_STORED_RUNS fall out.
 * Returns what was written.
 */
function update(fn) {
    return store.update((doc) => {
        const result = fn(doc);
        const next = result === undefined ? doc : result;
        if (next.runs.length > MAX_STORED_RUNS) {
            next.runs = next.runs.slice().sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, MAX_STORED_RUNS);
        }
        return { runs: next.runs.map(completeRun), characters: next.characters.map(completeCharacter) };
    });
}

/** Mark runs whose record post went out (`ids` are our run ids). */
function markRecordPosted(ids, now = Date.now()) {
    const wanted = new Set(ids || []);
    if (!wanted.size) return;
    update((doc) => {
        for (const r of doc.runs) if (wanted.has(r.id)) r.recordPostedAt = now;
    });
}

module.exports = { useFile, listRuns, listCharacters, update, markRecordPosted, completeRun, completeCharacter, MAX_STORED_RUNS };
