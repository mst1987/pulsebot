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

const { listReports, getReportRoster } = require("../../stores/loot/reportStore");
const characterStore = require("../../stores/roster/characterStore");
const raiderCharacters = require("../../stores/roster/raiderCharactersStore");
const profiles = require("../../stores/roster/raiderProfileStore");

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

/** Edits (insert, delete, replace) between two strings — Levenshtein, short names only. */
function editDistance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        let prev = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const keep = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = keep;
        }
    }
    return row[b.length];
}

/**
 * How close a logged name is to a name typed with a typo ("Nerathli" for
 * "Nerathil"): the number of edits, or -1 when it is too far to be a typo — at
 * most one edit per four letters (at least one), or the one name starting with
 * the other ("Gent" / "Gentle").
 */
function typoDistance(typed, logged) {
    const a = letters(typed);
    const b = letters(logged);
    if (a.length < 2 || b.length < 2 || a === b) return a === b && a ? 0 : -1;
    if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return Math.abs(a.length - b.length);
    const d = editDistance(a, b);
    return d <= Math.max(1, Math.floor(Math.max(a.length, b.length) / 4)) ? d : -1;
}

/**
 * Characters from the logs the raider could take over. Excludes the ones
 * already in the profile; each carries `claimedBy` (other accounts) and a
 * `match` reason. `query` narrows by name.
 *
 * `near` ({ name, className }) — a character being set right ("Bearbeiten" ›
 * aus den Logs): the logged names that look like a typo of its name come
 * first, marked `match: "similar"`, the closest and the same class first. The
 * character itself is not excluded then: its own name may be the logged one.
 */
function logSuggestions(user, { query = "", near = null, index = logIndex() } = {}) {
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
    const rank = { similar: 0, assigned: 1, name: 2, "": 3 };
    const nearKey = near ? profiles.characterKey(near.name) : "";
    const distanceOf = (e) => (near ? typoDistance(near.name, e.character) : -1);
    const sameClass = (e) => (near && near.className === e.className ? 0 : 1);
    return [...index.values()]
        .filter((e) => e.className && (!ownKeys.has(e.key) || e.key === nearKey))
        .filter((e) => !q || e.key.includes(q))
        .map((e) => {
            const distance = distanceOf(e);
            return {
                character: e.character,
                className: e.className,
                specKey: e.specKey,
                reports: e.reports,
                lastSeen: e.lastSeen,
                match: distance >= 0 ? "similar" : matchReason(e, ctx),
                claimedBy: claims.get(e.key) || [],
                distance,
                same: sameClass(e),
            };
        })
        .sort((a, b) => (rank[a.match] - rank[b.match])
            || (a.match === "similar" ? (a.distance - b.distance) || (a.same - b.same) : 0)
            || (a.claimedBy.length - b.claimedBy.length)
            || (b.lastSeen - a.lastSeen)
            || a.character.localeCompare(b.character))
        .slice(0, MAX_SUGGESTIONS)
        .map(({ distance: _d, same: _s, ...rest }) => rest);
}

module.exports = { logIndex, specEvidence, logSuggestions, matchReason, typoDistance, MAX_REPORTS, MAX_SUGGESTIONS };
