// Who is on a category's loot council when the category has a roster (#667,
// docs/loot-council.md "Wer im Council steht"): the roster is the candidate
// list, on the page and in the game.
//
//   - Stamm (core) and Probe (trial) are candidates. In practice the two are
//     hardly told apart, so both count the same.
//   - Ersatz (bench) joins only with the page's "Ersatz zeigen" (`showBench`).
//   - Pause never - it counts like "Nicht eingeplant".
//   - With `allowMultipleChars` every assigned character counts; without it a
//     member has one anyway (rosterStore cuts the rest).
//
// The characters come straight from `member.chars` - profile keys of the
// roster's game version ("forever~devi res" for WoW Forever). Every data
// source the council reads (loot, logs, gear, the character store, the set-
// aside list) keys a character by its bare lower-case name, so the council key
// is that key's name part (nameKeyOf) and the roster key rides along. A roster
// holds one version, so two of its characters never share a name part.
//
// The member's profile character (raiderProfileStore) adds class and spec as
// the last fallback: a new raider who has neither won anything nor been
// logged is exactly who the roster knows and the data does not.
const { rosterForCategory } = require("../../stores/rosterStore");
const { listProfiles } = require("../../stores/raiderProfileStore");
const { nameKeyOf, splitPlayer } = require("../../utils/loot/lootImport");

const CANDIDATE_STATUSES = ["core", "trial"];
// Which status wins when two members name the same character (a claim the
// roster page reports on): the stronger one, so nobody drops out by accident.
const STATUS_RANK = { core: 0, trial: 1, bench: 2, pause: 3 };

/** "Priest-Shadow" -> "Shadow": a profile spec key is "<Class>-<Spec>", the council's spec is the part after it. */
function specIdOf(specKey) {
    const raw = String(specKey || "");
    const at = raw.indexOf("-");
    return at === -1 ? "" : raw.slice(at + 1);
}

/** One roster character with the name and the profile's class and specs. */
function entryFor({ key, rosterKey, status, userId, member, profile }) {
    const own = ((profile && profile.characters) || []).find((c) => c.key === rosterKey) || null;
    const typed = (member.charNames || {})[rosterKey] || "";
    return {
        key,
        rosterKey,
        status,
        userId,
        // The name as entered may carry a realm ("Keslight-Thunderstrike").
        name: (typed && splitPlayer(typed).character) || (own && own.name) || "",
        className: (own && own.className) || "",
        specs: ((own && own.specs) || []).map((s) => specIdOf(s.key)).filter(Boolean),
    };
}

/**
 * The roster's characters as the council sees them, or null when the category
 * has no roster (then everything stays as before).
 *
 * @param {string} categoryId
 * @param {{ showBench?: boolean }} [opts]
 * @returns {null | {
 *   roster: { id, name, versionId },
 *   entries: Map<string, { key, rosterKey, status, userId, name, className, specs }>,
 *   candidates: string[],      // council keys of the candidates, in roster order
 *   counts: { core, trial, bench, pause },
 *   showBench: boolean,
 * }}
 */
function rosterCandidates(categoryId, { showBench = false } = {}) {
    const id = String(categoryId || "").trim();
    if (!id) return null;
    const roster = rosterForCategory(id);
    if (!roster) return null;

    const profiles = new Map(listProfiles().map((p) => [p.userId, p]));
    const entries = new Map();
    for (const [userId, member] of Object.entries(roster.members || {})) {
        const status = member.status || "core";
        for (const rosterKey of member.chars || []) {
            const key = nameKeyOf(rosterKey);
            if (!key) continue;
            const prev = entries.get(key);
            if (prev && STATUS_RANK[prev.status] <= STATUS_RANK[status]) continue;
            entries.set(key, entryFor({ key, rosterKey, status, userId, member, profile: profiles.get(userId) }));
        }
    }

    const counts = { core: 0, trial: 0, bench: 0, pause: 0 };
    const candidates = [];
    for (const entry of entries.values()) {
        counts[entry.status] = (counts[entry.status] || 0) + 1;
        if (CANDIDATE_STATUSES.includes(entry.status) || (showBench && entry.status === "bench")) candidates.push(entry.key);
    }
    return {
        roster: { id: roster.id, name: roster.name, versionId: roster.versionId },
        entries,
        candidates,
        counts,
        showBench: !!showBench,
    };
}

module.exports = { rosterCandidates, specIdOf, CANDIDATE_STATUSES };
