// The one door from the Kaderplaner to the raid rosters (#657, docs/kaderplaner.md
// "Roster aus einem Kader"): a roster created from a Kader takes who is in it,
// in which state, the decided class/spec and the planner's active character's
// name - and nothing else. Wishes, interview answers, notes, votes, comments,
// the Verlauf and the activity log never leave through here; the answer is
// built field by field, never by copying an entry
// (test/services/kader/kaderRoster.test.js and test/stores/kaderStore.test.js
// keep it that way).
//
// Read-only: nothing here writes the planner, and nothing is logged.
const kaderStore = require("../../stores/kaderStore");

/** The Kader states a roster takes over (roster → core, bench → bench, tentative → trial). */
const ROSTER_STATES = ["roster", "bench", "tentative"];

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** The planner's active character of an account, or null. */
function activeCharacter(assignment) {
    if (!assignment || !Array.isArray(assignment.characters) || !assignment.characters.length) return null;
    return assignment.characters.find((c) => c.id === assignment.activeCharacterId) || assignment.characters[0];
}

/**
 * The players of one Kader a roster may take: `{ id, name, players: [{ userId,
 * state, decision: { className, spec } | null, characterName }] }`, only the
 * states of ROSTER_STATES; null for an unknown Kader.
 * @param {string} guildId  the server whose planner holds the Kader
 * @param {string} kaderId
 */
function rosterPlayers(guildId, kaderId) {
    const planner = kaderStore.readPlanner(guildId);
    const kader = planner.kaders.find((k) => k.id === str(kaderId));
    if (!kader) return null;
    const players = [];
    for (const [userId, entry] of Object.entries(kader.players)) {
        if (!ROSTER_STATES.includes(entry.state)) continue;
        const active = activeCharacter(planner.assignments[userId]);
        players.push({
            userId: str(userId),
            state: entry.state,
            decision: entry.decision ? { className: str(entry.decision.className), spec: str(entry.decision.spec) } : null,
            characterName: active ? str(active.name) : "",
        });
    }
    return { id: kader.id, name: kader.name, players };
}

/**
 * The Kader of a server for the "Roster anlegen" dialog: `[{ id, name,
 * inRoster, candidates }]` - counts only (`inRoster` = state roster,
 * `candidates` = every state a roster takes).
 */
function kaderSummaries(guildId) {
    return kaderStore.readPlanner(guildId).kaders.map((k) => {
        const states = Object.values(k.players).map((e) => e.state);
        return {
            id: k.id,
            name: k.name,
            inRoster: states.filter((s) => s === "roster").length,
            candidates: states.filter((s) => ROSTER_STATES.includes(s)).length,
        };
    });
}

module.exports = { rosterPlayers, kaderSummaries, ROSTER_STATES };
