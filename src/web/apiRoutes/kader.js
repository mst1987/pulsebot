// The Kaderplaner (docs/kaderplaner.md): raid rosters for WoW Forever, one Kader
// at a time from the Discord pool through the Vorauswahl (interviews) and the
// provisional roster to roster, bench and tentative. Area "kader" — in no base
// access by default, so only full admins and the accounts or roles an admin
// grants it to get in (docs/permissions.md). GET = read, every change = write
// plus CSRF; a read-only account sees everything and changes nothing.
//
// GET /api/kader?kader=<id> answers the whole view model: the server's side
// (players with characters and attendance, members, Discord roles, names) plus
// the chosen Kader. A change inside one Kader answers only `{ kader, kaders }`
// (the Kader as stored and the summaries) — the page swaps them in; a change
// that touches the server's side (accounts, character data, taking players in)
// answers the whole view model again. Parameters travel in the body.
//
// Live (docs/kaderplaner.md): every write is compared with what was stored
// before (kaderActivity.recordChanges) — revisions and the Kader's activity
// log. GET /api/kader/live is the page's poll (revision, the changes since the
// page's revision, who else is in the Kader); GET /api/kader/kader the light
// refetch of one Kader. A save that names the revision it started from
// (`baseRev`) and finds a newer one answers 409 `stale` with who changed it.
const { ok, sendJson, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const { q } = require("../http/apiParams");
const { userCan } = require("../../config/permissions");
const kaderStore = require("../../stores/kaderStore");
const rosterStore = require("../../stores/rosterStore");
const { canManageRosterLive } = require("../../services/roster/rosterAccess");
const { kaderRosterState, rosterOfKader, syncRosterFromKader } = require("../../services/roster/rosterCreate");
const model = require("../../services/kader/kaderModel");
const players = require("../../services/kader/kaderPlayers");
const questions = require("../../services/kader/kaderQuestions");
const setups = require("../../services/kader/kaderSetups");
const { recordChanges, changesSince } = require("../../services/kader/kaderActivity");
const { loadKaderSource, loadKaderRules, listRaidCategories } = require("../kader/kaderSource");
const { buildKaderView, kaderPayload, mutationContext, lightContext } = require("../kader/kaderView");
const presence = require("../kader/kaderPresence");

const str = (body, key) => q.str(body, key);
const WRITE = { write: "kader", csrf: true, body: true };

/** Splits a mutator's answer into the new planner and what it adds to the reply (a created id, counts). */
function unpack(result) {
    return result && result.planner ? result : { planner: result };
}

/** Writes a mutator's planner with its revisions and activity lines (who: `actor`, when: `now`). */
function store(guildId, before, next, { actor, now }) {
    return kaderStore.writePlanner(guildId, recordChanges(before, model.normalizePlanner(next), { actor, now }));
}

/**
 * Runs a write; a 409 `stale` (kaderModel.stale) is answered with its details
 * (the current revision, who changed it, when) next to code and message.
 */
function guarded(fn) {
    return async (ctx) => {
        try {
            return await fn(ctx);
        } catch (e) {
            if (!(e && e.code === "stale")) throw e;
            return sendJson(ctx.res, 409, { error: { code: "stale", message: e.message, ...(e.details || {}) } });
        }
    };
}

/** GET /api/kader?kader=<id> — the whole view model of the active server, with the chosen Kader. */
const getKader = withUser({}, async ({ req, res, query }) => {
    const guildId = activeGuildFor(req);
    const source = await loadKaderSource({ guildId });
    ok(res, buildKaderView({ source, planner: kaderStore.readPlanner(guildId), kaderId: str(query, "kader") }));
});

/** GET /api/kader/kader?kader=<id> — only the Kader as stored and the summaries (a change inside it, seen live). */
const getKaderOnly = withUser({}, async ({ req, res, query }) => {
    ok(res, kaderPayload(kaderStore.readPlanner(activeGuildFor(req)), str(query, "kader")));
});

/**
 * GET /api/kader/live?kader=<id>&rev=<n>&tab=<id>&sub=<page>&player=<id>&what=<interview|drawer|account>&edit=1[&leave=1]
 *
 * The poll of an open Kader page, every few seconds while it is visible:
 * reports where the page is (in memory only, kaderPresence.js) and answers
 * `{ rev, sharedRev, changes, more, presence }` — the Kader's revision, its
 * activity lines after `rev`, and who else is in this Kader. Never builds the
 * view model; reads the file only when it changed. `leave=1` takes the tab out
 * at once. A Kader that is gone answers `gone: true`.
 */
const getLive = withUser({}, async ({ req, res, query, user }) => {
    const guildId = activeGuildFor(req);
    const kaderId = str(query, "kader");
    const tab = str(query, "tab");
    const state = kaderStore.liveState(guildId, kaderId);
    if (!state.found || query.get("leave") === "1") presence.leave({ guildId, userId: user.id, tab });
    if (!state.found) return ok(res, { gone: true, rev: 0, sharedRev: state.sharedRev, changes: [], more: false, presence: [] });
    if (query.get("leave") !== "1") {
        presence.beat({
            guildId, kaderId, tab, userId: user.id, name: user.name,
            sub: str(query, "sub"), playerId: str(query, "player"), what: str(query, "what"),
            edit: query.get("edit") === "1" && userCan(user, "kader", "write"),
        });
    }
    const { changes, more } = changesSince(state.activity, query.has("rev") ? Number(query.get("rev")) : NaN);
    return ok(res, { rev: state.rev, sharedRev: state.sharedRev, changes, more, presence: presence.present({ guildId, kaderId, except: user.id }) });
});

/**
 * A change on the server's side: the bot's data is loaded (members, profiles,
 * logs), the mutator runs on the stored planner, the reply is the whole view.
 * The planner is read after the last await, so read, change and write happen
 * without a pause in between.
 */
function fullWrite(mutate) {
    return withUser(WRITE, guarded(async ({ req, res, body, user }) => {
        const guildId = activeGuildFor(req);
        const source = await loadKaderSource({ guildId });
        const planner = kaderStore.readPlanner(guildId);
        const ctx = mutationContext({ source, planner, actor: user.id });
        const { planner: next, ...extra } = unpack(mutate(planner, body, ctx));
        const stored = store(guildId, planner, next, ctx);
        ok(res, { ...buildKaderView({ source, planner: stored, kaderId: str(body, "kaderId") || extra.kaderId || "" }), ...extra });
    }));
}

/**
 * A change inside one Kader: only the rule set is needed (class and spec keys),
 * unless `source` asks for the bot's data too (attendance for "Automatisch
 * verteilen") or `categories` for the server's raid categories (the Kader's
 * attendance pick is checked against them). The reply is the Kader as stored
 * and the summaries of all.
 */
function kaderWrite(mutate, { source: withSource = false, categories = false } = {}) {
    return withUser(WRITE, guarded(async ({ req, res, body, user }) => {
        const guildId = activeGuildFor(req);
        const source = withSource ? await loadKaderSource({ guildId }) : null;
        const planner = kaderStore.readPlanner(guildId);
        const ctx = source
            ? mutationContext({ source, planner, actor: user.id })
            : lightContext({ rules: loadKaderRules(), actor: user.id });
        if (categories && !source) ctx.raidCategoryIds = new Set(listRaidCategories(guildId).map((c) => c.id));
        const { planner: next, ...extra } = unpack(mutate(planner, body, ctx));
        const stored = store(guildId, planner, next, ctx);
        ok(res, { ...kaderPayload(stored, str(body, "kaderId") || extra.kaderId || ""), ...extra });
    }));
}

// ------------------------------------------------------------ Kader
/** POST /api/kader/kaders — body: { name }; the creator becomes its lead. Answers `kaderId`. */
const createKader = kaderWrite((p, body, ctx) => model.createKader(p, body, ctx));
/**
 * PUT /api/kader/kaders — body: { kaderId, name?, leads?, attendanceCategories? }; a
 * category the server does not know as a raid category is left out.
 */
const updateKader = kaderWrite((p, body, ctx) => model.updateKader(p, body, ctx), { categories: true });
/** POST /api/kader/kaders/delete — body: { kaderId } — with everything in it. */
const deleteKader = kaderWrite((p, body) => model.deleteKader(p, str(body, "kaderId")));

// ---------------------------------------------------------- players
/** POST /api/kader/players/add — body: { kaderId, players: [{ userId, displayName? }] } into the pool. Answers `added`, `already`. */
const addPlayers = fullWrite((p, body, ctx) => players.addPlayers(p, body, ctx));
/** POST /api/kader/players/remove — body: { kaderId, userIds } */
const removePlayers = kaderWrite((p, body) => players.removePlayers(p, body));
/** POST /api/kader/players/state — body: { kaderId, userIds, to, decision? }. Answers `moved`, `skipped`. */
const setState = kaderWrite((p, body, ctx) => players.setState(p, body, ctx));

// -------------------------------------------------------- interview
/** PUT /api/kader/interview — body: { kaderId, userId, wishes?, answers?, note?, lead? } */
const saveInterview = kaderWrite((p, body, ctx) => players.saveInterview(p, body, ctx));
/** POST /api/kader/interview/complete — body: { kaderId, userId } */
const completeInterview = kaderWrite((p, body, ctx) => players.completeInterview(p, body, ctx));
/** POST /api/kader/interview/reopen — body: { kaderId, userId } */
const reopenInterview = kaderWrite((p, body, ctx) => players.reopenInterview(p, body, ctx));

// ------------------------------------------------ votes and comments
/** POST /api/kader/votes — body: { kaderId, userId, vote: yes|unsure|no|"" }; leads only. */
const setVote = kaderWrite((p, body, ctx) => players.setVote(p, body, ctx));
/** POST /api/kader/comments — body: { kaderId, userId, text } */
const addComment = kaderWrite((p, body, ctx) => players.addComment(p, body, ctx));
/** POST /api/kader/comments/delete — body: { kaderId, userId, commentId }; own comments only. */
const deleteComment = kaderWrite((p, body, ctx) => players.deleteComment(p, body, ctx));

// --------------------------------------------------------- questions
/** POST /api/kader/questions — body: { kaderId, text, type, options: [{ label, color? }], required } */
const addQuestion = kaderWrite((p, body) => questions.addQuestion(p, body));
/** PUT /api/kader/questions — body: { kaderId, questionId, text?, type?, options?: [{ id?, label, color? }], required? } */
const updateQuestion = kaderWrite((p, body) => questions.updateQuestion(p, body));
/** POST /api/kader/questions/delete — body: { kaderId, questionId } — its answers go with it. */
const deleteQuestion = kaderWrite((p, body) => questions.deleteQuestion(p, body));
/** POST /api/kader/questions/order — body: { kaderId, order: [questionId] } */
const orderQuestions = kaderWrite((p, body) => questions.orderQuestions(p, body));
/** POST /api/kader/questions/copy — body: { kaderId, fromKaderId } */
const copyQuestions = kaderWrite((p, body) => questions.copyQuestions(p, body));

// ----------------------------------------------------------- setups
/** POST /api/kader/variants — body: { kaderId, name?, copyFrom? }. Answers `variantId`. */
const addVariant = kaderWrite((p, body) => setups.addVariant(p, body));
/** PUT /api/kader/variants — body: { kaderId, variantId, name?, size?, groups? } */
const saveVariant = kaderWrite((p, body) => setups.saveVariant(p, body));
/** POST /api/kader/variants/delete — body: { kaderId, variantId } */
const deleteVariant = kaderWrite((p, body) => setups.deleteVariant(p, body));
/** POST /api/kader/variants/auto — body: { kaderId, variantId, sources? }: "Automatisch verteilen". */
const autoVariant = kaderWrite((p, body, ctx) => setups.autoVariant(p, body, ctx), { source: true });

// ------------------------------------------ accounts and character data
/**
 * POST /api/kader/accounts — body: { userId, displayName, character?, kaderId? }:
 * an account by Discord id; with `kaderId` it goes into that Kader's pool too.
 */
const addAccount = fullWrite((p, body, ctx) => {
    const known = model.addAccount(p, body, ctx);
    if (!str(body, "kaderId")) return known;
    return players.addPlayers(known, { kaderId: str(body, "kaderId"), players: [{ userId: str(body, "userId"), displayName: str(body, "displayName") }] }, ctx);
});
/** POST /api/kader/accounts/remove — body: { userId }; only an account added by hand, out of every Kader. */
const removeAccount = fullWrite((p, body) => model.removeAccount(p, str(body, "userId")));
/** PUT /api/kader/assignments — body: { userId, characters, activeCharacterId } */
const saveAssignment = fullWrite((p, body, ctx) => model.setAssignment(p, str(body, "userId"), body, ctx));
/** POST /api/kader/assignments/reset — body: { userId }; the profile shows again. */
const resetAssignment = fullWrite((p, body) => model.resetAssignment(p, str(body, "userId")));

// ------------------------------------------------ the raid roster (#658)
// A Kader can create a raid roster (POST /api/rosters/create with source
// "kader", full admins) or, once it has one, take its newly decided players
// over. Only status and character cross (services/kader/kaderRoster.js);
// nothing flows back into the Kader.

/**
 * GET /api/kader/roster?kader=<id> — `{ roster: { id, name, members } | null,
 * candidates, pending, canCreate, canSync }`: the roster the Kader created,
 * how many of its players a roster takes and how many of them are not in it
 * yet (counts only). `canCreate` = full admin and no roster yet, `canSync` =
 * `kader` write and manager of that roster. 404 for an unknown Kader.
 */
const getKaderRoster = withUser({}, async ({ req, res, query, user }) => {
    const guildId = activeGuildFor(req);
    const state = kaderRosterState(guildId, str(query, "kader"));
    if (!state) return apiError(res, 404, "kader_not_found", "Kader nicht gefunden.");
    const roster = state.roster ? rosterStore.getRoster(state.roster.id) : null;
    const canSync = !!roster && userCan(user, "kader", "write") && await canManageRosterLive(user, roster).catch(() => false);
    return ok(res, { ...state, canCreate: !roster && user.isAdmin === true, canSync });
});

const SYNC_STATUS = { not_found: 404, kader_not_found: 404, not_manager: 403, not_from_kader: 409 };

/**
 * POST /api/kader/roster/sync — body: { kaderId }: "Ins Roster übernehmen".
 * Area `kader` write + CSRF, then manager of the roster the Kader created
 * (`canManageRosterLive`), else 403 `not_manager`. Players in roster / bench /
 * tentative who are no member yet join (core / bench / trial, the main role
 * given); members already there stay untouched.
 * Answer: `{ rosterId, added, skipped, kept, roleFailures: [{ userId, roleId, code }] }`.
 */
const syncKaderRoster = withUser(WRITE, async ({ req, res, body, user }) => {
    const guildId = activeGuildFor(req);
    const kaderId = str(body, "kaderId");
    const roster = rosterOfKader(guildId, kaderId);
    if (!roster) return apiError(res, 404, "not_found", "Kein Roster zu diesem Kader.");
    if (!(await canManageRosterLive(user, roster).catch(() => false))) return apiError(res, SYNC_STATUS.not_manager, "not_manager", "Nur Manager dieses Rosters.");
    const result = await syncRosterFromKader(kaderId, { guildId, actor: String(user.id || ""), rosterId: roster.id });
    if (!result.ok) return apiError(res, SYNC_STATUS[result.code] || 400, result.code, `Roster: ${result.code}`);
    return ok(res, { rosterId: roster.id, added: result.added, skipped: result.skipped, kept: result.kept, roleFailures: result.roleFailures });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/kader/roster", handler: getKaderRoster, area: "kader" },
    { method: "POST", path: "/api/kader/roster/sync", handler: syncKaderRoster, area: "kader" },
    { method: "GET", path: "/api/kader", handler: getKader, area: "kader" },
    { method: "GET", path: "/api/kader/kader", handler: getKaderOnly, area: "kader" },
    { method: "GET", path: "/api/kader/live", handler: getLive, area: "kader" },
    { method: "POST", path: "/api/kader/kaders", handler: createKader, area: "kader" },
    { method: "PUT", path: "/api/kader/kaders", handler: updateKader, area: "kader" },
    { method: "POST", path: "/api/kader/kaders/delete", handler: deleteKader, area: "kader" },
    { method: "POST", path: "/api/kader/players/add", handler: addPlayers, area: "kader" },
    { method: "POST", path: "/api/kader/players/remove", handler: removePlayers, area: "kader" },
    { method: "POST", path: "/api/kader/players/state", handler: setState, area: "kader" },
    { method: "PUT", path: "/api/kader/interview", handler: saveInterview, area: "kader" },
    { method: "POST", path: "/api/kader/interview/complete", handler: completeInterview, area: "kader" },
    { method: "POST", path: "/api/kader/interview/reopen", handler: reopenInterview, area: "kader" },
    { method: "POST", path: "/api/kader/votes", handler: setVote, area: "kader" },
    { method: "POST", path: "/api/kader/comments", handler: addComment, area: "kader" },
    { method: "POST", path: "/api/kader/comments/delete", handler: deleteComment, area: "kader" },
    { method: "POST", path: "/api/kader/questions", handler: addQuestion, area: "kader" },
    { method: "PUT", path: "/api/kader/questions", handler: updateQuestion, area: "kader" },
    { method: "POST", path: "/api/kader/questions/delete", handler: deleteQuestion, area: "kader" },
    { method: "POST", path: "/api/kader/questions/order", handler: orderQuestions, area: "kader" },
    { method: "POST", path: "/api/kader/questions/copy", handler: copyQuestions, area: "kader" },
    { method: "POST", path: "/api/kader/variants", handler: addVariant, area: "kader" },
    { method: "PUT", path: "/api/kader/variants", handler: saveVariant, area: "kader" },
    { method: "POST", path: "/api/kader/variants/delete", handler: deleteVariant, area: "kader" },
    { method: "POST", path: "/api/kader/variants/auto", handler: autoVariant, area: "kader" },
    { method: "POST", path: "/api/kader/accounts", handler: addAccount, area: "kader" },
    { method: "POST", path: "/api/kader/accounts/remove", handler: removeAccount, area: "kader" },
    { method: "PUT", path: "/api/kader/assignments", handler: saveAssignment, area: "kader" },
    { method: "POST", path: "/api/kader/assignments/reset", handler: resetAssignment, area: "kader" },
];

module.exports = {
    getKader, getKaderOnly, getLive, createKader, updateKader, deleteKader, addPlayers, removePlayers, setState,
    saveInterview, completeInterview, reopenInterview, setVote, addComment, deleteComment,
    addQuestion, updateQuestion, deleteQuestion, orderQuestions, copyQuestions,
    addVariant, saveVariant, deleteVariant, autoVariant,
    addAccount, removeAccount, saveAssignment, resetAssignment, getKaderRoster, syncKaderRoster, routes,
};
