// JSON API of the raid plan ("Raidplan", docs/raidplan.md) — the board editor on
// the detail page of an own event, its tactic profiles and the public read view.
//
//   GET    /api/raidplan?event=<id>           raids read: plan, bosses, players, profiles
//   PUT    /api/raidplan                      raids write: save the bosses (version-checked)
//   POST   /api/raidplan/publish              raids write: publish / withdraw / new link
//   POST   /api/raidplan/map?key=<key>        raids write: upload a room map (raw PNG/JPG/WebP body)
//   POST   /api/raidplan/map/delete           raids write: remove a room map
//   POST   /api/raidplan/apply                raids write: copy a template into the plan (snapshot,
//                                              open slots filled from the approved setup)
//   GET    /api/raidplan/templates            raids read: all raid plan templates with their boards
//   POST   /api/raidplan/templates            raids write: create a template
//   PATCH  /api/raidplan/templates            raids write: change fields and/or boards (version-checked)
//   POST   /api/raidplan/templates/duplicate  raids write: a copy of a template (boards and maps)
//   DELETE /api/raidplan/templates            raids write: delete a template and its maps (body { id })
//   GET    /api/raidplan/profiles             raids read: all tactic profiles
//   POST   /api/raidplan/profiles             raids write: create a profile
//   PATCH  /api/raidplan/profiles             raids write: change / rename a profile
//   DELETE /api/raidplan/profiles             raids write: delete a profile
//   GET    /api/raidplan/public?token=<token> NO login — the token is the authentication
//
// The area gate (apiAccess.js) decides read vs. write by method. The public route
// is listed in UNGATED there; it hands out only what /p/<token> shows.
const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody, readRawBody } = require("../apiBody");
const { userCan } = require("../../config/permissions");
const auth = require("../auth");
const { getEvent, isOwnEventId } = require("../eventStore");
const store = require("../raidplanStore");
const profileStore = require("../raidplanProfileStore");
const templateStore = require("../raidplanTemplateStore");
const raidplan = require("../raidplan");
const assign = require("../raidplanAssign");

const HTTP = { not_found: 404, conflict: 409, invalid: 400, too_large: 413 };

const canWrite = (user) => userCan(user, "raids", "write");

function sendFailure(res, result) {
    return error(res, HTTP[result.code] || 400, result.code || "failed", result.error || "Fehlgeschlagen.");
}

/** The own event of a request, or a sent error. */
function eventOf(res, id) {
    const eventId = String(id || "").trim();
    if (!isOwnEventId(eventId)) {
        error(res, 409, "raidhelper", "Der Raidplan gibt es nur für eigene Events.");
        return null;
    }
    const event = getEvent(eventId);
    if (!event) {
        error(res, 404, "not_found", "Event nicht gefunden.");
        return null;
    }
    return event;
}

/** Refused for a caller without `raids` write — the area gate does this already; kept for direct calls. */
function requireWrite(res, user) {
    if (canWrite(user)) return true;
    error(res, 403, "forbidden", "Keine Schreibrechte für „Raids“.");
    return false;
}

/** The user of a mutating call: menu access, write right, CSRF. Null (answered) otherwise. */
function writer(req, res) {
    const user = requireAdmin(req, res);
    if (!user || !requireWrite(res, user)) return null;
    if (!requireCsrf(req, res)) return null;
    return user;
}

/** GET /api/raidplan?event=<id> */
function getPlan(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const event = eventOf(res, url.searchParams.get("event"));
    if (!event) return;
    ok(res, raidplan.editorView(event, { canWrite: canWrite(user) }));
}

/** PUT /api/raidplan — body `{ event, version, bosses }` */
async function putPlan(req, res) {
    const user = writer(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const event = eventOf(res, body.event);
    if (!event) return;
    const result = store.savePlan(event.id, { version: body.version, bosses: body.bosses }, {
        bossKeys: raidplan.bossList(event).map((b) => b.key),
        allowedUserIds: raidplan.editorRoster(event).map((p) => p.userId),
        profileIds: profileStore.listProfiles().map((p) => p.id),
        userId: user.id,
    });
    if (result.error) return sendFailure(res, result);
    ok(res, { ...raidplan.editorView(event, { canWrite: true }), dropped: result.dropped });
}

/**
 * POST /api/raidplan/suggest — body `{ event?, type, slots }`: suggested assignments of one
 * type from the board's placeholder slots and (with an event) its lineup. Nothing is saved;
 * the editor shows them marked as a suggestion. An unknown type answers an empty list.
 */
async function postSuggest(req, res) {
    const user = writer(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    let event = null;
    if (body.event) { event = eventOf(res, body.event); if (!event) return; }
    const type = String(body.type || "");
    ok(res, { assignments: assign.SUGGESTABLE.includes(type) ? raidplan.suggestFor(type, { event, slots: body.slots, roles: body.roles }) : [] });
}

/** POST /api/raidplan/publish — body `{ event, published, rotate? }` */
async function postPublish(req, res) {
    const user = writer(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const event = eventOf(res, body.event);
    if (!event) return;
    store.setPublished(event.id, body.published === true, { rotate: body.rotate === true, userId: user.id });
    ok(res, raidplan.editorView(event, { canWrite: true }));
}

/**
 * Whether a map key may be written: a default map always, a template's map only for
 * a template that exists, an event plan's map only for an own event. Sends the error.
 */
function mapKeyOk(res, key) {
    if (!store.isMapKey(key)) { error(res, 400, "invalid", "Unbekannter Boss oder Instanz."); return false; }
    const scope = store.mapScope(key);
    if (!scope) return true;
    const found = scope.scope === "t" ? templateStore.getTemplate(scope.id) : isOwnEventId(scope.id) && getEvent(scope.id);
    if (!found) { error(res, 404, "not_found", scope.scope === "t" ? "Vorlage nicht gefunden." : "Event nicht gefunden."); return false; }
    return true;
}

/** POST /api/raidplan/map?key=<key> — the body is the image itself. */
async function postMap(req, res, url) {
    const user = writer(req, res);
    if (!user) return;
    const key = String(url.searchParams.get("key") || "").trim();
    if (!mapKeyOk(res, key)) return;
    const buffer = await readRawBody(req, store.LIMITS.mapBytes);
    if (buffer === null) return error(res, 413, "too_large", "Das Bild ist größer als 3 MB.");
    const result = store.saveMap(key, buffer);
    if (result.error) return sendFailure(res, result);
    ok(res, { key });
}

/** POST /api/raidplan/map/delete — body `{ key }` */
async function postMapDelete(req, res) {
    const user = writer(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const key = String(body.key || "").trim();
    if (!mapKeyOk(res, key)) return;
    ok(res, { key, removed: store.deleteMap(key) });
}

/** POST /api/raidplan/apply — body `{ event, templateId, version }` */
async function postApply(req, res) {
    const user = writer(req, res);
    if (!user) return;
    const body = await readJsonBody(req);
    const event = eventOf(res, body.event);
    if (!event) return;
    const template = templateStore.getTemplate(body.templateId);
    if (!template || !raidplan.templatesFor(event).some((t) => t.id === template.id)) return error(res, 404, "not_found", "Vorlage nicht gefunden.");
    const result = store.applyTemplate(event.id, template, {
        version: body.version,
        bossKeys: raidplan.bossList(event).map((b) => b.key),
        roster: raidplan.editorRoster(event),
        userId: user.id,
    });
    if (result.error) return sendFailure(res, result);
    ok(res, raidplan.editorView(event, { canWrite: true }));
}

function templateList() {
    return { templates: templateStore.listTemplates().map(raidplan.templateView) };
}

/** GET /api/raidplan/templates */
function getTemplates(req, res) {
    if (!requireAdmin(req, res)) return;
    ok(res, templateList());
}

/** POST /api/raidplan/templates — body `{ name, category?, description?, guildId?, instanceIds }` */
async function postTemplate(req, res) {
    if (!writer(req, res)) return;
    const result = templateStore.createTemplate(await readJsonBody(req));
    if (result.error) return sendFailure(res, result);
    ok(res, { ...templateList(), template: raidplan.templateView(result.template) });
}

/** PATCH /api/raidplan/templates — body `{ id, name?, category?, description?, guildId?, instanceIds?, bosses?, version? }` */
async function patchTemplate(req, res) {
    if (!writer(req, res)) return;
    const body = await readJsonBody(req);
    const result = templateStore.updateTemplate(body.id, body);
    if (result.error) return sendFailure(res, result);
    ok(res, { ...templateList(), template: raidplan.templateView(result.template), dropped: result.dropped });
}

/** POST /api/raidplan/templates/duplicate — body `{ id }` */
async function postTemplateDuplicate(req, res) {
    if (!writer(req, res)) return;
    const result = templateStore.duplicateTemplate((await readJsonBody(req)).id);
    if (result.error) return sendFailure(res, result);
    ok(res, { ...templateList(), template: raidplan.templateView(result.template) });
}

/** DELETE /api/raidplan/templates — body `{ id }` */
async function deleteTemplate(req, res) {
    if (!writer(req, res)) return;
    const body = await readJsonBody(req);
    if (!templateStore.deleteTemplate(body.id)) return error(res, 404, "not_found", "Vorlage nicht gefunden.");
    ok(res, templateList());
}

function profileList() {
    const profiles = profileStore.listProfiles();
    return { profiles, categories: profileStore.categories(profiles) };
}

/** GET /api/raidplan/profiles */
function getProfiles(req, res) {
    if (!requireAdmin(req, res)) return;
    ok(res, profileList());
}

/** POST /api/raidplan/profiles — body `{ name, category?, bossKey?, targets?, notes? }` */
async function postProfile(req, res) {
    if (!writer(req, res)) return;
    const result = profileStore.createProfile(await readJsonBody(req));
    if (result.error) return sendFailure(res, result);
    ok(res, { ...profileList(), profile: result.profile });
}

/** PATCH /api/raidplan/profiles — body `{ id, name?, category?, bossKey?, targets?, notes? }` */
async function patchProfile(req, res) {
    if (!writer(req, res)) return;
    const body = await readJsonBody(req);
    const result = profileStore.updateProfile(body.id, body);
    if (result.error) return sendFailure(res, result);
    ok(res, { ...profileList(), profile: result.profile });
}

/** DELETE /api/raidplan/profiles — body `{ id }` */
async function deleteProfile(req, res) {
    if (!writer(req, res)) return;
    const body = await readJsonBody(req);
    if (!profileStore.deleteProfile(body.id)) return error(res, 404, "not_found", "Profil nicht gefunden.");
    ok(res, profileList());
}

/**
 * GET /api/raidplan/public?token=<token> — no login. An unknown token, an
 * unpublished plan and a plan whose event is gone all answer the same 404.
 * A logged-in viewer's own userId only marks their token; it grants nothing.
 */
function getPublic(req, res, url) {
    const plan = store.getPublishedByToken(url.searchParams.get("token"));
    const event = plan && getEvent(plan.eventId);
    if (!plan || !event) return error(res, 404, "not_found", "Diesen Raidplan gibt es nicht (mehr).");
    const viewer = auth.getUser(req);
    ok(res, raidplan.publicView(plan, event, { me: viewer ? viewer.id : "" }));
}

module.exports = {
    getPlan, putPlan, postSuggest, postPublish, postMap, postMapDelete,
    getProfiles, postProfile, patchProfile, deleteProfile, getPublic,
    postApply, getTemplates, postTemplate, patchTemplate, deleteTemplate, postTemplateDuplicate,
};
