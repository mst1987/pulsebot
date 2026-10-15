// "Mein Profil", a character's tab (docs/roster-profile.md "Raider-Profil"):
// what the raider's own characters of ONE game version have to do with raiding,
// read from the stores only - no network, no Armory, no gear:
//
//   rosters     the raider's memberships in the open rosters of the version
//               (rosterStore) - the person's status, and which of their
//               characters the roster lists. Only the caller's own entries.
//   characters  per profile character of the version, by its key:
//                 loot      the items it received in raids of that version
//                           (lootStore, by name; the raid's stored version
//                           decides, characterVersions.eventVersion) - a count,
//                           the newest date and the newest LOOT_SHOWN rows
//                 dungeons  the LevelHelper data of that character
//                           (dungeonRunStore, by name and realm) - achievement
//                           points with the rank among the version's characters,
//                           medals and the fastest run per dungeon; null when
//                           the addon never reported the character, so the
//                           page shows no block at all (TBC and Classic have no
//                           such data, WoW Forever does)
//
// The route is GET /api/profile/raiding (apiRoutes/profile.js, area `signup`).
const profiles = require("../../stores/raiderProfileStore");
const rosterStore = require("../../stores/rosterStore");
const lootStore = require("../../stores/lootStore");
const dungeonRuns = require("../../stores/dungeonRunStore");
const { characterTable } = require("../dungeons/dungeonBoard");
const { buildVersionContext, eventVersion } = require("./characterVersions");
const { spec: specOfVersion, LEGACY_VERSION } = require("../../config/gameVersions");

/** How many loot rows the tab lists; the history page has the rest. */
const LOOT_SHOWN = 5;
/** How many of the fastest runs the tab lists. */
const RUNS_SHOWN = 3;

const lower = (v) => String(v || "").trim().toLowerCase();
const versionOf = (c) => c.versionId || LEGACY_VERSION;

/** The caller's memberships in the open rosters of `versionId`, roster name order. */
function rosterMemberships(userId, versionId) {
    const uid = String(userId || "");
    return rosterStore.listRosters()
        .filter((r) => r.versionId === versionId && !rosterStore.isClosed(r) && r.members[uid])
        .map((r) => {
            const m = r.members[uid];
            const s = m.spec ? specOfVersion(m.spec, versionId) : null;
            return {
                id: r.id,
                name: r.name,
                categoryId: r.categoryId || "",
                status: m.status,
                since: m.since || "",
                trialUntil: m.trialUntil || null,
                chars: m.chars,
                charNames: m.charNames,
                spec: s ? { key: s.key, label: s.label, icon: s.icon || "" } : null,
            };
        });
}

/** The loot of one character in raids of `versionId`, newest first. */
function lootOf(character, versionId, ctx) {
    const rows = lootStore.listByCharacter(character.name).filter((it) => eventVersion(ctx, it.eventId) === versionId);
    return {
        count: rows.length,
        lastAt: rows.length ? rows[0].awardedAt || 0 : 0,
        items: rows.slice(0, LOOT_SHOWN).map((it) => ({ ...lootStore.charLootPreview(it), boss: it.boss || "" })),
    };
}

/**
 * The stored LevelHelper character for a profile character: the same name
 * (any case) and, when both know one, the same realm.
 */
function storedCharacterOf(character, stored) {
    const name = lower(character.name);
    const realm = lower(character.realm);
    return stored.find((c) => lower(c.name) === name && (!realm || !c.realm || lower(c.realm) === realm)) || null;
}

/** Whether a run member is this character: its guid when the addon knows one, else its name. */
const memberIs = (m, guid, name) => (guid && m.guid ? m.guid === guid : lower(m.name) === name);

/**
 * The dungeon block of one character, or null without any LevelHelper data
 * for it. Medals count every run it was in; the runs listed are its fastest
 * per dungeon, each with its place among all runs of that dungeon.
 */
function dungeonsOf(character, { runs, stored, ranked }) {
    const own = storedCharacterOf(character, stored);
    const name = own ? lower(own.name) : lower(character.name);
    const guid = own ? own.guid : "";
    const mine = runs.filter((r) => r.members.some((m) => memberIs(m, guid, name)));
    if (!own && !mine.length) return null;

    const medals = { gold: 0, silver: 0, bronze: 0 };
    for (const r of mine) if (r.medal) medals[r.medal] += 1;

    const bestPerDungeon = new Map();
    for (const r of mine) {
        const best = bestPerDungeon.get(r.dungeon);
        if (!best || r.seconds < best.seconds || (r.seconds === best.seconds && r.start < best.start)) bestPerDungeon.set(r.dungeon, r);
    }
    const best = [...bestPerDungeon.values()]
        .sort((a, b) => a.seconds - b.seconds || a.dungeon.localeCompare(b.dungeon, "en"))
        .slice(0, RUNS_SHOWN)
        .map((r) => {
            const ofDungeon = runs.filter((x) => x.dungeon === r.dungeon);
            return {
                dungeon: r.dungeon,
                seconds: r.seconds,
                medal: r.medal,
                place: 1 + ofDungeon.filter((x) => x.seconds < r.seconds).length,
                runsOfDungeon: ofDungeon.length,
                finishedAt: r.at > 0 ? Math.round(r.at * 1000) : 0,
                others: Math.max(0, r.members.length - 1),
            };
        });

    const row = own ? ranked.find((c) => c.key === own.key) : null;
    return {
        points: row ? row.points : null,
        pointsRank: row ? row.rank : null,
        characters: ranked.length,
        medals,
        runs: mine.length,
        dungeons: bestPerDungeon.size,
        best,
        readAt: Math.max(row ? row.readAt || 0 : 0, ...mine.map((r) => (r.updatedAt || r.receivedAt || 0))),
    };
}

/**
 * Everything the character tabs of the profile need for `userId`'s characters
 * of `versionId` - see the head of this file.
 * @param {string} userId
 * @param {string} versionId  a known version (the route resolves it)
 * @param {{ config?: object }} [opts]
 */
function profileRaiding(userId, versionId, { config } = {}) {
    const profile = profiles.getProfile(String(userId || ""));
    const chars = (profile.characters || []).filter((c) => versionOf(c) === versionId);
    const ctx = buildVersionContext({ config });
    const runs = dungeonRuns.listRuns(versionId);
    const stored = dungeonRuns.listCharacters(versionId);
    const ranked = characterTable(stored);
    const characters = {};
    for (const c of chars) {
        characters[c.key] = {
            loot: lootOf(c, versionId, ctx),
            dungeons: runs.length || stored.length ? dungeonsOf(c, { runs, stored, ranked }) : null,
        };
    }
    return { versionId, rosters: rosterMemberships(userId, versionId), characters };
}

module.exports = { profileRaiding, rosterMemberships, lootOf, dungeonsOf, storedCharacterOf, LOOT_SHOWN, RUNS_SHOWN };
