// Absences and attendances (services/signups/availability.js): "away from … to …"
// signs a raider off from the raids of that period, "there from … to … with
// this character" signs them up — now and for raids created later, with a DM.
//
// GET    /api/availability[?userId=]      area signup   — the active entries, the characters to pick from and the raid
//                                                         categories an entry may be limited to (entryCategories.js)
// POST   /api/availability/preview        area signup   — the raids a period covers; body { kind, from, to, character, spec, categoryId?, userId? }
// POST   /api/availability                area signup   — enter one; body { kind, from, to, comment, character, spec, categoryId?, eventIds[], userId? }
//                                                         `categoryId` "" or missing = every category; an unknown one is a 400
// DELETE /api/availability                area signup   — remove one; body { id }
// GET    /api/availability/attendance[?userId=&version=]        area signup — own attendance per category and raid (orga: anyone's)
// GET    /api/availability/overview?weeks=&category=&version=  area roster — the orga's overview: who is away when (absenceOverview.js)
// GET    /api/availability/overview/raider?userId=&version=    area roster — one raider's entries and last raids
//
// The three views are per game version (#740, the menu's content switch): only raids of `version`
// (resolveVersionQuery: none = the main version) count and are listed. The absence entries
// themselves belong to no version - they cover the raids of every version.
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
const { userCanAny, userIsOrga } = require("../../config/permissions");
const { visibleVersions, resolveVersionQuery } = require("../../services/events/mainVersion");
const linkCheck = require("../../services/discord/linkCheck");
const discord = require("../../services/discord/discord");
const absenceOverview = require("../../services/signups/absenceOverview");
const { raiderAttendance } = require("../availability/raiderAttendance");
const { entryCategories, entryCategoryIds } = require("../availability/entryCategories");
const { canEditAnyAttendance } = require("../../services/characters/attendanceAccess");
const { mayUseServer, mayUseChannel, OTHER_SERVER } = require("../http/serverQuery");

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const isOrga = (user) => userCanAny(user, ["raids"], "write");

/**
 * Rights per server (#925, docs/permissions.md): a raid category is a Discord channel, so the bot's
 * channel cache names its server. The orga acts for others, and on panels and links, only in the
 * categories of the active server; a full admin everywhere. An unknown category counts as foreign.
 */
const categoryOnActiveServer = (user, req, categoryId) => mayUseChannel(user, req, str(categoryId));
const otherServer = (res) => apiError(res, 403, "other_server", OTHER_SERVER);

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
        // the dialog offers the caller's own list, also when the orga enters for somebody else
        categories: target.userId === str(user.id) ? entryCategories({ config, categoryNames: categoryNamesOf(config) }) : [],
    });
});

const UNKNOWN_CATEGORY = "Diese Raid-Kategorie gibt es nicht (mehr) – bitte eine andere wählen.";

/** Whether a body's `categoryId` is none ("" = every category) or one an entry may name. */
function knownCategory(body, config) {
    const id = str(body && body.categoryId);
    return !id || entryCategoryIds({ config }).includes(id);
}

/** POST /api/availability/preview — which raids the period covers, with the raider's current status in each. */
const postPreview = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    const target = targetOf(user, body.userId);
    if (target.error) return apiError(res, 403, "forbidden", target.error);
    const config = getConfig();
    if (!knownCategory(body, config)) return apiError(res, 400, "bad_request", UNKNOWN_CATEGORY);
    const checked = availability.checkInput(target.userId, body);
    if (checked.error) return apiError(res, 400, "bad_request", checked.error);
    const raids = availability.raidsInRange(checked.value, { config });
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
const postEntry = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const target = targetOf(user, body.userId);
    if (target.error) return apiError(res, 403, "forbidden", target.error);
    const config = getConfig();
    if (!knownCategory(body, config)) return apiError(res, 400, "bad_request", UNKNOWN_CATEGORY);
    // for somebody else only in a category of the active server (#925)
    if (target.userId !== str(user.id) && str(body.categoryId) && !categoryOnActiveServer(user, req, body.categoryId)) return otherServer(res);
    const eventIds = Array.isArray(body.eventIds) ? body.eventIds.map(str).filter(Boolean) : undefined;
    const result = await availability.createEntry(target.userId, body, { by: user.id, via: "web", eventIds, config });
    if (result.error) return apiError(res, 400, "bad_request", result.error);
    ok(res, { entry: entryView(result.entry), results: result.results.map(resultView), dm: !!result.dm });
});

/** DELETE /api/availability — remove an entry (the signups it made stay). */
const deleteEntry = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    // somebody else's entry for a category of another server does not exist here (#925)
    const entry = availabilityStore.getEntry(str(body.id));
    if (entry && entry.userId !== str(user.id) && str(entry.categoryId) && !categoryOnActiveServer(user, req, entry.categoryId)) {
        return apiError(res, 404, "not_found", "Eintrag nicht gefunden.");
    }
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
const getPanels = withUser({}, async ({ user, req, res }) => {
    const panels = availabilityStore.listPanels().filter((panel) => mayUseServer(user, req, panel.guildId));
    const links = Object.fromEntries(Object.entries(availabilityStore.listLinks()).filter(([categoryId]) => categoryOnActiveServer(user, req, categoryId)));
    ok(res, { panels: panels.map(panelView), links, maxLinks: availabilityStore.MAX_LINKS });
});

/** PUT /api/availability/links — replace a category's link buttons; its posted panel is redrawn at once. */
const putLinks = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    if (str(body.categoryId) && !categoryOnActiveServer(user, req, body.categoryId)) return otherServer(res);
    const result = availabilityStore.setLinks(body.categoryId, body.links);
    if (result.error) return apiError(res, 400, "bad_request", result.error);
    // not awaited: a Discord edit is slow and never holds up the save
    availabilityPanel.refreshPanels({ categoryId: str(body.categoryId) }).catch(() => {});
    ok(res, { categoryId: str(body.categoryId), links: result.links });
});

/** POST /api/availability/panel — post (or move) a category's panel. */
const postPanel = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    if (!categoryOnActiveServer(user, req, body.categoryId)) return otherServer(res);
    if (str(body.channelId) && !mayUseChannel(user, req, str(body.channelId))) return otherServer(res);
    const result = await availabilityPanel.postPanel({ categoryId: body.categoryId, channelId: body.channelId, by: user.id });
    if (result.error) return apiError(res, 400, "bad_request", result.error);
    ok(res, { panel: { ...panelView(result.panel), url: result.url || panelView(result.panel).url } });
});

/** DELETE /api/availability/panel — take a category's panel down. */
const deletePanel = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const panel = availabilityStore.listPanels().find((x) => x.categoryId === str(body.categoryId));
    if (panel && !mayUseServer(user, req, panel.guildId)) return apiError(res, 404, "not_found", "Für diese Kategorie ist kein Panel gepostet.");
    const removed = await availabilityPanel.removePanel(str(body.categoryId));
    if (!removed) return apiError(res, 404, "not_found", "Für diese Kategorie ist kein Panel gepostet.");
    ok(res, { categoryId: removed.categoryId });
});

// --- the orga's overview (Roster › Abwesenheiten) ---

/**
 * The game version a view counts (#740): `?version=` as every list reads it, "all" and nothing both
 * the main version - attendance never mixes versions.
 */
function versionOf(query, config) {
    const { versionId, mainVersion } = resolveVersionQuery(query.get("version"), { config });
    return versionId || mainVersion;
}

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

/** GET /api/availability/overview?weeks=&category=a,b — who is away when, the raids it touches, the hints (category: one or more, comma-separated; none = all). */
/** Everybody's absences are the orga's (full admins, orga roles) - a raider role with `roster` read sees only its own. */
const ORGA_ONLY = "Die Übersicht aller Raider sieht nur die Orga.";

const getOverview = withUser({}, async ({ user, query, res }) => {
    if (!userIsOrga(user)) return apiError(res, 403, "orga_only", ORGA_ONLY);
    const config = getConfig();
    const view = absenceOverview.buildOverview({
        weeks: Number(query.get("weeks")) || 8,
        categoryId: str(query.get("category")),
        versionId: versionOf(query, config),
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
    if (!userIsOrga(user)) return apiError(res, 403, "orga_only", ORGA_ONLY);
    const userId = str(query.get("userId"));
    if (!userId) return apiError(res, 400, "bad_request", "Kein Raider angegeben.");
    const config = getConfig();
    const view = absenceOverview.raiderDetail(userId, { versionId: versionOf(query, config), config, withReasons: isOrga(user), categoryNames: categoryNamesOf(config) });
    const named = await namerFor([userId], config);
    ok(res, { ...named(view), canEdit: isOrga(user) });
});

/**
 * GET /api/availability/attendance[?userId=] — "Meine Anwesenheit": per raid category the quota and the
 * verdict of every counted raid, plus the coming raids with the own status. Somebody else's only for the orga.
 * `canEdit`: the caller may set a night by hand (POST /api/attendance/override; admin or raids write, #677).
 */
const getAttendance = withUser({}, async ({ user, query, res }) => {
    const target = targetOf(user, query.get("userId"));
    if (target.error) return apiError(res, 403, "forbidden", target.error);
    const config = getConfig();
    const view = raiderAttendance(target.userId, {
        versionId: versionOf(query, config), config, categoryNames: categoryNamesOf(config), eventUrl: (e) => linkCheck.eventLink(e),
    });
    const profile = profiles.getProfile(target.userId);
    const named = await namerFor([target.userId], config);
    ok(res, { ...named({ ...view, name: profile.name || "" }), own: target.userId === str(user.id), orga: isOrga(user), canEdit: canEditAnyAttendance(user) });
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
