// Absences and attendances (services/signups/availability.js): "away from … to …"
// signs a raider off from the raids of that period, "there from … to … with
// this character" signs them up — now and for raids created later, with a DM.
//
// GET    /api/availability[?userId=]      area signup   — the active entries and the characters to pick from
// POST   /api/availability/preview        area signup   — the raids a period covers; body { kind, from, to, character, spec, userId? }
// POST   /api/availability                area signup   — enter one; body { kind, from, to, comment, character, spec, eventIds[], userId? }
// DELETE /api/availability                area signup   — remove one; body { id }
// GET    /api/availability/attendance[?userId=]        area signup — own attendance per category and raid (orga: anyone's)
// GET    /api/availability/overview?weeks=&category=  area roster — the orga's overview: who is away when (absenceOverview.js)
// GET    /api/availability/overview/raider?userId=    area roster — one raider's entries and last raids
// GET    /api/availability/panels         area settings — the posted Discord panels per raid category
// POST   /api/availability/panel          area settings — post a category's panel; body { categoryId, channelId }
// DELETE /api/availability/panel          area settings — take it down; body { categoryId }
// PUT    /api/availability/links          area settings — a category's organizer links; body { categoryId, links: [{ label, url }] }
//
// Everything works on the session's own account. A `userId` of somebody else
// counts only for the orga (`raids` write), who enters for a raider who told
// them — the DM still goes to the raider and says who entered it.
const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { getConfig } = require("../../stores/settingsStore");
const profiles = require("../../stores/raiderProfileStore");
const availabilityStore = require("../../stores/availabilityStore");
const { getSignup } = require("../../stores/signupStore");
const availability = require("../../services/signups/availability");
const availabilityPanel = require("../../services/signups/availabilityPanel");
const { userCanAny } = require("../../config/permissions");
const { visibleVersions } = require("../../services/events/mainVersion");
const linkCheck = require("../../services/discord/linkCheck");
const discord = require("../../services/discord/discord");
const absenceOverview = require("../../services/signups/absenceOverview");
const { raiderAttendance } = require("../availability/raiderAttendance");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const isOrga = (user) => userCanAny(user, ["raids"], "write");

/** Whose entries a call is about: the caller, or (for the orga) the raider named in it. */
function targetOf(user, requested) {
    const id = str(requested);
    if (!id || id === str(user.id)) return { userId: str(user.id) };
    if (!isOrga(user)) return { error: "Nur die Raidleitung kann für andere eintragen." };
    return { userId: id };
}

function specLabel(key) {
    const info = profiles.specInfo(key);
    return (info && info.label) || key;
}

function entryView(entry) {
    const applied = Object.values(entry.applied || {});
    return {
        id: entry.id,
        kind: entry.kind,
        from: entry.from,
        to: entry.to,
        comment: entry.comment,
        character: entry.character,
        spec: entry.spec,
        specLabel: entry.spec ? specLabel(entry.spec) : "",
        versionId: entry.versionId,
        categoryId: entry.categoryId,
        categoryName: entry.categoryId ? availabilityPanel.categoryNameFor(entry.categoryId) : "",
        byOrga: !!entry.createdBy && entry.createdBy !== entry.userId,
        done: applied.filter((a) => a.ok).length,
    };
}

/** The characters an attendance can be entered with: the shown game versions, specs with usable gear. */
function characterChoices(profile, config) {
    const versions = visibleVersions(config);
    return (profile.characters || [])
        .filter((c) => versions.includes(c.versionId))
        .map((c) => ({
            key: c.key,
            name: c.name,
            className: c.className,
            versionId: c.versionId,
            specs: (c.specs || []).filter((s) => s.gear !== "none").map((s) => ({ key: s.key, label: specLabel(s.key), gear: s.gear })),
        }))
        .filter((c) => c.specs.length);
}

function resultView(r) {
    return {
        eventId: r.eventId, title: r.title, startTime: r.startTime, ok: !!r.ok,
        skipped: r.skipped || "", error: r.error || "",
    };
}

/** GET /api/availability — the raider's entries that are not over, and their characters. */
const getAvailability = withUser({}, async ({ user, query, res }) => {
    const target = targetOf(user, query.get("userId"));
    if (target.error) return apiError(res, 403, "forbidden", target.error);
    const config = getConfig();
    const profile = profiles.getProfile(target.userId);
    ok(res, {
        userId: target.userId,
        name: profile.name || "",
        orga: isOrga(user),
        today: availability.today(),
        maxDays: availability.MAX_DAYS,
        entries: availability.activeEntries(target.userId).map(entryView),
        characters: characterChoices(profile, config),
    });
});

/** POST /api/availability/preview — which raids the period covers, with the raider's current status in each. */
const postPreview = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    const target = targetOf(user, body.userId);
    if (target.error) return apiError(res, 403, "forbidden", target.error);
    const checked = availability.checkInput(target.userId, body);
    if (checked.error) return apiError(res, 400, "bad_request", checked.error);
    const raids = availability.raidsInRange(checked.value, { config: getConfig() });
    ok(res, {
        raids: raids.map((e) => {
            const signup = getSignup(e.id, target.userId);
            return {
                id: e.id,
                title: e.title || "",
                startTime: Number(e.startTime) || 0,
                categoryName: e.categoryName || "",
                status: signup ? signup.status : "",
                url: linkCheck.eventLink(e),
            };
        }),
    });
});

/** POST /api/availability — enter an absence or attendance and apply it at once. */
const postEntry = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    const target = targetOf(user, body.userId);
    if (target.error) return apiError(res, 403, "forbidden", target.error);
    const eventIds = Array.isArray(body.eventIds) ? body.eventIds.map(str).filter(Boolean) : undefined;
    const result = await availability.createEntry(target.userId, body, { by: user.id, eventIds, config: getConfig() });
    if (result.error) return apiError(res, 400, "bad_request", result.error);
    ok(res, { entry: entryView(result.entry), results: result.results.map(resultView), dm: !!result.dm });
});

/** DELETE /api/availability — remove an entry (the signups it made stay). */
const deleteEntry = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    const removed = availability.deleteEntry(str(body.id), { userId: user.id, orga: isOrga(user) });
    if (removed.error) return apiError(res, 404, removed.code, removed.error);
    ok(res, { id: removed.entry.id });
});

function panelView(panel) {
    return {
        categoryId: panel.categoryId,
        channelId: panel.channelId,
        postedAt: panel.postedAt,
        url: linkCheck.messageLink(panel.guildId, panel.channelId, panel.messageId) || "",
    };
}

/** GET /api/availability/panels — the posted panels and every category's links. */
const getPanels = withUser({}, async ({ res }) => {
    ok(res, { panels: availabilityStore.listPanels().map(panelView), links: availabilityStore.listLinks(), maxLinks: availabilityStore.MAX_LINKS });
});

/** PUT /api/availability/links — replace a category's link buttons; its posted panel is redrawn at once. */
const putLinks = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const result = availabilityStore.setLinks(body.categoryId, body.links);
    if (result.error) return apiError(res, 400, "bad_request", result.error);
    // not awaited: a Discord edit is slow and never holds up the save
    availabilityPanel.refreshPanels({ categoryId: str(body.categoryId) }).catch(() => {});
    ok(res, { categoryId: str(body.categoryId), links: result.links });
});

/** POST /api/availability/panel — post (or move) a category's panel. */
const postPanel = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    const result = await availabilityPanel.postPanel({ categoryId: body.categoryId, channelId: body.channelId, by: user.id });
    if (result.error) return apiError(res, 400, "bad_request", result.error);
    ok(res, { panel: { ...panelView(result.panel), url: result.url || panelView(result.panel).url } });
});

/** DELETE /api/availability/panel — take a category's panel down. */
const deletePanel = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const removed = await availabilityPanel.removePanel(str(body.categoryId));
    if (!removed) return apiError(res, 404, "not_found", "Für diese Kategorie ist kein Panel gepostet.");
    ok(res, { categoryId: removed.categoryId });
});

// --- the orga's overview (Roster › Abwesenheiten) ---

/** Names of the active categories and of every category an entry names. */
function categoryNamesOf(config) {
    const ids = new Set([...(Array.isArray(config.categoryIds) ? config.categoryIds : []), ...availabilityStore.listEntries().map((e) => e.categoryId)].map(str).filter(Boolean));
    return Object.fromEntries([...ids].map((id) => [id, availabilityPanel.categoryNameFor(id, { config }) || ""]));
}

/** Discord names for the raiders a view names; a failing lookup keeps the names it has. */
async function namerFor(ids, config) {
    let names = {};
    try {
        names = ids.length ? (await discord.resolveUserNames(config.guildId, ids)) || {} : {};
    } catch {
        names = {};
    }
    return (x) => (names[x.userId] ? { ...x, name: names[x.userId] } : x);
}

/** GET /api/availability/overview?weeks=&category= — who is away when, the raids it touches, the hints. */
const getOverview = withUser({}, async ({ user, query, res }) => {
    const config = getConfig();
    const view = absenceOverview.buildOverview({
        weeks: Number(query.get("weeks")) || 8,
        categoryId: str(query.get("category")),
        config,
        withReasons: isOrga(user),
        categoryNames: categoryNamesOf(config),
        eventUrl: (e) => linkCheck.eventLink(e),
    });
    const named = await namerFor([...new Set([...view.raiders.map((r) => r.userId), ...view.hints.map((h) => h.userId)])], config);
    ok(res, { ...view, raiders: view.raiders.map(named), hints: view.hints.map(named), canEdit: isOrga(user), withReasons: isOrga(user) });
});

/** GET /api/availability/overview/raider?userId= — one raider's entries and their last raids. */
const getOverviewRaider = withUser({}, async ({ user, query, res }) => {
    const userId = str(query.get("userId"));
    if (!userId) return apiError(res, 400, "bad_request", "Kein Raider angegeben.");
    const config = getConfig();
    const view = absenceOverview.raiderDetail(userId, { config, withReasons: isOrga(user), categoryNames: categoryNamesOf(config) });
    const named = await namerFor([userId], config);
    ok(res, { ...named(view), canEdit: isOrga(user) });
});

/**
 * GET /api/availability/attendance[?userId=] — "Meine Anwesenheit": per raid category the quota and the
 * verdict of every counted raid, plus the coming raids with the own status. Somebody else's only for the orga.
 */
const getAttendance = withUser({}, async ({ user, query, res }) => {
    const target = targetOf(user, query.get("userId"));
    if (target.error) return apiError(res, 403, "forbidden", target.error);
    const config = getConfig();
    const view = raiderAttendance(target.userId, { config, categoryNames: categoryNamesOf(config), eventUrl: (e) => linkCheck.eventLink(e) });
    const profile = profiles.getProfile(target.userId);
    const named = await namerFor([target.userId], config);
    ok(res, { ...named({ ...view, name: profile.name || "" }), own: target.userId === str(user.id), orga: isOrga(user) });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/availability", handler: getAvailability, area: "signup" },
    { method: "GET", path: "/api/availability/attendance", handler: getAttendance, area: "signup" },
    { method: "GET", path: "/api/availability/overview", handler: getOverview, area: "roster" },
    { method: "GET", path: "/api/availability/overview/raider", handler: getOverviewRaider, area: "roster" },
    { method: "POST", path: "/api/availability/preview", handler: postPreview, area: "signup" },
    { method: "POST", path: "/api/availability", handler: postEntry, area: "signup" },
    { method: "DELETE", path: "/api/availability", handler: deleteEntry, area: "signup" },
    { method: "GET", path: "/api/availability/panels", handler: getPanels, area: "settings" },
    { method: "POST", path: "/api/availability/panel", handler: postPanel, area: "settings" },
    { method: "DELETE", path: "/api/availability/panel", handler: deletePanel, area: "settings" },
    { method: "PUT", path: "/api/availability/links", handler: putLinks, area: "settings" },
];

module.exports = { routes, _internal: { entryView, characterChoices, targetOf } };
