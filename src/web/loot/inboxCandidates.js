// Which raid an addon upload belongs to, when the upload names its game
// version (#1002). A personal sync key works on all of its owner's servers
// (#1000), so the day alone no longer decides: two servers may raid the same
// evening. The candidates are the raids of that day on the key's servers whose
// game version and realm fit; the people who got loot (the upload's recipients)
// are then compared with each raid's signups. One raid where at least 60 % of
// them signed up, and no second one, is the match - its server's inbox gets the
// card. Everything else waits for the orga of every candidate's server, and
// whoever assigns it first decides.
//
// An upload without a game version (an older addon) never comes here: it keeps
// the plain day match of ingest.js.

const { candidatesForDay } = require("./lootEventMatch");
const { nameKeyOf } = require("../../utils/loot/lootImport");
const { versionOfEvent } = require("../../services/events/mainVersion");
const { settingsForVersion } = require("../../services/events/versionSettings");
const { signupStatus } = require("../../utils/attendance");
const raiderProfiles = require("../../stores/raiderProfileStore");

/** The share of recipients that must have signed up for a raid to be the clear match. */
const MATCH_SHARE = 0.6;

const str = (v) => String(v === null || v === undefined ? "" : v).trim();

/** A realm compared loosely: "Thunderstrike", "thunderstrike" and "thunder-strike" are one. */
function realmKey(value) {
    return str(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The distinct people who got loot in a session, as name keys. */
function recipientKeys(session) {
    const keys = new Set();
    for (const item of (session && session.items) || []) {
        const key = nameKeyOf(item.character || item.player || "");
        if (key) keys.add(key);
    }
    return keys;
}

/**
 * The characters a raid's signups stand for, as name keys: the characters an
 * own event's signup names, else (a Raid-Helper signup carries only the
 * account) the profile characters of that account in the raid's version. A
 * signed-off signup does not count.
 */
function signupKeys(event, versionId, { profileOf = raiderProfiles.getProfile } = {}) {
    const keys = new Set();
    for (const s of (event && event.signUps) || []) {
        if (signupStatus(s) === "absence") continue;
        const named = (Array.isArray(s.characters) ? s.characters : []).map((c) => c && c.character).filter(Boolean);
        if (s.character && !named.length) named.push(s.character);
        if (!named.length && s.userId) {
            const profile = profileOf(s.userId);
            for (const c of raiderProfiles.charactersOfVersion(profile, versionId)) named.push(c.name);
        }
        for (const name of named) {
            const key = nameKeyOf(name);
            if (key) keys.add(key);
        }
    }
    return keys;
}

/**
 * The candidates of a session among `rows` ([{ ev, g, guildId }], the raids of
 * the key's servers): same day, same game version, same realm (when both are
 * known), each with how many recipients signed up. Best match first.
 */
function scoreCandidates(session, rows, { gameVersion, realm, at, config, profileOf } = {}) {
    const recipients = recipientKeys(session);
    const total = recipients.size;
    const sameDay = new Set(candidatesForDay(at, (rows || []).map((r) => r.ev)));
    const uploadRealm = realmKey(realm);
    const out = [];
    for (const row of rows || []) {
        if (!sameDay.has(row.ev)) continue;
        const versionId = versionOfEvent({ id: row.ev.id, versionId: row.ev.versionId, categoryId: row.g.categoryId }, { config });
        if (versionId !== gameVersion) continue;
        const serverRealm = realmKey(settingsForVersion(versionId, { config, guildId: row.guildId }).blizzardRealmSlug);
        if (uploadRealm && serverRealm && uploadRealm !== serverRealm) continue;
        const signed = signupKeys(row.ev, versionId, { profileOf });
        let matched = 0;
        for (const key of recipients) if (signed.has(key)) matched += 1;
        out.push({
            eventId: row.ev.id,
            eventLabel: row.ev.title || row.ev.id,
            startTime: Number(row.ev.startTime) || 0,
            categoryId: row.g.categoryId || "",
            categoryName: row.g.categoryName || "",
            guildId: row.guildId || "",
            matched,
            total,
        });
    }
    return out.sort((a, b) => (b.matched - a.matched) || (a.startTime - b.startTime));
}

/** Whether a candidate holds at least 60 % of the recipients. */
function isStrong(candidate) {
    return candidate.total > 0 && candidate.matched / candidate.total >= MATCH_SHARE;
}

/**
 * The decision for a scored candidate list: the one clear raid, or waiting.
 * `servers` are those whose orga sees a waiting upload: every candidate's,
 * else the key's (`keyServers`, [] for an old key = every server).
 * @returns {{ waiting: boolean, servers: string[], match: { ambiguous, suggested, candidates, best } }}
 */
function decideCandidates(candidates, keyServers) {
    const list = candidates || [];
    const strong = list.filter(isStrong);
    if (strong.length === 1) {
        return {
            waiting: false,
            servers: [],
            match: { ambiguous: false, suggested: strong[0], candidates: list, best: strong[0].eventId },
        };
    }
    const fromCandidates = [...new Set(list.map((c) => c.guildId).filter(Boolean))];
    const servers = fromCandidates.length ? fromCandidates : (Array.isArray(keyServers) ? keyServers.slice() : []);
    return {
        waiting: true,
        servers,
        // No "suggested": a waiting card belongs to no server's raid yet. `best`
        // is the one the tab marks "Vorschlag" (the most recipients signed up).
        match: { ambiguous: list.length > 1, suggested: null, candidates: list, best: list.length && list[0].matched > 0 ? list[0].eventId : "" },
    };
}

module.exports = { MATCH_SHARE, realmKey, recipientKeys, signupKeys, scoreCandidates, decideCandidates, isStrong };
