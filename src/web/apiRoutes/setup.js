// JSON API of the setup editor (#263) — Raid-Detail › Setup of an own event.
//
//   GET  /api/raids/setup?event=<id>          area raids (read): the orga gets the draft,
//                                              everyone else only the approved lineup
//   POST /api/raids/setup/propose             raids write: new proposal, locked places kept
//   PUT  /api/raids/setup                     raids write: the orga's own lineup
//   POST /api/raids/setup/approve             raids write: approve the shown version
//   POST /api/raids/setup/explain             raids write: Claude explains it (background job)
//   GET  /api/raids/setup/explain?event=<id>  raids write (checked here): job state
//
// The area gate (apiAccess.js) decides read vs. write by method; the GET of the
// editor additionally asks whether the caller may write, because a draft is
// never handed to someone who could not approve it.
const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { userCan } = require("../../config/permissions");
const { getConfig } = require("../settingsStore");
const { getEvent, isOwnEventId } = require("../eventStore");
const { listSignups } = require("../signupStore");
const discord = require("../discord");
const setupEditor = require("../setupEditor");
const { refreshEventMessage } = require("../eventMessage");
const { startJob, getJob } = require("../evalJobs");
const { explainSetup } = require("../../utils/setup/explainText");

const EXPLAIN_SECTION = "setup-explain";
const HTTP = { not_found: 404, raidhelper: 409, conflict: 409, invalid: 400, no_setup: 400 };

const canWrite = (user) => userCan(user, "raids", "write");

function sendFailure(res, result) {
    return error(res, HTTP[result.code] || 400, result.code || "failed", result.error || "Fehlgeschlagen.");
}

async function namesFor(event) {
    const ids = listSignups(event.id).map((s) => s.userId);
    if (!ids.length) return {};
    try {
        return await discord.resolveUserNames(event.guildId, ids);
    } catch {
        return {};
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
    return setupEditor.editorView(event, {
        canWrite: write,
        names: write && names ? await namesFor(event) : {},
        signups,
        hasApiKey: write && !!((getConfig().anthropic || {}).apiKey),
        job: write ? getJob(event.id, EXPLAIN_SECTION) : null,
    });
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
async function getSetup(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const event = eventOf(res, url.searchParams.get("event"));
    if (!event) return;
    ok(res, await view(event, user));
}

/** Refused for a caller without `raids` write — the area gate does this already; kept for direct calls. */
function requireWrite(res, user) {
    if (canWrite(user)) return true;
    error(res, 403, "forbidden", "Keine Schreibrechte für „Raids“.");
    return false;
}

async function answer(res, result, user, extra = {}) {
    if (result.error) return sendFailure(res, result);
    ok(res, { ...(await view(result.event, user, { names: false })), ...extra });
}

/** POST /api/raids/setup/propose — body `{ event, weights?, fairness?, wishes? }` */
async function postPropose(req, res) {
    const user = requireAdmin(req, res);
    if (!user || !requireWrite(res, user)) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    if (!eventOf(res, body.event)) return;
    const result = setupEditor.proposeEventSetup(String(body.event).trim(), body, { userId: user.id });
    await answer(res, result, user, { message: "Neuer Vorschlag erstellt." });
}

/** PUT /api/raids/setup — body `{ event, version, groups, bench, weights?, fairness?, wishes? }` */
async function putSetup(req, res) {
    const user = requireAdmin(req, res);
    if (!user || !requireWrite(res, user)) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    if (!eventOf(res, body.event)) return;
    const result = setupEditor.saveEventSetup(String(body.event).trim(), body, { userId: user.id });
    await answer(res, result, user);
}

/** POST /api/raids/setup/approve — body `{ event, version }` */
async function postApprove(req, res) {
    const user = requireAdmin(req, res);
    if (!user || !requireWrite(res, user)) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    if (!eventOf(res, body.event)) return;
    const result = setupEditor.approveEventSetup(String(body.event).trim(), { version: body.version, userId: user.id });
    if (result.error) return sendFailure(res, result);
    // The event message shows the approved lineup; a bot that is offline only
    // delays that, it never fails the approval.
    if (!result.already && result.event.message) {
        refreshEventMessage(result.event.id).catch((e) => console.error(`[setup] event message ${result.event.id}:`, e.message));
    }
    await answer(res, result, user, { message: result.already ? "Setup war schon freigegeben." : "Setup freigegeben – Raider sehen es jetzt." });
}

/** POST /api/raids/setup/explain — body `{ event }`. Needs the Anthropic key. */
async function postExplain(req, res) {
    const user = requireAdmin(req, res);
    if (!user || !requireWrite(res, user)) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
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
}

/** GET /api/raids/setup/explain?event=<id> — the job state plus the stored explanation. */
async function getExplain(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user || !requireWrite(res, user)) return;
    const event = eventOf(res, url.searchParams.get("event"));
    if (!event) return;
    ok(res, {
        eventId: event.id,
        job: getJob(event.id, EXPLAIN_SECTION),
        explanation: (event.setup && event.setup.explanation) || null,
        version: (event.setup && event.setup.version) || 0,
    });
}

module.exports = { getSetup, postPropose, putSetup, postApprove, postExplain, getExplain, EXPLAIN_SECTION };
