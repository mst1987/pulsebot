// JSON API of the setup editor (#263) — Raid-Detail › Setup of an own event.
//
//   GET  /api/raids/setup?event=<id>          area raids (read): the orga gets the draft,
//                                              everyone else only the approved lineup
//   POST /api/raids/setup/propose             raids write: new proposal, locked places kept
//   PUT  /api/raids/setup                     raids write: the orga's own lineup
//   POST /api/raids/setup/approve             raids write: approve the shown version — and
//                                              post it into the channel / DM it (#290)
//   POST /api/raids/setup/post                raids write: post or edit the approved setup
//                                              again, send the DMs still outstanding
//   POST /api/raids/setup/explain             raids write: Claude explains it (background job)
//   GET  /api/raids/setup/explain?event=<id>  raids write (checked here): job state
//
// The area gate (apiAccess.js) decides read vs. write by method; the GET of the
// editor additionally asks whether the caller may write, because a draft is
// never handed to someone who could not approve it.
const { ok, error } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { sendFailure, sendResult } = require("../http/apiResult");
const { userCan } = require("../../config/permissions");
const { getConfig } = require("../../stores/settingsStore");
const { getEvent, isOwnEventId, setEventExtraRole, EXTRA_ROLES } = require("../../stores/eventStore");
const { listSignups } = require("../../stores/signupStore");
const discord = require("../../services/discord/discord");
const setupEditor = require("../setupEditor");
const profiles = require("../../stores/raiderProfileStore");
const { refreshEventMessage } = require("../eventMessage");
const setupMessage = require("../setupMessage");
const { saveSetupPingText } = require("../setupPing");
const { setupAttendance } = require("../setupAttendance");
const { postSearch, textForNeeds } = require("../raidSearch");
const { startJob, getJob } = require("../evalJobs");
const { explainSetup } = require("../../utils/setup/explainText");

const EXPLAIN_SECTION = "setup-explain";

const canWrite = (user) => userCan(user, "raids", "write");

async function namesFor(event) {
    const ids = listSignups(event.id).map((s) => s.userId);
    if (!ids.length) return {};
    try {
        return await discord.resolveUserNames(event.guildId, ids);
    } catch {
        return {};
    }
}

/** Attendance of everybody who signed up; a failing read never costs the page. */
function safeAttendance(event) {
    try {
        return setupAttendance([event]);
    } catch {
        return null;
    }
}

/**
 * The editor's payload. Discord names are resolved for the page load only: a
 * member fetch per raider is slow where Discord does not know them yet, and a
 * move must answer at once — the page keeps the names it already has.
 */
async function view(event, user, { names = true } = {}) {
    const write = canWrite(user);
    const signups = write ? listSignups(event.id) : [];
    // Re-read: posting and the DM run write to the event while the request runs.
    const fresh = getEvent(event.id) || event;
    const out = setupEditor.editorView(fresh, {
        canWrite: write,
        names: write && names ? await namesFor(fresh) : {},
        signups,
        hasApiKey: write && !!((getConfig().anthropic || {}).apiKey),
        job: write ? getJob(fresh.id, EXPLAIN_SECTION) : null,
        avoidPairs: write ? setupEditor.avoidPairCount(signups, profiles.listProfiles()) : 0,
        // reads reports and logs — only on the page load, a move must answer at once
        attendance: write && names ? safeAttendance(fresh) : null,
    });
    if (write) out.publish = setupMessage.publishView(fresh, { config: getConfig(), channelName: channelNameOf(fresh) });
    return out;
}

/** The event channel's current name, else the stored one. */
function channelNameOf(event) {
    try {
        const hit = (discord.listAllChannels(event.guildId) || []).find((c) => String(c.id) === String(event.channelId));
        if (hit && hit.name) return hit.name;
    } catch {
        // offline — the stored name stands in
    }
    return event.channelName || "";
}

/** The event of a request, or a sent error. */
function eventOf(res, id) {
    const eventId = String(id || "").trim();
    if (!isOwnEventId(eventId)) {
        error(res, 409, "raidhelper", "Das Setup dieses Events liegt bei Raid-Helper.");
        return null;
    }
    const event = getEvent(eventId);
    if (!event) {
        error(res, 404, "not_found", "Event nicht gefunden.");
        return null;
    }
    return event;
}

/** GET /api/raids/setup?event=<id> */
const getSetup = withUser({}, async ({ user, res, url }) => {
    const event = eventOf(res, url.searchParams.get("event"));
    if (!event) return;
    ok(res, await view(event, user));
});

async function answer(res, result, user, extra = {}) {
    if (result.error) return sendFailure(res, result);
    ok(res, { ...(await view(result.event, user, { names: false })), ...extra });
}

/** POST /api/raids/setup/propose — body `{ event, weights?, fairness?, wishes? }` */
const postPropose = withUser({ write: "raids", csrf: true, body: true }, async ({ user, body, res }) => {
    if (!eventOf(res, body.event)) return;
    const result = setupEditor.proposeEventSetup(String(body.event).trim(), body, { userId: user.id });
    await answer(res, result, user, { message: "Neuer Vorschlag erstellt." });
});

/** PUT /api/raids/setup — body `{ event, version, groups, bench, weights?, fairness?, wishes? }` */
const putSetup = withUser({ write: "raids", csrf: true, body: true }, async ({ user, body, res }) => {
    if (!eventOf(res, body.event)) return;
    const result = setupEditor.saveEventSetup(String(body.event).trim(), body, { userId: user.id });
    await answer(res, result, user);
});

/** POST /api/raids/setup/approve — body `{ event, version }` */
const postApprove = withUser({ write: "raids", csrf: true, body: true }, async ({ user, body, res }) => {
    if (!eventOf(res, body.event)) return;
    const result = setupEditor.approveEventSetup(String(body.event).trim(), { version: body.version, userId: user.id });
    if (result.error) return sendFailure(res, result);
    // The event message shows the approved lineup; a bot that is offline only
    // delays that, it never fails the approval.
    if (!result.already && result.event.message) {
        refreshEventMessage(result.event.id).catch((e) => console.error(`[setup] event message ${result.event.id}:`, e.message));
    }
    let message = result.already ? "Setup war schon freigegeben." : "Setup freigegeben – Raider sehen es jetzt.";
    if (!result.already) {
        // The setup's own message (#290): awaited, so the answer says where it went;
        // the DMs run on in the background and the editor polls their outcome.
        const { post } = await setupMessage.publishSetup(result.event.id, { userId: user.id });
        if (post.code) message = `${message} Setup-Nachricht nicht gepostet: ${post.error}`;
    }
    await answer(res, result, user, { message });
});

/** POST /api/raids/setup/post — body `{ event }`: post/edit the approved setup, send outstanding DMs. */
const postPublish = withUser({ write: "raids", csrf: true, body: true }, async ({ user, body, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    const { post } = await setupMessage.publishSetup(event.id, { userId: user.id });
    if (post.code) return sendFailure(res, post);
    const text = post.action === "edited" ? "Setup-Nachricht aktualisiert." : "Setup gepostet.";
    await answer(res, { event }, user, { message: text });
});

/** POST /api/raids/setup/ping-text — body `{ event, text }`: what "Ping everyone" (and the first post's own ping) sends. */
const postPingText = withUser({ write: "raids", csrf: true, body: true }, async ({ user, body, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    saveSetupPingText(event.id, body.text);
    await answer(res, { event }, user, { message: "Ping-Nachricht gespeichert." });
});

/** POST /api/raids/setup/extra-role — body `{ event, userId, role: "tank"|"healer", on }`: mark a raider as an extra tank / healer, or not any more. */
const postExtraRole = withUser({ write: "raids", csrf: true, body: true }, async ({ user, body, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    const userId = String(body.userId || "").trim();
    if (!EXTRA_ROLES.includes(body.role)) return error(res, 400, "bad_role", "Nur Tank oder Heiler.");
    // only somebody who signed up (or is in the setup) can be marked
    const known = listSignups(event.id).some((x) => x.userId === userId) || JSON.stringify(event.setup || {}).includes(`"userId":"${userId}"`);
    if (!userId || !known) return error(res, 404, "unknown_raider", "Dieser Raider ist nicht angemeldet.");
    const updated = setEventExtraRole(event.id, userId, body.role, body.on === true);
    await answer(res, { event: updated }, user);
});

/** POST /api/raids/setup/search/text — body `{ event, roles, buffs }`: the message for needs the orga edited (nothing is posted). */
const postSearchText = withUser({ write: "raids", csrf: true, body: true }, async ({ body, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    const result = textForNeeds(event, body);
    if (result.error) return sendResult(res, result);
    ok(res, result);
});

/** POST /api/raids/setup/search — body `{ event, text? }`: post the "we are looking for …" message into the event channel. */
const postSearchMessage = withUser({ write: "raids", csrf: true, body: true }, async ({ user, body, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    const result = await postSearch({ guildId: event.guildId, eventId: event.id, userId: user.id, byName: user.username || user.name || "", text: body.text });
    if (result.error) return sendResult(res, result);
    ok(res, result);
});

/** POST /api/raids/setup/explain — body `{ event }`. Needs the Anthropic key. */
const postExplain = withUser({ write: "raids", csrf: true, body: true }, async ({ body, res }) => {
    const event = eventOf(res, body.event);
    if (!event) return;
    const settings = getConfig().anthropic || {};
    if (!settings.apiKey) return error(res, 400, "no_api_key", "Kein Anthropic-API-Key hinterlegt (Einstellungen → Verbindungen → KI-Formulierung).");
    if (!event.setup) return error(res, 400, "no_setup", "Es gibt noch kein Setup zum Erklären.");
    const started = startJob(event.id, EXPLAIN_SECTION, async () => {
        const fresh = getEvent(event.id);
        if (!fresh || !fresh.setup) return { ok: false, error: "Setup nicht mehr vorhanden." };
        const signups = listSignups(fresh.id);
        const decorated = setupEditor.editorView(fresh, { canWrite: true, signups }).setup;
        const { text, model } = await explainSetup(decorated, { event: fresh, signups }, { apiKey: settings.apiKey, model: settings.model || undefined });
        setupEditor.storeExplanation(fresh.id, { text, model, version: fresh.setup.version });
        return { ok: true, id: fresh.id };
    });
    ok(res, { eventId: event.id, status: started.status, alreadyRunning: started.alreadyRunning }, started.alreadyRunning ? 200 : 202);
});

/** GET /api/raids/setup/explain?event=<id> — the job state plus the stored explanation. */
const getExplain = withUser({ write: "raids" }, async ({ res, url }) => {
    const event = eventOf(res, url.searchParams.get("event"));
    if (!event) return;
    ok(res, {
        eventId: event.id,
        job: getJob(event.id, EXPLAIN_SECTION),
        explanation: (event.setup && event.setup.explanation) || null,
        version: (event.setup && event.setup.version) || 0,
    });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/raids/setup", handler: getSetup, area: "raids" },
    { method: "PUT", path: "/api/raids/setup", handler: putSetup, area: "raids" },
    { method: "POST", path: "/api/raids/setup/propose", handler: postPropose, area: "raids" },
    { method: "POST", path: "/api/raids/setup/approve", handler: postApprove, area: "raids" },
    { method: "POST", path: "/api/raids/setup/post", handler: postPublish, area: "raids" },
    { method: "POST", path: "/api/raids/setup/ping-text", handler: postPingText, area: "raids" },
    { method: "POST", path: "/api/raids/setup/extra-role", handler: postExtraRole, area: "raids" },
    { method: "POST", path: "/api/raids/setup/search/text", handler: postSearchText, area: "raids" },
    { method: "POST", path: "/api/raids/setup/search", handler: postSearchMessage, area: "raids" },
    { method: "POST", path: "/api/raids/setup/explain", handler: postExplain, area: "raids" },
    { method: "GET", path: "/api/raids/setup/explain", handler: getExplain, area: "raids" },
];

module.exports = { getSetup, postPropose, putSetup, postApprove, postPublish, postPingText, postExtraRole, postSearchMessage, postSearchText, postExplain, getExplain, EXPLAIN_SECTION, routes };
