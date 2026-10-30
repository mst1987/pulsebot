// Vermerke (docs/vermerke.md, #979): notes the orga keeps on Discord accounts -
// hint, warning, shadowban, with a reason, a note, the raids, an expiry and the
// history. Area "vermerke" - in no base access, like "kader": full admins and
// whom an admin grants it (docs/permissions.md). GET = read (the list and the
// notes), every change = write plus CSRF; removing for good = full admins only.
//
// Rights hold per server (#925): everything works on the caller's active
// server. An entry of another server is not there (404 not_found) - except a
// shared one, which every server reads and none but its server of origin
// changes; another server may hide it for itself (`/hide`).
//
// GET /api/vermerke/short is the short form for every orga that plans a raid
// (#981): the highest active level and the reasons with their counts - no text,
// no author. It is open to any menu user at the gate and checks itself with the
// one rule for every short-form answer (services/vermerke/vermerkeAccess.js): the
// area "vermerke" (read), the global orga with raids write, or a manager of a
// roster of the active server. Nothing here ever answers the person a note is about: a raider
// and "Ansicht als Raider" get 403 everywhere
// (test/services/vermerke/vermerkeNeverToPerson.test.js).
//
// /api/vermerke/signals* (#982): the hints from the data - proposals the orga
// may turn into a Vermerk or hide, and their thresholds per server.
const { ok, error, sendJson } = require("../http/apiResponse");
const { withUser, ORGA_ONLY } = require("../http/apiHandler");
const { activeGuildFor } = require("../http/activeGuild");
const { q } = require("../http/apiParams");
const notes = require("../../stores/userNotesStore");
const { shortFor } = require("../../services/vermerke/vermerkeShort");
const { searchPeople, recentRaids, membersOf } = require("../../services/vermerke/vermerkePeople");
const { maySeeShort } = require("../../services/vermerke/vermerkeAccess");
const { serverLabel } = require("../../services/discord/guildRoles");
const discord = require("../../services/discord/discord");
const { getConfig, saveConfig } = require("../../stores/settingsStore");
const { IGNORE_KINDS } = require("../../stores/userSignalsStore");
const { signalsFor, ignoreSignal } = require("../../services/vermerke/userSignals");
const { DEFAULT_THRESHOLDS, THRESHOLD_LIMITS, normalizeThresholds, validateThresholds, thresholdsOf } = require("../../services/vermerke/signalRecorder");

const WRITE = { write: "vermerke", csrf: true, body: true };
const MAX_SHORT_IDS = 200;
const NO_SERVER = "Kein aktiver Server.";

/** The name of a server for a shared entry: its label in the settings, else the Discord name. */
function serverNameOf(guildId, config) {
    const label = serverLabel(guildId, config);
    if (label) return label;
    const guild = typeof discord.getGuild === "function" ? discord.getGuild(String(guildId || "")) : null;
    return (guild && String(guild.name || "").trim()) || "";
}

/** The caller's active server, or null after the 400 (a note always belongs to one server). */
function guildOf(req, res) {
    const guildId = String(activeGuildFor(req) || "").trim();
    if (!guildId) {
        error(res, 400, "no_server", NO_SERVER);
        return null;
    }
    return guildId;
}

/** Sends a store refusal (NoteError) as its answer; anything else is thrown on. */
function refuse(res, err) {
    if (err instanceof notes.NoteError) {
        error(res, err.status, err.code, err.message);
        return undefined;
    }
    throw err;
}

/** An entry as the page gets it: the server of origin named for a shared one of another server. */
function entryView(entry, names) {
    const out = { ...entry, active: notes.isActive(entry) && !entry.hidden };
    if (!entry.own) out.originName = names(entry.originGuildId);
    return out;
}

function namer() {
    const config = getConfig();
    const cache = new Map();
    return (guildId) => {
        if (!cache.has(guildId)) cache.set(guildId, serverNameOf(guildId, config));
        return cache.get(guildId);
    };
}

/**
 * GET /api/vermerke - every person with entries this server sees, one line each (no text): who wrote the
 * newest entry, how many come shared from another server, and `left` when the member list says the person
 * is no longer on the server (null when the list is not there).
 */
const getList = withUser(async ({ req, res }) => {
    const guildId = guildOf(req, res);
    if (!guildId) return undefined;
    const now = Date.now();
    const members = await membersOf(guildId);
    const people = Object.entries(notes.listFor(guildId)).map(([userId, p]) => {
        const counted = p.entries.filter((e) => !e.hidden && notes.isActive(e, now));
        let level = null;
        for (const e of counted) if (level === null || notes.levelRank(e.level) > notes.levelRank(level)) level = e.level;
        const reasons = {};
        for (const e of counted) reasons[e.reason] = (reasons[e.reason] || 0) + 1;
        const last = p.entries.reduce((a, e) => (!a || (e.at || 0) > (a.at || 0) ? e : a), null);
        return {
            userId,
            name: p.name,
            level,
            reasons,
            activeCount: counted.length,
            totalCount: p.entries.length,
            lastAt: Math.max(0, ...p.entries.map((e) => e.at || 0)),
            lastByName: (last && last.byName) || "",
            sharedCount: counted.filter((e) => !e.own).length,
            left: members ? !members.has(userId) : null,
        };
    });
    people.sort((a, b) => b.lastAt - a.lastAt);
    // the server it is for, so a page that shows another server (Mitglieder) can tell
    return ok(res, { guildId, guildName: serverNameOf(guildId, getConfig()), people });
});

/** GET /api/vermerke/person?userId= - every entry of one person this server sees, with the notes. */
const getPerson = withUser(async ({ query, req, res }) => {
    const guildId = guildOf(req, res);
    if (!guildId) return undefined;
    const userId = q.snowflake(query, "userId");
    if (!userId) return error(res, 400, "bad_user", "Kein Discord-Konto angegeben.");
    const person = notes.personFor(guildId, userId);
    const names = namer();
    return ok(res, {
        userId,
        name: person.name,
        level: notes.activeLevelFor(guildId, userId),
        entries: person.entries.map((e) => entryView(e, names)).sort((a, b) => b.at - a.at),
    });
});

const fieldsOf = (body) => ({
    level: body.level, reason: body.reason, text: body.text, eventIds: body.eventIds, expiresAt: body.expiresAt, shared: body.shared,
});
const partialFieldsOf = (body) => Object.fromEntries(Object.entries(fieldsOf(body)).filter(([, v]) => v !== undefined));
const byOf = (user) => ({ by: String(user.id || ""), byName: String(user.name || "") });

/** POST /api/vermerke { userId, name, level, reason, text?, eventIds?, expiresAt?, shared? } - a new entry. */
const postEntry = withUser(WRITE, async ({ user, body, req, res }) => {
    const guildId = guildOf(req, res);
    if (!guildId) return undefined;
    const userId = q.snowflake(body, "userId");
    if (!userId) return error(res, 400, "bad_user", "Kein Discord-Konto angegeben.");
    try {
        const entry = notes.addEntry(guildId, userId, fieldsOf(body), { ...byOf(user), name: q.str(body, "name", { max: 100 }) });
        return ok(res, { entry: { ...entry, own: true, originGuildId: guildId, hidden: false } }, 201);
    } catch (err) {
        return refuse(res, err);
    }
});

/** POST /api/vermerke/update { userId, id, ...fields } - changes an entry of this server. */
const postUpdate = withUser(WRITE, async ({ user, body, req, res }) => {
    const guildId = guildOf(req, res);
    if (!guildId) return undefined;
    try {
        const entry = notes.updateEntry(guildId, q.str(body, "userId"), q.str(body, "id"), partialFieldsOf(body), byOf(user));
        return ok(res, { entry });
    } catch (err) {
        return refuse(res, err);
    }
});

/** POST /api/vermerke/archive { userId, id, archived? } - archives (default) or restores an entry of this server. */
const postArchive = withUser(WRITE, async ({ user, body, req, res }) => {
    const guildId = guildOf(req, res);
    if (!guildId) return undefined;
    try {
        const entry = notes.archiveEntry(guildId, q.str(body, "userId"), q.str(body, "id"), { archived: q.bool(body, "archived", true), ...byOf(user) });
        return ok(res, { entry });
    } catch (err) {
        return refuse(res, err);
    }
});

/** POST /api/vermerke/hide { id, hidden? } - hides (default) or shows again a shared entry of another server here. */
const postHide = withUser(WRITE, async ({ user, body, req, res }) => {
    const guildId = guildOf(req, res);
    if (!guildId) return undefined;
    try {
        const hidden = q.bool(body, "hidden", true);
        notes.hideShared(guildId, q.str(body, "id"), { hidden, ...byOf(user) });
        return ok(res, { id: q.str(body, "id"), hidden });
    } catch (err) {
        return refuse(res, err);
    }
});

/** POST /api/vermerke/delete { userId, id } - removes an entry of the active server for good (full admins only). */
const postDelete = withUser({ full: true, csrf: true, body: true }, async ({ body, req, res }) => {
    const guildId = guildOf(req, res);
    if (!guildId) return undefined;
    try {
        notes.removeEntry(guildId, q.str(body, "userId"), q.str(body, "id"));
        return ok(res, { removed: true });
    } catch (err) {
        return refuse(res, err);
    }
});

/** GET /api/vermerke/people?q= - the person search of the dialog: members and who left (earlier signups). */
const getPeople = withUser(async ({ query, req, res }) => {
    const guildId = guildOf(req, res);
    if (!guildId) return undefined;
    return ok(res, await searchPeople(guildId, q.str(query, "q", { max: 100 })));
});

/** GET /api/vermerke/raids?userId= - the raids of the last four weeks, `signed` for those the person signed up for. */
const getRaids = withUser(async ({ query, req, res }) => {
    const guildId = guildOf(req, res);
    if (!guildId) return undefined;
    return ok(res, { raids: recentRaids(guildId, q.snowflake(query, "userId") || "") });
});

/**
 * GET /api/vermerke/short?userIds=a,b - level and reason counts per person, for the orga that plans.
 * Gate: the one rule of every short form (services/vermerke/vermerkeAccess.js).
 */
const getShort = withUser(async ({ user, query, req, res }) => {
    const guildId = guildOf(req, res);
    if (!guildId) return undefined;
    if (!(await maySeeShort(user, guildId, { req }))) return error(res, 403, "orga_only", ORGA_ONLY);
    const userIds = q.str(query, "userIds").split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_SHORT_IDS);
    return ok(res, { short: shortFor(guildId, userIds) });
});

/**
 * GET /api/vermerke/signals - the hints from the data (#982): persons over a threshold of the active
 * server, newest first, with the thresholds in use. Proposals only - the bot never makes a Vermerk.
 */
const getSignals = withUser(async ({ req, res }) => {
    const guildId = guildOf(req, res);
    if (!guildId) return undefined;
    const config = getConfig();
    return ok(res, { signals: signalsFor(guildId, { config }), thresholds: thresholdsOf(guildId, { config }) });
});

/** POST /api/vermerke/signals/ignore { userId, kind } - "Ausblenden" until a new event of that kind. */
const postSignalIgnore = withUser(WRITE, async ({ body, req, res }) => {
    const guildId = guildOf(req, res);
    if (!guildId) return undefined;
    const userId = q.snowflake(body, "userId");
    if (!userId) return error(res, 400, "bad_user", "Kein Discord-Konto angegeben.");
    const kind = q.str(body, "kind");
    if (!IGNORE_KINDS.includes(kind)) return error(res, 400, "bad_kind", "Unbekannte Art von Hinweis.");
    return ok(res, { ignored: ignoreSignal(guildId, userId, kind) });
});

/** The thresholds of a server as the settings get them: in use, own values, defaults and ranges. */
function thresholdView(guildId, config) {
    return {
        guildId,
        thresholds: thresholdsOf(guildId, { config }),
        own: normalizeThresholds(((config.serverSettings || {})[guildId] || {}).vermerkeSignals),
        defaults: DEFAULT_THRESHOLDS,
        limits: THRESHOLD_LIMITS,
    };
}

/** GET /api/vermerke/signals/settings - the thresholds of the hints on the active server. */
const getSignalSettings = withUser(async ({ req, res }) => {
    const guildId = guildOf(req, res);
    if (!guildId) return undefined;
    return ok(res, thresholdView(guildId, getConfig()));
});

/**
 * POST /api/vermerke/signals/settings { thresholds, serverSettingsGuildId } - the server's own
 * thresholds (replaces them; a value left out, null or "" is the default again). A value that is no
 * whole number in its range: 400 `bad_threshold` with `fields` (the keys), nothing saved.
 */
const postSignalSettings = withUser(WRITE, async ({ body, req, res }) => {
    const guildId = guildOf(req, res);
    if (!guildId) return undefined;
    if (String(body.serverSettingsGuildId || "") !== guildId) {
        return error(res, 409, "server_switched", "Der aktive Server wurde inzwischen gewechselt. Bitte die Seite neu laden.");
    }
    const checked = validateThresholds(body.thresholds);
    if (checked.fields.length) {
        return sendJson(res, 400, { error: { code: "bad_threshold", message: "Ungültiger Schwellenwert – jede Zahl muss ganz sein und in ihrem Bereich liegen.", fields: checked.fields } });
    }
    saveConfig({ serverSettings: { [guildId]: { vermerkeSignals: checked.value } } });
    return ok(res, thresholdView(guildId, getConfig()));
});

const routes = [
    { method: "GET", path: "/api/vermerke", handler: getList, area: "vermerke" },
    { method: "POST", path: "/api/vermerke", handler: postEntry, area: "vermerke" },
    { method: "GET", path: "/api/vermerke/person", handler: getPerson, area: "vermerke" },
    { method: "GET", path: "/api/vermerke/people", handler: getPeople, area: "vermerke" },
    { method: "GET", path: "/api/vermerke/raids", handler: getRaids, area: "vermerke" },
    { method: "POST", path: "/api/vermerke/update", handler: postUpdate, area: "vermerke" },
    { method: "POST", path: "/api/vermerke/archive", handler: postArchive, area: "vermerke" },
    { method: "POST", path: "/api/vermerke/hide", handler: postHide, area: "vermerke" },
    { method: "POST", path: "/api/vermerke/delete", handler: postDelete, area: "vermerke" },
    { method: "GET", path: "/api/vermerke/short", handler: getShort, auth: "menu" },
    { method: "GET", path: "/api/vermerke/signals", handler: getSignals, area: "vermerke" },
    { method: "POST", path: "/api/vermerke/signals/ignore", handler: postSignalIgnore, area: "vermerke" },
    { method: "GET", path: "/api/vermerke/signals/settings", handler: getSignalSettings, area: "vermerke" },
    { method: "POST", path: "/api/vermerke/signals/settings", handler: postSignalSettings, area: "vermerke" },
];

module.exports = {
    routes, getList, getPerson, getPeople, getRaids, postEntry, postUpdate, postArchive, postHide, postDelete, getShort, serverNameOf,
    getSignals, postSignalIgnore, getSignalSettings, postSignalSettings,
};
