// JSON API of the raid plan ("Raidplan", docs/raidplan.md) — the board editor on
// the detail page of an own event, its tactic profiles and the public read view.
//
//   GET    /api/raidplan?event=<id>           raidplan read: plan, bosses, players, profiles
//   PUT    /api/raidplan                      raidplan write: save the bosses (version-checked)
//   POST   /api/raidplan/publish              raidplan write: publish / withdraw / new link
//   POST   /api/raidplan/groups               raidplan write: "Gruppen im Plan" (#529), the setup groups the plan picks from
//   POST   /api/raidplan/map?key=<key>        raidplan write: upload a room map (raw PNG/JPG/WebP body)
//   POST   /api/raidplan/map/delete           raidplan write: remove a room map
//   POST   /api/raidplan/apply                raidplan write: copy a template into the plan (snapshot,
//                                              open slots filled from the approved setup)
//   GET    /api/raidplan/templates            raidplan read: all raid plan templates with their boards
//   POST   /api/raidplan/templates            raidplan write: create a template
//   PATCH  /api/raidplan/templates            raidplan write: change fields and/or boards (version-checked)
//   POST   /api/raidplan/templates/duplicate  raidplan write: a copy of a template (boards and maps)
//   DELETE /api/raidplan/templates            raidplan write: delete a template and its maps (body { id })
//   GET    /api/raidplan/profiles             raidplan read: all tactic profiles
//   POST   /api/raidplan/profiles             raidplan write: create a profile
//   PATCH  /api/raidplan/profiles             raidplan write: change / rename a profile
//   DELETE /api/raidplan/profiles             raidplan write: delete a profile
//   GET    /api/raidplan/public?token=<token> NO login — the token is the authentication
//   GET    /api/raidplan/progress?token=<token> | ?event=<id>  what the linked log shows down / fought / next (#534):
//                                             with a token like /public (no login), with an event raidplan read
//   GET    /api/raidplan/link?event=<id>      raidplan read: a Raid-Helper event's switch and what its title suggests
//   POST   /api/raidplan/link                 raidplan write: switch a Raid-Helper event's plan on / off (instances, size, version)
//
// A Raid-Helper event has a plan once the orga switched it on (docs/raidplan.md, "Raid-Helper-Events"); its players come from
// Raid-Helper (raidplanRosterSource.js, read only), everything else works as for an own event.
//
// Everything here is area "raidplan", not "raids": the tactics go to their own
// people (docs/permissions.md). The area gate (apiAccess.js) decides read vs.
// write by method. The public route is listed in UNGATED there; it hands out
// only what /p/<token> shows.
const { ok, okWithEtag, error } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { readRawBody } = require("../http/apiBody");
const { sendFailure } = require("../http/apiResult");
const { userCan, userIsOrga } = require("../../config/permissions");
const auth = require("../http/auth");
const { getEvent, isOwnEventId } = require("../../stores/eventStore");
const store = require("../../stores/raidplanStore");
const profileStore = require("../../stores/raidplanProfileStore");
const templateStore = require("../../stores/raidplanTemplateStore");
const raidplan = require("../raidplan/raidplan");
const assign = require("../../services/raidplan/raidplanAssign");
const catalog = require("../../stores/raidplanCatalogStore");
const rosterSource = require("../raidplan/raidplanRosterSource");
const { instancesFromTitle } = require("../raidplan/raidplanTitle");
const { activeGuildFor } = require("../http/activeGuild");
const { loadEventGroups, eventLookbackSince } = require("../../services/events/raidEventGroups");
const { rulesFor } = require("../../config/gameVersions");
const { mainVersionFor, versionOfEvent, knownVersion, visibleRows, visibleVersions } = require("../../services/events/mainVersion");
const { raidhelperDisabled } = require("../../utils/raidhelper/client");
const { progressFor } = require("../../services/raidplan/raidplanProgress");
const { syncRaidplanPost } = require("../../services/raidplan/raidplanPost");
const { getConfig } = require("../../stores/configStore");
const { planningRefusal } = require("../../services/events/planning");

// A write on an event plan: an archived event (a hidden game version, #563) is read only.
const BY_EVENT = (body) => body.event;
const { archiveOf } = require("../../services/events/eventArchive");
const { userSeesEvent } = require("../../services/signups/eventVisibility");

const canWrite = (user) => userCan(user, "raidplan", "write");

/**
 * The event of a request's plan (raidplanRosterSource.planEventFor): an own event, or a Raid-Helper event whose plan is switched on -
 * `{ kind, event, ... }`. A Raid-Helper event without the switch answers 409, an unknown event 404; null then (the error is sent).
 */
async function eventOf(res, id, opts) {
    const eventId = String(id || "").trim();
    const found = await rosterSource.planEventFor(eventId, opts);
    if (found && found.event) return found;
    if (!isOwnEventId(eventId) && /^[\w-]{3,40}$/.test(eventId)) {
        error(res, 409, "raidhelper", "Der Raidplan ist für dieses Raid-Helper-Event nicht aktiviert (Verwalten → Raidplan aktivieren).");
        return null;
    }
    error(res, 404, "not_found", "Event nicht gefunden.");
    return null;
}

/** A Raid-Helper plan's save remembers the line-up it was saved with - only when Raid-Helper just answered (see rosterSource). */
function knownRosterOf(found) {
    return found.kind === "raidhelper" && found.info.authoritative ? found.loaded : null;
}


/** GET /api/raidplan?event=<id>[&fresh=1] — `fresh` asks Raid-Helper again now ("Neu laden") instead of the minute's cache. */
const getPlan = withUser({}, async ({ user, req, res, url }) => {
    // a raid of a category the raider may not see answers like an unknown one (eventVisibility.js); the orga passes at once
    const eventId = String(url.searchParams.get("event") || "").trim();
    if (!userIsOrga(user)) {
        const own = isOwnEventId(eventId) ? getEvent(eventId) : null;
        const guildId = own ? own.guildId || "" : activeGuildFor(req);
        const loadGroups = () => loadEventGroups(guildId, { sinceSeconds: eventLookbackSince() });
        if (!(await userSeesEvent(user, { guildId, eventId, loadGroups }))) return error(res, 404, "not_found", "Event nicht gefunden.");
    }
    const found = await eventOf(res, eventId, { fresh: url.searchParams.get("fresh") === "1" });
    if (!found) return;
    // An archived event (a hidden game version, #563) opens read only, whatever the caller may do.
    const archived = archiveOf(found.event);
    ok(res, { ...raidplan.editorView(found.event, { canWrite: canWrite(user) && !archived, me: user && user.id ? String(user.id) : "" }), archived });
});

/** PUT /api/raidplan — body `{ event, version, bosses }` */
const putPlan = withUser({ write: "raidplan", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, res }) => {
    const found = await eventOf(res, body.event);
    if (!found) return;
    const event = found.event;
    const result = store.savePlan(event.id, { version: body.version, bosses: body.bosses }, {
        bossKeys: raidplan.planKeys(event),
        // a Raid-Helper line-up that could not be loaded right now drops nobody
        allowedUserIds: rosterSource.allowedFor(found),
        profileIds: profileStore.listProfiles().map((p) => p.id),
        userId: user.id,
        knownRoster: knownRosterOf(found),
    });
    if (result.error) return sendFailure(res, result);
    ok(res, { ...raidplan.editorView(await refreshed(found), { canWrite: true }), dropped: result.dropped });
});

/**
 * POST /api/raidplan/suggest — body `{ event?, type, slots, roles?, keep?, preferredRole?, context?, spellId? }` (`spellId`: the row's
 * spell, the row dialog's wand of a debuff / blessing / aura / totem row, #536; `preferredRole`: the row's
 * role, `context`: the board's rows of the other types, so the ranking knows who tanks and who has how many tasks; `keep`: the rows of that type made by hand; the
 * raiders they name are taken, the class-based suggestions go round the others): suggested assignments of one
 * type from the board's placeholder slots and (with an event) its lineup. Nothing is saved;
 * the editor shows them marked as a suggestion. An unknown type answers an empty list.
 */
const postSuggest = withUser({ write: "raidplan", csrf: true, body: true, archived: BY_EVENT }, async ({ body, res }) => {
    let event;
    if (body.event) { const found = await eventOf(res, body.event); if (!found) return; event = found.event; }
    const type = String(body.type || "");
    ok(res, { assignments: assign.SUGGESTABLE.includes(type) ? raidplan.suggestFor(type, { event, versionId: String(body.versionId || ""), slots: body.slots, roles: body.roles, preferredClasses: body.preferredClasses, allowOthers: body.allowOthers, keep: body.keep, preferredRole: body.preferredRole, context: body.context, spellId: body.spellId }) : [] });
});

/** POST /api/raidplan/publish — body `{ event, published, rotate? }` */
const postPublish = withUser({ write: "raidplan", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, res }) => {
    const found = await eventOf(res, body.event);
    if (!found) return;
    store.setPublished(found.event.id, body.published === true, { rotate: body.rotate === true, userId: user.id });
    // A posted read link follows (#537): new token in, withdrawn share out.
    await syncRaidplanPost(found.event);
    ok(res, raidplan.editorView(await refreshed(found), { canWrite: true }));
});

/**
 * POST /api/raidplan/groups — body `{ event, includedGroups }` ("Gruppen im Plan", #529): the group numbers and "bench" the plan picks its
 * raiders from, `null` = back to the default (the groups up to the raid's size). Written at once, no version step (the unsaved draft
 * of the boards stays valid); only valid values are kept. Answers the stored value and the one in effect.
 */
const postGroups = withUser({ write: "raidplan", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, res }) => {
    const found = await eventOf(res, body.event);
    if (!found) return;
    const raw = body.includedGroups === null ? null : Array.isArray(body.includedGroups) ? body.includedGroups : undefined;
    if (raw === undefined) return error(res, 400, "invalid", "Ungültige Gruppenauswahl.");
    const result = store.setIncludedGroups(found.event.id, raw, { userId: user.id });
    if (result.error) return sendFailure(res, result);
    ok(res, { includedGroups: result.plan.includedGroups || null, included: raidplan.planIncluded(found.event, result.plan) });
});

/** The event of a request again after a write: the plan changed (a Raid-Helper event's gone raiders are read from it). */
async function refreshed(found) {
    if (found.kind !== "raidhelper") return found.event;
    const again = await rosterSource.planEventFor(found.event.id);
    return again && again.event ? again.event : found.event;
}

/** Whether an event may have a plan's own maps: an own event that exists, a Raid-Helper event whose plan is switched on. */
function eventHasPlan(id) {
    if (isOwnEventId(id)) return !!getEvent(id);
    const plan = store.getPlan(id);
    return !!(plan && plan.link && plan.link.enabled);
}

/**
 * Whether a map key may be written: a default map always, a template's map only for
 * a template that exists, an event plan's map only for an event that has a plan. Sends the error.
 */
function mapKeyOk(res, key) {
    if (!store.isMapKey(key)) { error(res, 400, "invalid", "Unbekannter Boss oder Instanz."); return false; }
    const scope = store.mapScope(key);
    if (!scope) return true;
    const found = scope.scope === "t" ? templateStore.getTemplate(scope.id) : eventHasPlan(scope.id);
    if (!found) { error(res, 404, "not_found", scope.scope === "t" ? "Vorlage nicht gefunden." : "Event nicht gefunden."); return false; }
    return true;
}

/** POST /api/raidplan/map?key=<key> — the body is the image itself. */
const postMap = withUser({ write: "raidplan", csrf: true }, async ({ req, res, url }) => {
    const key = String(url.searchParams.get("key") || "").trim();
    if (!mapKeyOk(res, key)) return;
    const buffer = await readRawBody(req, store.LIMITS.mapBytes);
    if (buffer === null) return error(res, 413, "too_large", "Das Bild ist größer als 3 MB.");
    const result = store.saveMap(key, buffer);
    if (result.error) return sendFailure(res, result);
    ok(res, { key });
});

/** POST /api/raidplan/map/delete — body `{ key }` */
const postMapDelete = withUser({ write: "raidplan", csrf: true, body: true }, async ({ body, res }) => {
    const key = String(body.key || "").trim();
    if (!mapKeyOk(res, key)) return;
    ok(res, { key, removed: store.deleteMap(key) });
});

/**
 * POST /api/raidplan/apply — body `{ event, templateId, version, otherVersion? }`. A template of another game version than the event's
 * (#544) is only applied with `otherVersion: true` (the editor asks first); without it the answer is 409 `version_mismatch`.
 */
const postApply = withUser({ write: "raidplan", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, res }) => {
    const found = await eventOf(res, body.event);
    if (!found) return;
    const event = found.event;
    const template = templateStore.getTemplate(body.templateId);
    if (!template || !raidplan.templatesFor(event, { allVersions: true }).some((t) => t.id === template.id)) return error(res, 404, "not_found", "Vorlage nicht gefunden.");
    if (template.versionId !== raidplan.planVersion(event) && body.otherVersion !== true) return error(res, 409, "version_mismatch", "Die Vorlage gehört zu einer anderen Spielversion als das Event.");
    const result = store.applyTemplate(event.id, template, {
        version: body.version,
        bossKeys: raidplan.planKeys(event),
        // the open slots are filled from who is in the line-up now (a raider Raid-Helper no longer lists is not placed anew)
        roster: found.kind === "raidhelper" ? found.loaded : raidplan.editorRoster(event),
        // ... but only from the groups in the plan (#529): a bench raider never takes a place of the template
        fillIncluded: raidplan.planIncluded(event, store.getPlan(event.id)),
        userId: user.id,
        trackKnown: !!knownRosterOf(found),
    });
    if (result.error) return sendFailure(res, result);
    ok(res, raidplan.editorView(await refreshed(found), { canWrite: true }));
});

function templateList() {
    // Other versions hidden (#563): their plan templates stay out.
    return { templates: visibleRows(templateStore.listTemplates(), (t) => t.versionId).map(raidplan.templateView) };
}

/** GET /api/raidplan/templates */
const getTemplates = withUser({}, async ({ res }) => {
    ok(res, templateList());
});

/** POST /api/raidplan/templates — body `{ name, category?, description?, guildId?, instanceIds }` */
const postTemplate = withUser({ write: "raidplan", csrf: true, body: true }, async ({ body, res }) => {
    const result = templateStore.createTemplate(body);
    if (result.error) return sendFailure(res, result);
    ok(res, { ...templateList(), template: raidplan.templateView(result.template) });
});

/** PATCH /api/raidplan/templates — body `{ id, name?, category?, description?, guildId?, instanceIds?, bosses?, version? }` */
const patchTemplate = withUser({ write: "raidplan", csrf: true, body: true }, async ({ body, res }) => {
    const result = templateStore.updateTemplate(body.id, body);
    if (result.error) return sendFailure(res, result);
    ok(res, { ...templateList(), template: raidplan.templateView(result.template), dropped: result.dropped });
});

/** POST /api/raidplan/templates/duplicate — body `{ id }` */
const postTemplateDuplicate = withUser({ write: "raidplan", csrf: true, body: true }, async ({ body, res }) => {
    const result = templateStore.duplicateTemplate(body.id);
    if (result.error) return sendFailure(res, result);
    ok(res, { ...templateList(), template: raidplan.templateView(result.template) });
});

/** DELETE /api/raidplan/templates — body `{ id }` */
const deleteTemplate = withUser({ write: "raidplan", csrf: true, body: true }, async ({ body, res }) => {
    if (!templateStore.deleteTemplate(body.id)) return error(res, 404, "not_found", "Vorlage nicht gefunden.");
    ok(res, templateList());
});

function profileList() {
    const profiles = profileStore.listProfiles();
    return { profiles, categories: profileStore.categories(profiles) };
}

/** GET /api/raidplan/profiles */
const getProfiles = withUser({}, async ({ res }) => {
    ok(res, profileList());
});

/** POST /api/raidplan/profiles — body `{ name, category?, bossKey?, targets?, notes? }` */
const postProfile = withUser({ write: "raidplan", csrf: true, body: true }, async ({ body, res }) => {
    const result = profileStore.createProfile(body);
    if (result.error) return sendFailure(res, result);
    ok(res, { ...profileList(), profile: result.profile });
});

/** PATCH /api/raidplan/profiles — body `{ id, name?, category?, bossKey?, targets?, notes? }` */
const patchProfile = withUser({ write: "raidplan", csrf: true, body: true }, async ({ body, res }) => {
    const result = profileStore.updateProfile(body.id, body);
    if (result.error) return sendFailure(res, result);
    ok(res, { ...profileList(), profile: result.profile });
});

/** DELETE /api/raidplan/profiles — body `{ id }` */
const deleteProfile = withUser({ write: "raidplan", csrf: true, body: true }, async ({ body, res }) => {
    if (!profileStore.deleteProfile(body.id)) return error(res, 404, "not_found", "Profil nicht gefunden.");
    ok(res, profileList());
});

/** The icons offered when a mob is made, by category (generated and checked by scripts/fetch-mob-icons.js). */
function mobIconChoices() {
    try { return require("../../config/generated/mobIcons.json").choices || {}; } catch { return {}; }
}

/** What the catalog page needs: every visible entry, the hidden defaults, and the choices of the forms. */
function catalogAnswer() {
    const { bossesForInstances } = store;
    // the instances of every game version, each with its version (#544): the form offers those of the entry's versions
    const instances = require("../../config/gameVersions").VERSIONS.flatMap((v) => v.instances.map((i) => ({ ...i, versionId: v.id })));
    // Other versions hidden (#563): only the entries and instances of the shown version.
    const visible = new Set(visibleVersions());
    const shown = (e) => !Array.isArray(e.versions) || !e.versions.length || e.versions.some((v) => visible.has(v));
    const view = catalog.catalogView();
    return {
        mobs: view.mobs.filter(shown),
        spells: view.spells.filter(shown),
        hidden: catalog.hiddenEntries(),
        kinds: catalog.KINDS,
        iconChoices: mobIconChoices(),
        classes: catalog.CLASS_IDS,
        types: assign.ASSIGN_TYPES,
        instances: instances.filter((i) => visible.has(i.versionId)).map((i) => ({ id: i.id, name: i.name, short: i.short, versionId: i.versionId, bosses: bossesForInstances([i.id]).filter((b) => !b.trash && !b.general).map((b) => ({ key: b.key, name: b.name })) })),
        limits: catalog.LIMITS,
    };
}

/** GET /api/raidplan/catalog */
const getCatalog = withUser({}, async ({ res }) => {
    ok(res, catalogAnswer());
});

/** POST / PATCH / DELETE /api/raidplan/catalog/<mobs|spells> and POST /api/raidplan/catalog/reset — all answer the whole catalog. */
function catalogWrite(kind, how) {
    return withUser({ write: "raidplan", csrf: true, body: true }, async ({ body, req, res }) => {
        let r;
        if (how === "save") r = catalog.save(kind, how === "save" && req.method === "POST" ? { ...body, id: "" } : body);
        else if (how === "remove") r = catalog.remove(kind, body.id);
        else r = catalog.reset(body.kind === "spells" ? "spells" : "mobs", body.id);
        if (r.error) return sendFailure(res, r);
        ok(res, { ...catalogAnswer(), entry: r.entry || null });
    });
}

/**
 * GET /api/raidplan/public?token=<token> — no login. An unknown token, an
 * unpublished plan and a plan whose event is gone all answer the same 404.
 * A logged-in viewer's own userId only marks their token; it grants nothing.
 * The answer carries an ETag; the page polls with If-None-Match and gets a bare 304 while nothing changed (#555).
 */
async function getPublic(req, res, url) {
    const plan = store.getPublishedByToken(url.searchParams.get("token"));
    // an own event from its record; a Raid-Helper event through its plan record (switched off = the link is withdrawn)
    const found = plan ? await rosterSource.planEventFor(plan.eventId) : null;
    const event = found && found.event;
    if (!plan || !event) return error(res, 404, "not_found", "Diesen Raidplan gibt es nicht (mehr).");
    const viewer = auth.getUser(req);
    okWithEtag(req, res, { ...raidplan.publicView(plan, event, { me: viewer ? viewer.id : "" }), archived: archiveOf(event) });
}

/**
 * GET /api/raidplan/progress?token=<token> (the read view) or ?event=<id> (the editor, raidplan read) — #534:
 * `{ live, killed, current, next, updatedAt }` from the Warcraft Log linked to the event (raidplanProgress.js);
 * without a log or outside the raid window `{ live: false, killed: [], current: null, next: null }`. The token
 * answers the same 404 as /public for an unknown or withdrawn link. Listed with `auth: "none"` because the token
 * is its own authentication; the event variant checks the session and the area itself.
 */
async function getProgress(req, res, url) {
    const token = url.searchParams.get("token");
    let event;
    if (token) {
        const plan = store.getPublishedByToken(token);
        const found = plan ? await rosterSource.planEventFor(plan.eventId) : null;
        event = found && found.event;
        if (!plan || !event) return error(res, 404, "not_found", "Diesen Raidplan gibt es nicht (mehr).");
    } else {
        const user = auth.getUser(req);
        if (!user) return error(res, 401, "unauthorized", "Nicht angemeldet.");
        if (!userCan(user, "raidplan", "read")) return error(res, 403, "forbidden", "Kein Zugriff auf diesen Bereich.");
        const found = await eventOf(res, url.searchParams.get("event"));
        if (!found) return;
        event = found.event;
    }
    ok(res, await progressFor(event));
}

/** The Raid-Helper event `id` of the active server (loadEventGroups, with past raids), or null. */
async function raidhelperEventOf(req, id) {
    const { groups } = await loadEventGroups(activeGuildFor(req), { sinceSeconds: eventLookbackSince() });
    for (const g of groups) for (const e of g.events) if (e.id === id && e.source === "raidhelper") return { ...e, categoryId: e.categoryId || g.categoryId || "" };
    return null;
}

/** The instances the activation dialog offers (the rule set's, with their sizes). */
function instanceChoices(versionId) {
    const rules = rulesFor(knownVersion(versionId) || mainVersionFor());
    return rules.instances.map((i) => ({ id: i.id, name: i.name, short: i.short, sizes: i.sizes, defaultSize: i.defaultSize }));
}

/** What the activation dialog and the menu need of a Raid-Helper event's switch. */
function linkView(eventId, ev, plan) {
    const link = plan && plan.link;
    // A switched-on link keeps its version; else the event's category's (#542).
    const suggestion = instancesFromTitle(ev ? ev.title : (link && link.title) || "", knownVersion(link && link.versionId) || versionOfEvent(ev));
    return {
        eventId,
        title: ev ? ev.title : (link ? link.title : ""),
        enabled: !!(link && link.enabled),
        link: link || null,
        suggestion,
        instances: instanceChoices(link ? link.versionId : suggestion.versionId),
        hasPlan: !!(plan && plan.version > 0),
        published: !!(plan && plan.status === "published"),
        // Raid-Helper switched off in the settings: the plan still works, from the line-up it saved last
        raidhelperDisabled: raidhelperDisabled(),
    };
}

/** GET /api/raidplan/link?event=<id> */
const getLink = withUser({}, async ({ req, res, url }) => {
    const id = String(url.searchParams.get("event") || "").trim();
    if (isOwnEventId(id)) return error(res, 400, "invalid", "Eigene Events haben ihren Raidplan immer.");
    const plan = store.getPlan(id);
    const ev = await raidhelperEventOf(req, id);
    if (!ev && !(plan && plan.link)) return error(res, 404, "not_found", "Event nicht gefunden.");
    const view = linkView(id, ev, plan);
    // what Raid-Helper lists right now (read only, cached a minute): the dialog warns when the groups are only blocks of five
    const probe = await rosterSource.raidhelperPlanEvent({ ...(plan || store.emptyPlan(id)), link: { ...(plan && plan.link ? plan.link : {}), versionId: view.suggestion.versionId, instanceIds: view.suggestion.instanceIds } });
    ok(res, { ...view, lineup: { count: probe.loaded.length, available: probe.info.available, hasGroups: probe.info.hasGroups, origin: probe.info.origin, unmatchedNames: probe.info.unmatchedNames, unknown: probe.info.unknown } });
});

/** A category that plans with a sheet gets no raid plan (services/events/planning.js): switching on answers 409, switching off always works. */
function switchOnRefusal(body, ev) {
    return body.enabled === true && ev ? planningRefusal("raidplan", ev.categoryId, getConfig()) : null;
}

/** What switching on stores: the body's instances / size / version / composition, else the plan's, else what the title suggests. */
function switchOnInput(body, before, ev, req) {
    const link = before && before.link ? before.link : null;
    const sug = instancesFromTitle(ev ? ev.title : "", knownVersion(link && link.versionId) || versionOfEvent(ev));
    const input = {
        instanceIds: Array.isArray(body.instanceIds) ? body.instanceIds : (link ? link.instanceIds : sug.instanceIds),
        size: body.size !== undefined ? body.size : (link ? link.size : sug.size),
        versionId: body.versionId || (link ? link.versionId : sug.versionId),
        composition: body.composition !== undefined ? body.composition : (link ? link.composition : null),
    };
    if (ev) Object.assign(input, { title: ev.title, startTime: ev.startTime, guildId: activeGuildFor(req) });
    return input;
}

/** POST /api/raidplan/link — body `{ event, enabled, instanceIds?, size?, versionId?, composition? }` */
const postLink = withUser({ write: "raidplan", csrf: true, body: true, archived: BY_EVENT }, async ({ user, body, req, res }) => {
    const id = String(body.event || "").trim();
    if (isOwnEventId(id)) return error(res, 400, "invalid", "Eigene Events haben ihren Raidplan immer.");
    const before = store.getPlan(id);
    const ev = await raidhelperEventOf(req, id);
    // switching on needs the event on this server; switching off also works for one Raid-Helper no longer lists
    if (!ev && !(before && before.link)) return error(res, 404, "not_found", "Event nicht gefunden.");
    const blocked = switchOnRefusal(body, ev);
    if (blocked) return error(res, blocked.status, blocked.code, blocked.message);
    const input = { enabled: body.enabled === true };
    if (body.enabled === true) Object.assign(input, switchOnInput(body, before, ev, req));
    let knownRoster = null;
    if (input.enabled) {
        // what Raid-Helper lists right now is remembered at once: switched off later, the plan still knows its raiders
        const r = await rosterSource.raidhelperPlanEvent({ ...(before || store.emptyPlan(id)), link: { ...(before && before.link ? before.link : {}), ...input, versionId: input.versionId || versionOfEvent(ev) } });
        if (r.info.authoritative) knownRoster = r.loaded;
    }
    const result = store.setLink(id, input, { userId: user.id, knownRoster });
    if (result.error) return sendFailure(res, result);
    ok(res, linkView(id, ev, result.plan));
});

const postMob = catalogWrite("mobs", "save");
const patchMob = catalogWrite("mobs", "save");
const deleteMob = catalogWrite("mobs", "remove");
const postSpell = catalogWrite("spells", "save");
const patchSpell = catalogWrite("spells", "save");
const deleteSpell = catalogWrite("spells", "remove");
const postCatalogReset = catalogWrite("mobs", "reset");

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/raidplan", handler: getPlan, area: "raidplan" },
    { method: "PUT", path: "/api/raidplan", handler: putPlan, area: "raidplan" },
    { method: "POST", path: "/api/raidplan/suggest", handler: postSuggest, area: "raidplan" },
    { method: "POST", path: "/api/raidplan/publish", handler: postPublish, area: "raidplan" },
    { method: "POST", path: "/api/raidplan/groups", handler: postGroups, area: "raidplan" },
    { method: "POST", path: "/api/raidplan/map", handler: postMap, area: "raidplan" },
    { method: "POST", path: "/api/raidplan/map/delete", handler: postMapDelete, area: "raidplan" },
    { method: "GET", path: "/api/raidplan/catalog", handler: getCatalog, area: "raidplan" },
    { method: "POST", path: "/api/raidplan/catalog/mobs", handler: postMob, area: "raidplan" },
    { method: "PATCH", path: "/api/raidplan/catalog/mobs", handler: patchMob, area: "raidplan" },
    { method: "DELETE", path: "/api/raidplan/catalog/mobs", handler: deleteMob, area: "raidplan" },
    { method: "POST", path: "/api/raidplan/catalog/spells", handler: postSpell, area: "raidplan" },
    { method: "PATCH", path: "/api/raidplan/catalog/spells", handler: patchSpell, area: "raidplan" },
    { method: "DELETE", path: "/api/raidplan/catalog/spells", handler: deleteSpell, area: "raidplan" },
    { method: "POST", path: "/api/raidplan/catalog/reset", handler: postCatalogReset, area: "raidplan" },
    { method: "GET", path: "/api/raidplan/profiles", handler: getProfiles, area: "raidplan" },
    { method: "POST", path: "/api/raidplan/profiles", handler: postProfile, area: "raidplan" },
    { method: "PATCH", path: "/api/raidplan/profiles", handler: patchProfile, area: "raidplan" },
    { method: "DELETE", path: "/api/raidplan/profiles", handler: deleteProfile, area: "raidplan" },
    { method: "POST", path: "/api/raidplan/apply", handler: postApply, area: "raidplan" },
    { method: "GET", path: "/api/raidplan/templates", handler: getTemplates, area: "raidplan" },
    { method: "POST", path: "/api/raidplan/templates", handler: postTemplate, area: "raidplan" },
    { method: "PATCH", path: "/api/raidplan/templates", handler: patchTemplate, area: "raidplan" },
    { method: "DELETE", path: "/api/raidplan/templates", handler: deleteTemplate, area: "raidplan" },
    { method: "POST", path: "/api/raidplan/templates/duplicate", handler: postTemplateDuplicate, area: "raidplan" },
    { method: "GET", path: "/api/raidplan/link", handler: getLink, area: "raidplan" },
    { method: "POST", path: "/api/raidplan/link", handler: postLink, area: "raidplan" },
    { method: "GET", path: "/api/raidplan/public", handler: getPublic, auth: "none" },
    { method: "GET", path: "/api/raidplan/progress", handler: getProgress, auth: "none" },
];

module.exports = {
    getLink, postLink,
    getPlan, putPlan, postSuggest, postPublish, postGroups, postMap, postMapDelete,
    getCatalog, postMob, patchMob, deleteMob,
    postSpell, patchSpell, deleteSpell, postCatalogReset,
    getProfiles, postProfile, patchProfile, deleteProfile, getPublic, getProgress,
    postApply, getTemplates, postTemplate, patchTemplate, deleteTemplate, postTemplateDuplicate,
    routes,
};
