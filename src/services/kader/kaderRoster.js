// The one door from the Kaderplaner to the raid rosters (#657, docs/kaderplaner.md
// "Roster aus einem Kader"): a roster created from a Kader takes who is in it,
// in which state, the decided class/spec and the planner's active character's
// name - and nothing else. Wishes, interview answers, notes, votes, comments,
// the Verlauf and the activity log never leave through here; the answer is
// built field by field, never by copying an entry
// (test/services/kader/kaderRoster.test.js and test/stores/kaderStore.test.js
// keep it that way).
//
// The takeover into Discord (docs/kaderplaner.md "Übernahme",
// services/roster/rosterTakeover.js) writes the planner through here too - only
// its own pieces: the Kader's `takeover` record, the move back to provisional
// of a player whose role was taken in Discord, the players' history lines and
// the activity lines of all that. Nothing here is logged.
const kaderStore = require("../../stores/kaderStore");
const model = require("./kaderModel");
const { recordChanges } = require("./kaderActivity");

/** The Kader states a roster takes over (roster → core, bench → bench, tentative → trial). */
const ROSTER_STATES = ["roster", "bench", "tentative"];

/** The Kader states the takeover gives the role to: provisional and every roster state. */
const TAKEOVER_STATES = ["provisional", ...ROSTER_STATES];

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** The planner's active character of an account, or null. */
function activeCharacter(assignment) {
    if (!assignment || !Array.isArray(assignment.characters) || !assignment.characters.length) return null;
    return assignment.characters.find((c) => c.id === assignment.activeCharacterId) || assignment.characters[0];
}

/** One player for a roster, built field by field. */
function playerOut(planner, userId, entry) {
    const active = activeCharacter(planner.assignments[userId]);
    return {
        userId: str(userId),
        state: entry.state,
        decision: entry.decision ? { className: str(entry.decision.className), spec: str(entry.decision.spec) } : null,
        characterName: active ? str(active.name) : "",
    };
}

/**
 * The players of one Kader a roster may take: `{ id, name, versionId, players: [{ userId,
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
        players.push(playerOut(planner, userId, entry));
    }
    return { id: kader.id, name: kader.name, versionId: kader.versionId, players };
}

/**
 * The Kader of a server for the "Roster anlegen" dialog and the roster link:
 * `[{ id, name, versionId, inRoster, candidates, attendanceCategories }]` -
 * its game version (#741: a roster of another version is no match), counts
 * only (`inRoster` = state roster, `candidates` = every state a roster takes)
 * and the raid categories the Kader counts attendance in (ids, no person in them).
 * The planner is read normalized, so `versionId` is always a known version.
 */
function kaderSummaries(guildId) {
    return kaderStore.readPlanner(guildId).kaders.map((k) => {
        const states = Object.values(k.players).map((e) => e.state);
        return {
            id: k.id,
            name: k.name,
            versionId: k.versionId,
            inRoster: states.filter((s) => s === "roster").length,
            candidates: states.filter((s) => ROSTER_STATES.includes(s)).length,
            attendanceCategories: [...(k.attendanceCategories || [])].map(str),
        };
    });
}

// ------------------------------------------------------------------ takeover

/**
 * The players of a taken-over Kader still waiting for the role ("nachzuziehen"):
 * in TAKEOVER_STATES, the role neither given ("ok") nor taken in Discord ("removed").
 */
function pendingOf(kader) {
    const t = kader && kader.takeover;
    if (!t) return [];
    return Object.entries(kader.players)
        .filter(([uid, e]) => TAKEOVER_STATES.includes(e.state) && t.results[uid] !== "ok" && t.results[uid] !== "removed")
        .map(([uid]) => str(uid));
}

/**
 * One Kader for the takeover: `{ id, name, versionId, rev, takeover, pending,
 * players: [{ userId, state, decision, characterName }] }` - the players of
 * TAKEOVER_STATES only; null for an unknown Kader.
 */
function takeoverPlayers(guildId, kaderId) {
    const planner = kaderStore.readPlanner(guildId);
    const kader = planner.kaders.find((k) => k.id === str(kaderId));
    if (!kader) return null;
    const players = [];
    for (const [userId, entry] of Object.entries(kader.players)) {
        if (TAKEOVER_STATES.includes(entry.state)) players.push(playerOut(planner, userId, entry));
    }
    return {
        id: kader.id,
        name: kader.name,
        versionId: kader.versionId,
        rev: model.revOf(kader.rev),
        takeover: kader.takeover ? model.clone(kader.takeover) : null,
        pending: pendingOf(kader),
        players,
    };
}

/**
 * Refuses a takeover confirmed on an older state of the Kader (409 stale with
 * the current `rev`); `body.baseRev` is the rev the dialog showed.
 */
function assertTakeoverFresh(kader, body) {
    model.assertFresh({ baseRev: body && body.baseRev }, kader && kader.rev, "Der Kader hat sich geändert, seit der Dialog offen ist.", { kaderId: kader && kader.id });
}

/** A player history line; the store keeps the last LIMITS.history. */
function pushHistory(entry, line) {
    entry.history = [...(Array.isArray(entry.history) ? entry.history : []), line].slice(-model.LIMITS.history);
}

/**
 * Reads, changes and writes the planner in one go (no await in between):
 * `mutate(kader, at)` changes the Kader in place and answers the activity lines
 * to add. The revision moves like with any planner write.
 * @returns {object|null} the stored Kader, null for an unknown one
 */
function writeKader(guildId, kaderId, mutate, { actor = "", now = new Date().toISOString() } = {}) {
    const before = kaderStore.readPlanner(guildId);
    const next = model.clone(before);
    const kader = next.kaders.find((k) => k.id === str(kaderId));
    if (!kader) return null;
    const lines = mutate(kader, now) || [];
    const after = recordChanges(before, model.normalizePlanner(next), { actor, now, extra: { [kader.id]: lines } });
    const stored = kaderStore.writePlanner(guildId, after);
    return stored.kaders.find((k) => k.id === kader.id) || null;
}

/**
 * Records a started takeover (status "running"): roster, role, category and
 * channels. A second one is refused (409 conflict) - checked again right here.
 */
function saveTakeover(guildId, kaderId, takeover, { actor = "", now } = {}) {
    return writeKader(guildId, kaderId, (kader, at) => {
        if (kader.takeover) throw model.conflict("Dieser Kader wurde schon übernommen.");
        kader.takeover = { ...takeover, by: actor, at, status: "running", results: {} };
        return [{ type: "takeover" }];
    }, { actor, now });
}

/** History lines for every player handed the role, and one activity line for all of them. */
function roleGivenLines(kader, results, at, actor) {
    const given = Object.entries(results).filter(([, r]) => r === "ok").map(([uid]) => uid);
    for (const uid of given) if (kader.players[uid]) pushHistory(kader.players[uid], { at, by: actor, type: "role_given" });
    if (!given.length) return [];
    return [given.length === 1 ? { type: "role_given", playerId: given[0] } : { type: "role_given", count: given.length }];
}

/**
 * Ends a takeover: the result of each player (`{ userId: "ok"|"missing"|"failed" }`),
 * status "done", one activity line for the roles handed out.
 */
function finishTakeover(guildId, kaderId, results, { actor = "", now } = {}) {
    return writeKader(guildId, kaderId, (kader, at) => {
        if (!kader.takeover) return [];
        kader.takeover.results = { ...kader.takeover.results, ...results };
        kader.takeover.status = "done";
        return roleGivenLines(kader, results, at, actor);
    }, { actor, now });
}

/** "Rolle nachziehen": the results of the players handed the role later. */
function markRoleGiven(guildId, kaderId, results, { actor = "", now } = {}) {
    return writeKader(guildId, kaderId, (kader, at) => {
        if (!kader.takeover) return [];
        kader.takeover.results = { ...kader.takeover.results, ...results };
        return roleGivenLines(kader, results, at, actor);
    }, { actor, now });
}

/**
 * The role was taken in Discord: the player goes back to provisional (from a
 * roster state) and is marked "removed" - not nachzuziehen until the orga
 * moves them again. Answers whether anything changed.
 */
function backToProvisional(guildId, kaderId, userId, { actor = "", now } = {}) {
    const uid = str(userId);
    let changed = false;
    writeKader(guildId, kaderId, (kader, at) => {
        const entry = kader.players[uid];
        if (!kader.takeover || !entry || !TAKEOVER_STATES.includes(entry.state)) return [];
        if (entry.state === "provisional" && kader.takeover.results[uid] === "removed") return [];
        changed = true;
        const from = entry.state;
        if (from !== "provisional") Object.assign(entry, { state: "provisional", since: at, by: actor });
        pushHistory(entry, { at, by: actor, type: "role_removed_discord", from, to: "provisional" });
        kader.takeover.results[uid] = "removed";
        return [{ type: "role_removed_discord", playerId: uid }];
    }, { actor, now });
    return changed;
}

/**
 * What a planner write by the orga means for the takeovers (pure; changes
 * `after` in place, before it is stored): a player of a taken-over Kader who
 * left TAKEOVER_STATES or the Kader loses the role and the roster (a `drop`, a
 * history line, an activity line in `lines[kaderId]`); a player marked
 * "removed" whose state the orga changed is nachzuziehen again. A deleted
 * Kader drops nobody.
 * @returns {{ drops: { kaderId: string, rosterId: string, userId: string }[], lines: Object<string, object[]> }}
 */
function takeoverDrops(before, after, { actor = "", now = new Date().toISOString() } = {}) {
    const drops = [];
    const lines = {};
    const prevById = new Map(((before && before.kaders) || []).map((k) => [k.id, k]));
    for (const kader of (after && after.kaders) || []) {
        const prev = prevById.get(kader.id);
        const t = kader.takeover;
        if (!prev || !t) continue;
        for (const [uid, old] of Object.entries(prev.players)) {
            if (!TAKEOVER_STATES.includes(old.state)) continue;
            const cur = kader.players[uid];
            if (cur && TAKEOVER_STATES.includes(cur.state)) {
                if (t.results[uid] === "removed" && cur.state !== old.state) delete t.results[uid];
                continue;
            }
            delete t.results[uid];
            if (cur) pushHistory(cur, { at: now, by: actor, type: "role_removed_kader", from: old.state, to: cur.state });
            (lines[kader.id] = lines[kader.id] || []).push({ type: "role_removed_kader", playerId: str(uid) });
            drops.push({ kaderId: kader.id, rosterId: t.rosterId, userId: str(uid) });
        }
    }
    return { drops, lines };
}

module.exports = {
    rosterPlayers, kaderSummaries, ROSTER_STATES,
    TAKEOVER_STATES, pendingOf, takeoverPlayers, assertTakeoverFresh, saveTakeover, finishTakeover, markRoleGiven, backToProvisional, takeoverDrops,
};
