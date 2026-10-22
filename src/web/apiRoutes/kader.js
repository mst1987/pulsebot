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
const { getConfig } = require("../../stores/settingsStore");
const { AppError } = require("../http/apiResult");
const { rulesFor } = require("../../config/gameVersions");
const { resolveVersionQuery, isVersionVisible, knownVersion, mainVersionFor } = require("../../services/events/mainVersion");
const { rosterLootSystem } = require("../../services/loot/lootSystem");
const { canManageRosterLive } = require("../../services/roster/rosterAccess");
const { kaderRosterState, rosterOfKader, syncRosterFromKader, kaderLinkChoices, linkRosterToKader } = require("../../services/roster/rosterCreate");
const model = require("../../services/kader/kaderModel");
const players = require("../../services/kader/kaderPlayers");
const questions = require("../../services/kader/kaderQuestions");
const setups = require("../../services/kader/kaderSetups");
const plan = require("../../services/kader/kaderPlan");
const { recordChanges, changesSince } = require("../../services/kader/kaderActivity");
const { takeoverDrops, takeoverPlayers } = require("../../services/kader/kaderRoster");
const rosterTakeover = require("../../services/roster/rosterTakeover");
const { loadKaderSource, loadKaderRules, listRaidCategories, plannerVersion } = require("../kader/kaderSource");
const { buildKaderView, kaderPayload, mutationContext, lightContext } = require("../kader/kaderView");
const presence = require("../kader/kaderPresence");

const str = (body, key) => q.str(body, key);
const WRITE = { write: "kader", csrf: true, body: true };

/** Splits a mutator's answer into the new planner and what it adds to the reply (a created id, counts). */
function unpack(result) {
    return result && result.planner ? result : { planner: result };
}

/**
 * The bot's side of the planner in one game version, with the attendance of
 * every raid category the Kader of that version picked - also those of
 * another version (docs/game-versions.md: attendance is the one deliberate
 * reading across versions), counted only for the versions actually picked.
 */
function sourceFor(guildId, planner, versionId) {
    const picked = new Set();
    for (const k of planner.kaders) if (model.kaderInVersion(k, versionId)) for (const id of k.attendanceCategories || []) picked.add(id);
    return loadKaderSource({ guildId, versionId, attendanceCategoryIds: [...picked] });
}

/**
 * Writes a mutator's planner with its revisions and activity lines (who: `actor`, when: `now`;
 * `planEmptied` from kaderPlan.savePlan).
 */
function store(guildId, before, next, { actor, now, planEmptied }) {
    const normalized = model.normalizePlanner(next);
    // a taken-over Kader (docs/kaderplaner.md "Übernahme"): who left it or fell below
    // provisional loses the roster and its roles - carried out after the write
    const { drops, lines } = takeoverDrops(before, normalized, { actor, now });
    const stored = kaderStore.writePlanner(guildId, recordChanges(before, normalized, { actor, now, planEmptied, extra: lines }));
    if (drops.length) setImmediate(() => rosterTakeover.dropPlayers(drops, { actor }).catch(() => {}));
    return stored;
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

/** The game version the page shows (#741): `?version=`, else the main version. */
const shownVersion = (query) => resolveVersionQuery(query && query.get("version"), { config: getConfig() }).versionId;

/**
 * The game version the planner works in for one request (#741, "Forever =
 * Forever characters"): the named Kader's — its characters, classes, raid
 * categories and attendance are those of its version —, else `fallback`.
 */
function versionFor(planner, kaderId, fallback) {
    const kader = kaderId ? planner.kaders.find((k) => k.id === kaderId) : null;
    return kader ? model.kaderVersion(kader.versionId) : fallback;
}

/** A change's version: the Kader the body names, else the body's `versionId`, else the planner's own. */
function writeVersion(planner, body) {
    return versionFor(planner, str(body, "kaderId"), knownVersion(body && body.versionId) || plannerVersion());
}

const labelOf = (id) => {
    const rules = rulesFor(id);
    return rules ? rules.short || rules.label : id;
};

/**
 * The version of a new Kader (#741): the one the page shows (`versionId` in the
 * body), else the planner's own — never a hidden one (#563): asking for a
 * hidden version is refused (400 `version_hidden`); without a pick a hidden
 * planner version gives way to the main version.
 */
function newKaderVersion(body) {
    const config = getConfig();
    const asked = knownVersion(body && body.versionId);
    if (asked && !isVersionVisible(asked, config)) {
        throw new AppError("version_hidden", 400, `${labelOf(asked)} ist ausgeblendet – ein neuer Kader bekommt eine sichtbare Spielversion.`);
    }
    const own = asked || plannerVersion();
    return isVersionVisible(own, config) ? own : mainVersionFor({ config });
}

/**
 * GET /api/kader?kader=<id>&version=<id> — the whole view model of the active
 * server, with the chosen Kader and the Kader of the shown game version (#741).
 * The players' characters, the classes, the raid categories and the attendance
 * are those of the chosen Kader's version, without one of the shown version.
 */
const getKader = withUser({}, async ({ req, res, query }) => {
    const guildId = activeGuildFor(req);
    const kaderId = str(query, "kader");
    const shown = shownVersion(query);
    const before = kaderStore.readPlanner(guildId);
    const source = await sourceFor(guildId, before, versionFor(before, kaderId, shown));
    ok(res, buildKaderView({ source, planner: kaderStore.readPlanner(guildId), kaderId, versionId: shown }));
});

/** GET /api/kader/kader?kader=<id> — only the Kader as stored and the summaries of its version (a change inside it, seen live). */
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
        const before = kaderStore.readPlanner(guildId);
        const source = await sourceFor(guildId, before, writeVersion(before, body));
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
 * attendance pick is checked against them - those of every game version count,
 * the deliberate exception to the strict separation). The rule set is the Kader's version's (#741), `version`
 * names another one (a new Kader). The reply is the Kader as stored and the
 * summaries of all.
 */
function kaderWrite(mutate, { source: withSource = false, categories = false, version = writeVersion } = {}) {
    return withUser(WRITE, guarded(async ({ req, res, body, user }) => {
        const guildId = activeGuildFor(req);
        const before = kaderStore.readPlanner(guildId);
        const versionId = version(before, body);
        const source = withSource ? await sourceFor(guildId, before, versionId) : null;
        const planner = kaderStore.readPlanner(guildId);
        const ctx = source
            ? mutationContext({ source, planner, actor: user.id })
            : lightContext({ rules: loadKaderRules(versionId), actor: user.id });
        // the attendance pick may hold the raid categories of every version, hidden ones too
        if (categories) ctx.raidCategoryIds = new Set(listRaidCategories(guildId, { includeHidden: true }).map((c) => c.id));
        const { planner: next, ...extra } = unpack(mutate(planner, body, ctx));
        const stored = store(guildId, planner, next, ctx);
        ok(res, { ...kaderPayload(stored, str(body, "kaderId") || extra.kaderId || ""), ...extra });
    }));
}

// ------------------------------------------------------------ Kader
/**
 * POST /api/kader/kaders — body: { name, versionId? }; the creator becomes its
 * lead, the Kader belongs to the version the page shows (#741, else the
 * planner's own) - never a hidden one (400 `version_hidden`, see
 * newKaderVersion). Answers `kaderId`.
 */
const createKader = kaderWrite((p, body, ctx) => model.createKader(p, { ...body, versionId: ctx.versionId }, ctx), { version: (_p, body) => newKaderVersion(body) });
/**
 * PUT /api/kader/kaders — body: { kaderId, name?, leads?, attendanceCategories? }; a
 * category the server does not know as a raid category is left out; one of
 * another game version is fine (a Forever Kader counts its players' TBC nights).
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

// ------------------------------------------------ composition draft
/** PUT /api/kader/plan — body: { kaderId, userId, spec?: { className, spec } | null, excluded?: boolean }: one player of the draft. */
const savePlan = kaderWrite((p, body, ctx) => plan.savePlan(p, body, ctx));
/** POST /api/kader/plan/discard — body: { kaderId, baseRev?, force? }: "Verwerfen" (409 stale when the draft moved on). */
const discardPlan = kaderWrite((p, body) => plan.discardPlan(p, body));
/** POST /api/kader/plan/apply — body: { kaderId, baseRev?, force? }: the planned specs become decisions. Answers `applied`. */
const applyPlan = kaderWrite((p, body, ctx) => plan.applyPlan(p, body, ctx));

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
 * candidates, pending, canCreate, canSync, canLink, rosters }`: the roster
 * LINKED to the Kader (`roster.kaderId`), how many of its players a roster
 * takes and how many of them are not in it yet (counts only). `canCreate` =
 * full admin and no roster yet, `canSync` = `kader` write and manager of that
 * roster, `canLink` = full admin with `kader` write; `rosters` (only with
 * canLink, else []) = the server's rosters of the Kader's version to link to (#741), the one whose category
 * the Kader counts attendance in first (`suggested`); `lootCouncil` (#676) = the
 * linked roster runs as Loot-Council and the caller may open the council (the
 * page links /lootcouncil?roster=<id>). 404 for an unknown Kader.
 */
const getKaderRoster = withUser({}, async ({ req, res, query, user }) => {
    const guildId = activeGuildFor(req);
    const kaderId = str(query, "kader");
    const state = kaderRosterState(guildId, kaderId);
    if (!state) return apiError(res, 404, "kader_not_found", "Kader nicht gefunden.");
    const roster = state.roster ? rosterStore.getRoster(state.roster.id) : null;
    const canSync = !!roster && userCan(user, "kader", "write") && await canManageRosterLive(user, roster).catch(() => false);
    const canLink = user.isAdmin === true && userCan(user, "kader", "write");
    // #676: "Zum Loot-Council" - only the roster id crosses, nothing of the Kader
    const lootCouncil = !!roster && userCan(user, "lootcouncil", "read") && rosterLootSystem(getConfig(), roster).system === "lootcouncil";
    return ok(res, { ...state, canCreate: !roster && user.isAdmin === true, canSync, canLink, lootCouncil, rosters: canLink ? kaderLinkChoices(guildId, kaderId) : [] });
});

const LINK_STATUS = { kader_not_found: 404, not_found: 404, kader_taken: 409, kader_taken_over: 409, version_mismatch: 400 };
const LINK_MESSAGE = {
    version_mismatch: "Dieses Roster spielt eine andere Spielversion als der Kader.",
    kader_taken_over: "Der Kader wurde schon nach Discord übernommen - das Roster bleibt verknüpft.",
};

/**
 * POST /api/kader/roster/link — body: { kaderId, rosterId }: link the Kader to
 * an existing roster of the active server ("Mit bestehendem Roster
 * verknüpfen"), or unlink it with rosterId "". Area `kader` write + CSRF and a
 * full admin (403 `admin_only`); a roster another Kader holds is 409
 * `kader_taken`, a roster of another game version than the Kader's 400
 * `version_mismatch` (#741). Nothing of the Kader is copied - "Ins Roster übernehmen" does
 * that afterwards. Answer: the state of GET /api/kader/roster.
 */
const linkKaderRoster = withUser(WRITE, async ({ req, res, body, user }) => {
    if (user.isAdmin !== true) return apiError(res, 403, "admin_only", "Nur Admins verknüpfen ein Roster.");
    const guildId = activeGuildFor(req);
    const kaderId = str(body, "kaderId");
    const result = linkRosterToKader(kaderId, str(body, "rosterId"), { guildId, actor: String(user.id || "") });
    if (!result.ok) return apiError(res, LINK_STATUS[result.code] || 400, result.code, LINK_MESSAGE[result.code] || `Roster: ${result.code}`);
    const state = kaderRosterState(guildId, kaderId);
    const roster = state.roster ? rosterStore.getRoster(state.roster.id) : null;
    const canSync = !!roster && await canManageRosterLive(user, roster).catch(() => false);
    return ok(res, { ...state, canCreate: !roster, canSync, canLink: true, rosters: kaderLinkChoices(guildId, kaderId) });
});

const SYNC_STATUS = { not_found: 404, kader_not_found: 404, not_manager: 403, not_from_kader: 409 };

/**
 * POST /api/kader/roster/sync — body: { kaderId }: "Ins Roster übernehmen".
 * Area `kader` write + CSRF, then manager of the roster linked to the Kader
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

/**
 * May `user` run the takeover of this Kader? `kader` write and a manager of the
 * roster it writes into - the one a recorded takeover names, else the one
 * linked to the Kader (full admins always). Without a roster (and no takeover
 * yet) the takeover creates one (`createsRoster`): like creating a roster by
 * hand (rosterAdmin.js) that is for full admins only, plus `kader` write - a
 * roster manager cannot exist yet, and a Kader lead alone may not open a roster.
 * Answers the roster too.
 */
async function takeoverRights(user, guildId, kaderId) {
    const kader = takeoverPlayers(guildId, kaderId);
    // a recorded takeover writes into its own roster, whatever is linked now
    const roster = kader && kader.takeover && kader.takeover.rosterId
        ? rosterStore.getRoster(kader.takeover.rosterId)
        : rosterOfKader(guildId, kaderId);
    const writer = userCan(user, "kader", "write");
    if (!roster) {
        const createsRoster = !!kader && !kader.takeover;
        return { roster: null, createsRoster, may: createsRoster && writer && user.isAdmin === true };
    }
    const may = writer && await canManageRosterLive(user, roster).catch(() => false);
    return { roster, createsRoster: false, may };
}

/** A refusal of rosterTakeover (an AppError, or kaderModel.stale) as the answer of a route. */
function takeoverRefusal(res, e) {
    if (e && e.code === "stale") return sendJson(res, 409, { error: { code: "stale", message: e.message, ...(e.details || {}) } });
    if (e instanceof AppError) return apiError(res, e.status, e.code, e.message);
    throw e;
}

/**
 * GET /api/kader/takeover?kader=<id> — the takeover dialog (docs/kaderplaner.md
 * "Übernahme"): what is missing (`blockers`: no_roster (a recorded takeover whose
 * roster is gone), roster_closed, version_hidden, offline, no_manage_roles,
 * no_manage_channels, no_players, already_taken; `notes`: icon_not_possible,
 * roster_members_outside with `outsideCount`, creates_roster with `newRoster`
 * and - for a caller who may start - the free `rosterCategories`), the players
 * from provisional upwards with onServer / hasRole / inRoster / result, the
 * server's categories (only for a caller who may start), a recorded takeover,
 * `aborted` (still running without a job - the bot restarted) and who is
 * still `pending` ("Rolle nachziehen"). Area `kader` read; `canStart` = may
 * start or pull the role. 404 for an unknown Kader.
 */
const getTakeover = withUser({}, async ({ req, res, query, user }) => {
    const guildId = activeGuildFor(req);
    const kaderId = str(query, "kader");
    try {
        const { may } = await takeoverRights(user, guildId, kaderId);
        const check = await rosterTakeover.precheck(guildId, kaderId, { withCategories: may });
        return ok(res, { ...check, canStart: may });
    } catch (e) {
        return takeoverRefusal(res, e);
    }
});

/**
 * POST /api/kader/takeover — body: { kaderId, confirm: true, baseRev, role: {
 * name, color?: "#rrggbb", unicodeEmoji? }, category: { id } | { name, emoji? },
 * channels: [{ name, emoji?, orgaOnlyWrite? }], roster?: { name?, categoryId? } }:
 * the takeover. Area `kader` write + CSRF, then manager of the linked roster,
 * else 403 `not_manager`. Without a linked roster the takeover creates one
 * from `roster` - full admins only, else 403 `admin_only`; 404 `not_found`
 * for an unknown Kader. 400 confirm_required / base_rev_required / invalid_*,
 * 409 stale / already_taken / running / role_too_high / category_taken /
 * version_hidden, 503 offline. The checked path goes to the service
 * (`createsRoster`): a roster linked or unlinked during the rights check is
 * 409 `roster_linked` / `no_roster`, never a silent switch.
 * Answer: `{ takeover, steps: [{ step, ok, id?, name, error? }], assigning }` -
 * the roles go out in the background, GET shows the results.
 */
const startTakeover = withUser(WRITE, async ({ req, res, body, user }) => {
    const guildId = activeGuildFor(req);
    const kaderId = str(body, "kaderId");
    const { roster, createsRoster, may } = await takeoverRights(user, guildId, kaderId);
    if (!roster && !createsRoster) return apiError(res, 404, "not_found", "Kein Roster zu diesem Kader.");
    if (!may && createsRoster) return apiError(res, 403, "admin_only", "Ein neues Roster legen nur Voll-Admins an.");
    if (!may) return apiError(res, 403, "not_manager", "Nur Manager dieses Rosters.");
    try {
        return ok(res, await rosterTakeover.start(guildId, kaderId, body, { actor: String(user.id || ""), createsRoster }));
    } catch (e) {
        return takeoverRefusal(res, e);
    }
});

/**
 * POST /api/kader/takeover/role — body: { kaderId }: "Rolle nachziehen", the
 * role for every player still pending. Rights as the takeover; 409 not_taken /
 * running / role_gone. Answer: `{ count, away }` - the roles go out in the background
 * to the players on the server; `away` pending players are not on it.
 */
const pullTakeoverRole = withUser(WRITE, async ({ req, res, body, user }) => {
    const guildId = activeGuildFor(req);
    const kaderId = str(body, "kaderId");
    const { roster, may } = await takeoverRights(user, guildId, kaderId);
    if (!roster) return apiError(res, 404, "not_found", "Kein Roster zu diesem Kader.");
    if (!may) return apiError(res, 403, "not_manager", "Nur Manager dieses Rosters.");
    try {
        return ok(res, await rosterTakeover.pullRole(guildId, kaderId, { actor: String(user.id || "") }));
    } catch (e) {
        return takeoverRefusal(res, e);
    }
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/kader/roster", handler: getKaderRoster, area: "kader" },
    { method: "POST", path: "/api/kader/roster/sync", handler: syncKaderRoster, area: "kader" },
    { method: "POST", path: "/api/kader/roster/link", handler: linkKaderRoster, area: "kader" },
    { method: "GET", path: "/api/kader/takeover", handler: getTakeover, area: "kader" },
    { method: "POST", path: "/api/kader/takeover", handler: startTakeover, area: "kader" },
    { method: "POST", path: "/api/kader/takeover/role", handler: pullTakeoverRole, area: "kader" },
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
    { method: "PUT", path: "/api/kader/plan", handler: savePlan, area: "kader" },
    { method: "POST", path: "/api/kader/plan/discard", handler: discardPlan, area: "kader" },
    { method: "POST", path: "/api/kader/plan/apply", handler: applyPlan, area: "kader" },
    { method: "POST", path: "/api/kader/accounts", handler: addAccount, area: "kader" },
    { method: "POST", path: "/api/kader/accounts/remove", handler: removeAccount, area: "kader" },
    { method: "PUT", path: "/api/kader/assignments", handler: saveAssignment, area: "kader" },
    { method: "POST", path: "/api/kader/assignments/reset", handler: resetAssignment, area: "kader" },
];

module.exports = {
    getKader, getKaderOnly, getLive, createKader, updateKader, deleteKader, addPlayers, removePlayers, setState,
    saveInterview, completeInterview, reopenInterview, setVote, addComment, deleteComment,
    addQuestion, updateQuestion, deleteQuestion, orderQuestions, copyQuestions,
    addVariant, saveVariant, deleteVariant, autoVariant, savePlan, discardPlan, applyPlan,
    addAccount, removeAccount, saveAssignment, resetAssignment, getKaderRoster, syncKaderRoster, linkKaderRoster,
    getTakeover, startTakeover, pullTakeoverRole, routes,
};
