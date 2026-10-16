// A LevelHelper upload into the dungeon run store (POST /api/ingest/levelhelper):
// every run of the upload is either new, the same run reported again (merged)
// or nothing new (skipped); every character's achievement points are taken
// over when the reading is not older than the stored one.
//
// The same run reaches us more than once: every group member's PC with the
// addon reports it, each under its own addon run id, and a PC reports it again
// with every upload. So a run counts as already stored when
//
//   - one of its addon ids is the incoming id, or
//   - it is the same dungeon with the same group (members compared by guid,
//     else by lower-case name) and started within START_WINDOW seconds.
//
// Merging keeps the fastest time when the two reports differ by at most
// SAME_TIME seconds (a timer that started a second later); a report further
// apart does not change the stored time. Members are joined, the earliest
// start stays. Everything is per game version (#741): a run of another
// version never merges.
const store = require("../../stores/dungeonRunStore");
const { newId } = require("../../utils/ids");
const { parseLevelHelperUpload, memberKey, MAX_MEMBERS } = require("../../utils/dungeons/levelHelperUpload");

/** Seconds two reports of one run may start apart. */
const START_WINDOW = 120;
/** Seconds two reports of one run's time may differ and still count as the same time. */
const SAME_TIME = 10;
const MEDAL_RANK = { gold: 3, silver: 2, bronze: 1 };

/** Whether two members are the same player: guid against guid, else name against name. */
function sameMember(a, b) {
    if (a.guid && b.guid) return a.guid === b.guid;
    return a.name.toLowerCase() === b.name.toLowerCase();
}

/** Whether two member lists are the same group. */
function sameGroup(a, b) {
    if (a.length !== b.length) return false;
    const left = b.slice();
    for (const m of a) {
        const i = left.findIndex((x) => sameMember(m, x));
        if (i < 0) return false;
        left.splice(i, 1);
    }
    return true;
}

/** The stored run an incoming one is a report of, or null. */
function findSameRun(runs, versionId, incoming) {
    const own = runs.filter((r) => r.versionId === versionId);
    return own.find((r) => r.addonIds.includes(incoming.id))
        || own.find((r) => r.dungeon === incoming.dungeon
            && Math.abs(r.start - incoming.start) <= START_WINDOW
            && sameGroup(r.members, incoming.members))
        || null;
}

/** The better of two medals (null = none). */
function betterMedal(a, b) {
    return (MEDAL_RANK[b] || 0) > (MEDAL_RANK[a] || 0) ? b : a;
}

/**
 * Merge a report into a stored run (changes `run`). Returns whether anything
 * changed and whether its time got faster.
 */
function mergeRun(run, incoming) {
    const before = JSON.stringify(run);
    const previousSeconds = run.seconds;
    if (!run.addonIds.includes(incoming.id)) run.addonIds.push(incoming.id);
    if (Math.abs(run.seconds - incoming.seconds) <= SAME_TIME) {
        run.seconds = Math.min(run.seconds, incoming.seconds);
        run.medal = betterMedal(run.medal, incoming.medal);
    }
    for (const m of incoming.members) {
        const known = run.members.find((x) => sameMember(x, m));
        if (known) {
            if (!known.guid && m.guid) known.guid = m.guid;
            if (!known.class && m.class) known.class = m.class;
        } else if (run.members.length < MAX_MEMBERS) {
            run.members.push({ ...m });
        }
    }
    run.start = Math.min(run.start, incoming.start);
    run.at = Math.min(run.at || incoming.at, incoming.at);
    if (run.instance === null && incoming.instance !== null) run.instance = incoming.instance;
    const changed = JSON.stringify(run) !== before;
    return { changed, faster: run.seconds < previousSeconds };
}

/** The store key of a character: by guid, else by lower-case name — per version. */
function characterKey(versionId, c) {
    return `${versionId}:${memberKey(c)}`;
}

/**
 * Take a checked upload into the store. Pure apart from the store write.
 * @param {ReturnType<typeof parseLevelHelperUpload>} upload
 * @param {{ tokenName?: string, now?: number }} [o]
 * @returns {{ runs: { added: number, merged: number, skipped: number }, characters: { updated: number },
 *   touched: string[] }}  touched = our ids of runs that are new or got faster (record candidates)
 */
function storeUpload(upload, { tokenName = "", now = Date.now() } = {}) {
    const { versionId } = upload;
    const counts = { added: 0, merged: 0, skipped: 0 };
    const touched = [];
    let updated = 0;
    store.update((doc) => {
        for (const incoming of upload.runs) {
            const same = findSameRun(doc.runs, versionId, incoming);
            if (!same) {
                const run = {
                    id: `dr_${newId(6)}`,
                    versionId,
                    guild: upload.guild,
                    dungeon: incoming.dungeon,
                    seconds: incoming.seconds,
                    start: incoming.start,
                    at: incoming.at,
                    instance: incoming.instance,
                    medal: incoming.medal,
                    members: incoming.members.map((m) => ({ ...m })),
                    addonIds: [incoming.id],
                    receivedAt: now,
                    updatedAt: now,
                    uploadedBy: tokenName,
                    account: upload.account,
                    recordPostedAt: 0,
                };
                doc.runs.push(run);
                counts.added += 1;
                touched.push(run.id);
                continue;
            }
            const { changed, faster } = mergeRun(same, incoming);
            if (!same.guild && upload.guild) same.guild = upload.guild;
            if (changed) {
                same.updatedAt = now;
                counts.merged += 1;
                if (faster) touched.push(same.id);
            } else {
                counts.skipped += 1;
            }
        }
        for (const c of upload.characters) {
            const key = characterKey(versionId, c);
            // a character first stored by name and now reported with its guid keeps one row
            const byName = `${versionId}:n:${c.name.toLowerCase()}`;
            // and one reported without a guid finds the row that has it
            const i = doc.characters.findIndex((x) => x.key === key || (c.guid && x.key === byName)
                || (!c.guid && x.versionId === versionId && x.name.toLowerCase() === c.name.toLowerCase()));
            const prior = i >= 0 ? doc.characters[i] : null;
            if (prior && prior.at > c.at) continue;
            const row = {
                key: prior && !c.guid ? prior.key : key, versionId, guid: c.guid || (prior ? prior.guid : ""), name: c.name, realm: c.realm || (prior ? prior.realm : ""), class: c.class || (prior ? prior.class : ""),
                level: c.level, points: c.points, count: c.count, golds: c.golds, at: c.at, receivedAt: now,
            };
            if (prior) doc.characters[i] = row;
            else doc.characters.push(row);
            updated += 1;
        }
    });
    return { runs: counts, characters: { updated }, touched };
}

/**
 * The whole upload: checked (a LevelHelperParseError for anything that does not
 * fit), then stored. `versionId` is the upload's.
 */
function ingestLevelHelper(body, { tokenName = "", now = Date.now() } = {}) {
    const upload = parseLevelHelperUpload(body);
    return { versionId: upload.versionId, ...storeUpload(upload, { tokenName, now }) };
}

module.exports = { ingestLevelHelper, storeUpload, findSameRun, mergeRun, sameGroup, sameMember, characterKey, START_WINDOW, SAME_TIME };
