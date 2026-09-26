// What the logs know about a raider's characters — for "Mein Profil" (#255).
//
// Two questions, one index:
//   * "Aus den Logs übernehmen": which characters from the stored evaluations
//     could be mine? Suggestions with class, spec and when they were last seen,
//     the likely ones first.
//   * "Laut Logs": is a spec the raider enters actually evidenced? A hint for
//     the orga, never a lock — a raider may well have a healing set nobody
//     logged yet.
//
// The stored evaluations (reportStore) know who was in a raid and their class,
// never the spec; the spec comes from characterStore, which caches it from the
// loot export / Warcraft Logs. So evidence is honest about what it is: a
// character seen in N evaluations, and the spec those sources resolved.

const { listReports, getReportRoster } = require("../stores/reportStore");
const characterStore = require("../stores/characterStore");
const raiderCharacters = require("../stores/raiderCharactersStore");
const profiles = require("../stores/raiderProfileStore");

// How many of the newest evaluations are walked. The roster slice is cached in
// reportStore, so this is cheap after the first request.
const MAX_REPORTS = 60;
const MAX_SUGGESTIONS = 30;

/**
 * `Map<key, { key, character, className, reports, lastSeen, spec, specKey, specSource }>`
 * over the newest evaluations plus the character store.
 */
function logIndex() {
    const index = new Map();
    const add = (name, className) => {
        const key = profiles.characterKey(name);
        if (!key) return null;
        if (!index.has(key)) {
            index.set(key, { key, character: String(name).trim(), className: "", reports: 0, lastSeen: 0, spec: "", specKey: "", specSource: "" });
        }
        const entry = index.get(key);
        if (!entry.className && className) entry.className = className;
        return entry;
    };
    for (const meta of listReports().slice(0, MAX_REPORTS)) {
        const report = getReportRoster(meta.id);
        const seenAt = Number(meta.generatedAt || (report && report.generatedAt)) || 0;
        const seen = new Set();
        for (const player of (report && report.roster) || []) {
            const entry = add(player && player.name, profiles.normalizeClass(player && player.type));
            if (!entry || seen.has(entry.key)) continue;
            seen.add(entry.key);
            entry.reports += 1;
            entry.lastSeen = Math.max(entry.lastSeen, seenAt);
        }
    }
    for (const rec of characterStore.listCharacters()) {
        const entry = add(rec.character, profiles.normalizeClass(rec.className));
        if (!entry) continue;
        const className = entry.className || profiles.normalizeClass(rec.className);
        const specKey = className && rec.spec ? `${className}-${rec.spec}` : "";
        if (specKey && profiles.specInfo(specKey)) {
            entry.spec = rec.spec;
            entry.specKey = specKey;
            entry.specSource = rec.source || "";
        }
        if (!entry.lastSeen) entry.lastSeen = Number(rec.updatedAt) || 0;
    }
    return index;
}

/**
 * The "laut Logs" badge of one spec on one character:
 *   seen    — the logs resolved exactly this spec (with the evaluation count),
 *   other   — the character is in the logs, but with another (or no known) spec,
 *   unknown — the logs do not know the character at all (nothing to say).
 */
function specEvidence(character, specKey, index = logIndex()) {
    const entry = index.get(profiles.characterKey(character));
    if (!entry || (!entry.reports && !entry.specKey)) return { status: "unknown", reports: 0 };
    if (entry.specKey === specKey) return { status: "seen", reports: entry.reports, source: entry.specSource };
    return { status: "other", reports: entry.reports, loggedSpec: entry.specKey };
}

/** Lower-case letters only, for a loose "does this name belong to that account" match. */
function letters(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
}

/**
 * Why a log character is likely the account's own, or "" — the reason is shown
 * as a small badge, so the order is explainable.
 */
function matchReason(entry, { userName, assigned }) {
    if (assigned.has(entry.key)) return "assigned";
    const name = letters(userName);
    const char = letters(entry.character);
    if (name.length < 4 || char.length < 4) return "";
    // "nerathil" (Discord) and "Nerathil"/"Nerasol" (characters): the account
    // name contains the character, or both start alike.
    return name.includes(char) || char.startsWith(name.slice(0, 4)) ? "name" : "";
}

/**
 * Characters from the logs the raider could take over. Excludes the ones
 * already in the profile; each carries `claimedBy` (other accounts) and a
 * `match` reason. `query` narrows by name.
 */
function logSuggestions(user, { query = "", index = logIndex() } = {}) {
    const userId = String((user && user.id) || "");
    const own = profiles.getProfile(userId);
    const ownKeys = new Set(((own && own.characters) || []).map((c) => c.key));
    const assigned = new Set();
    for (const map of Object.values(raiderCharacters.listAllAssignments())) {
        if (map[userId]) assigned.add(profiles.characterKey(map[userId]));
    }
    const q = String(query || "").trim().toLowerCase();
    const ctx = { userName: user && user.name, assigned };
    const claims = new Map();
    for (const p of profiles.listProfiles()) {
        if (p.userId === userId) continue;
        for (const c of p.characters) {
            if (!claims.has(c.key)) claims.set(c.key, []);
            claims.get(c.key).push({ userId: p.userId, name: p.name });
        }
    }
    const rank = { assigned: 0, name: 1, "": 2 };
    return [...index.values()]
        .filter((e) => e.className && !ownKeys.has(e.key))
        .filter((e) => !q || e.key.includes(q))
        .map((e) => ({
            character: e.character,
            className: e.className,
            specKey: e.specKey,
            reports: e.reports,
            lastSeen: e.lastSeen,
            match: matchReason(e, ctx),
            claimedBy: claims.get(e.key) || [],
        }))
        .sort((a, b) => (rank[a.match] - rank[b.match])
            || (a.claimedBy.length - b.claimedBy.length)
            || (b.lastSeen - a.lastSeen)
            || a.character.localeCompare(b.character))
        .slice(0, MAX_SUGGESTIONS);
}

module.exports = { logIndex, specEvidence, logSuggestions, matchReason, MAX_REPORTS, MAX_SUGGESTIONS };
