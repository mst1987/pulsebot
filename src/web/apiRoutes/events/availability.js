// Absences and attendances (services/signups/availability.js): "away from … to …"
// signs a raider off from the raids of that period, "there from … to … with
// this character" signs them up — now and for raids created later, with a DM.
//
// GET    /api/availability[?userId=]      area signup   — the active entries (readable `scope`, `characters`), the characters
//                                                         to pick from and `servers` [{ guildId, name, icon, categories }]:
//                                                         the servers the raider is a member of (entryServers.js)
// POST   /api/availability/preview        area signup   — the raids a period covers; body { kind, from, to, scope, characters, id?, userId? };
//                                                         with `id` (editing) each raid says `applied` / `absent` without that entry
// POST   /api/availability                area signup   — enter one; body { kind, from, to, comment, scope, characters, eventIds[], userId? }
//                                                         scope [{ guildId, categoryIds: [] = every category }]; an unknown server or
//                                                         a category of another server is a 400. Older body: character, spec, categoryId
// PUT    /api/availability                area signup   — change one; body as POST plus { id }; raids it touched stay, newly covered
//                                                         ones are applied now; rights as DELETE
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
// PUT    /api/availability/features       area settings — switch parts of a category's raid hub on/off (#969);
//                                                         body { categoryId, features: { nextRaid?, attendance?, evaluation?, guildBank?, links? } }
//
// Everything works on the session's own account. A `userId` of somebody else
// counts only for the orga (`raids` write), who enters for a raider who told
// them — the DM still goes to the raider and says who entered it.
const { ok, error: apiError } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const { getConfig } = require("../../../stores/settings/settingsStore");
const profiles = require("../../../stores/roster/raiderProfileStore");
const availabilityStore = require("../../../stores/events/availabilityStore");
const { getSignup } = require("../../../stores/events/signupStore");
const availability = require("../../../services/signups/availability");
const availabilityPanel = require("../../../services/signups/availabilityPanel");
const { userCanAny, userIsOrga } = require("../../../config/permissions");
const { visibleVersions, resolveVersionQuery } = require("../../../services/versions/mainVersion");
const linkCheck = require("../../../services/discord/linkCheck");
const discord = require("../../../services/discord/discord");
const absenceOverview = require("../../../services/signups/absenceOverview");
const { raiderAttendance } = require("../../availability/raiderAttendance");
const { entryCategoryIds, eventCategoryNames } = require("../../availability/entryCategories");
const { entryServers, serverNames } = require("../../availability/entryServers");
const { scopeOf, specLabel, scopeView, charactersView } = require("../../../services/signups/availabilityScope");
const { canEditAnyAttendance } = require("../../../services/characters/attendanceAccess");
const { mayUseServer, mayUseChannel, guildOfChannel, OTHER_SERVER } = require("../../http/serverQuery");

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

/**
 * An entry as the dialog lists it. `scope` and `characters` as the overview's drawer shows them
 * (availabilityScope.scopeView / charactersView); `character`/`spec`/`categoryId` stay for older
 * readers (the first character, the one category).
 * @param {{ servers?: Object<string,string>, categories?: Object<string,string> }} [names] guildId -> server
 *   name (entryServers.serverNames), category id -> name (categoryNamesOf)
 */
function entryView(entry, names = {}) {
    const applied = Object.values(entry.applied || {});
    const scope = scopeView(entry, names);
    const characters = charactersView(entry);
    const first = characters[0] || { character: "", spec: "", versionId: "" };
    const oneCategory = scope.length === 1 && scope[0].categories.length === 1 ? scope[0].categories[0].id : "";
    return {
        id: entry.id,
        kind: entry.kind,
        from: entry.from,
        to: entry.to,
        comment: entry.comment,
        scope,
        characters,
        character: first.character,
        spec: first.spec,
        specLabel: first.spec ? specLabel(first.spec) : "",
        versionId: first.versionId || str(entry.versionId),
        categoryId: oneCategory,
        categoryName: oneCategory ? scope[0].categories[0].name : "",
        byOrga: !!entry.createdBy && entry.createdBy !== entry.userId,
        done: applied.filter((a) => a.ok).length,
    };
}

/**
 * Whether the caller may touch somebody else's entry (#925): every server it names is one they may
 * use - an older entry's category by the channel cache, an older entry for everything always.
 */
function mayTouchEntry(user, req, entry) {
    if (!entry || entry.userId === str(user.id)) return true;
    const scope = scopeOf(entry);
    if (!scope) return true;
    return scope.every((s) => (s.guildId ? mayUseServer(user, req, s.guildId) : s.categoryIds.every((c) => categoryOnActiveServer(user, req, c))));
}

/** Whether every server of a body's scope (or an older body's single category) is one the caller may use. */
function mayUseScope(user, req, body) {
    const parts = Array.isArray(body.scope) ? body.scope.filter(Boolean) : [];
    if (parts.length) return parts.every((p) => mayUseServer(user, req, str(p.guildId)));
    return !str(body.categoryId) || categoryOnActiveServer(user, req, body.categoryId);
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
    const entries = availability.activeEntries(target.userId);
    const names = viewNames(config, entries);
    // the servers of the raider the entry is for (their memberships), each with its categories
    const servers = await entryServers(target.userId, { config, categoryNames: names.categories });
    ok(res, {
        userId: target.userId,
        name: profile.name || "",
        orga: isOrga(user),
        today: availability.today(),
        maxDays: availability.MAX_DAYS,
        entries: entries.map((e) => entryView(e, names)),
        characters: characterChoices(profile, config),
        servers,
        // the flat list of before the server blocks (older clients)
        categories: servers.flatMap((s) => s.categories),
    });
});

const UNKNOWN_CATEGORY = "Diese Raid-Kategorie gibt es nicht (mehr) – bitte eine andere wählen.";
const NOT_FOUND = "Eintrag nicht gefunden.";

/** Whether every category a body names (its scope, or an older body's `categoryId`) is one an entry may name. */
function knownCategory(body, config) {
    const parts = Array.isArray(body && body.scope) ? body.scope.filter(Boolean) : [];
    const ids = parts.length
        ? parts.flatMap((p) => (Array.isArray(p.categoryIds) ? p.categoryIds : [])).map(str).filter(Boolean)
        : [str(body && body.categoryId)].filter(Boolean);
    if (!ids.length) return true;
    const known = entryCategoryIds({ config });
    return ids.every((id) => known.includes(id));
}

/** The body's picked raids: a list of ids, or undefined (= every raid of the period). */
const eventIdsOf = (body) => (Array.isArray(body.eventIds) ? body.eventIds.map(str).filter(Boolean) : undefined);

/**
 * POST /api/availability/preview — which raids the period covers, with the raider's current status in each.
 * With `id` (the dialog edits that entry): the raid it already touched is `applied` (it stays as it is), and
 * `absent` (an absence covers the raid, so an attendance stays out) leaves that entry itself out.
 */
const postPreview = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    const target = targetOf(user, body.userId);
    if (target.error) return apiError(res, 403, "forbidden", target.error);
    const config = getConfig();
    const id = str(body.id);
    const editing = id ? availabilityStore.getEntry(id) : null;
    if (id && (!editing || editing.userId !== target.userId)) return apiError(res, 404, "not_found", NOT_FOUND);
    if (!knownCategory(body, config)) return apiError(res, 400, "bad_request", UNKNOWN_CATEGORY);
    const input = editing ? { ...body, kind: editing.kind } : body;
    const checked = availability.checkInput(target.userId, input, { config });
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
                applied: !!(editing && editing.applied && editing.applied[e.id]),
                absent: availability.absentFor(target.userId, e, { excludeId: id, config }),
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
    // for somebody else only on servers the caller may use (#925)
    if (target.userId !== str(user.id) && !mayUseScope(user, req, body)) return otherServer(res);
    const result = await availability.createEntry(target.userId, body, { by: user.id, via: "web", eventIds: eventIdsOf(body), config });
    if (result.error) return apiError(res, 400, "bad_request", result.error);
    ok(res, { entry: entryView(result.entry, viewNames(config, [result.entry])), results: result.results.map(resultView), dm: !!result.dm });
});

/**
 * PUT /api/availability — change an entry: period, reason, scope, (attendance) characters; body as POST
 * plus `id`. Rights as DELETE. The raids it already touched stay; newly covered ones are applied now
 * (`eventIds` = the picked ones), one DM "Absence changed" / "Attendance changed".
 */
const putEntry = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const entry = availabilityStore.getEntry(str(body.id));
    // somebody else's entry of another server does not exist here (#925), nor may it be moved there
    if (entry && !mayTouchEntry(user, req, entry)) return apiError(res, 404, "not_found", NOT_FOUND);
    if (entry && entry.userId !== str(user.id) && isOrga(user) && !mayUseScope(user, req, body)) return otherServer(res);
    const config = getConfig();
    if (!knownCategory(body, config)) return apiError(res, 400, "bad_request", UNKNOWN_CATEGORY);
    const result = await availability.changeEntry(str(body.id), body, { userId: user.id, orga: isOrga(user), eventIds: eventIdsOf(body), config });
    if (result.error) return apiError(res, result.code === "not_found" ? 404 : 400, result.code || "bad_request", result.error);
    ok(res, { entry: entryView(result.entry, viewNames(config, [result.entry])), results: result.results.map(resultView), dm: !!result.dm });
});

/** DELETE /api/availability — remove an entry (the signups it made stay). */
const deleteEntry = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    // somebody else's entry of another server does not exist here (#925)
    const entry = availabilityStore.getEntry(str(body.id));
    if (entry && !mayTouchEntry(user, req, entry)) return apiError(res, 404, "not_found", NOT_FOUND);
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
    const features = Object.fromEntries(Object.entries(availabilityStore.listFeatures()).filter(([categoryId]) => categoryOnActiveServer(user, req, categoryId)));
    ok(res, { panels: panels.map(panelView), links, maxLinks: availabilityStore.MAX_LINKS, features, featureKeys: availabilityStore.FEATURE_KEYS });
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

/**
 * Whether a raid category is one the bot knows (#969): an active category, one an entry may
 * name, or a category channel in the bot's cache. A switch for any other id is refused.
 */
function knownHubCategory(categoryId, config) {
    const id = str(categoryId);
    if (!id) return false;
    const active = (Array.isArray(config.categoryIds) ? config.categoryIds : []).map(str);
    return active.includes(id) || entryCategoryIds({ config }).includes(id) || !!guildOfChannel(id);
}

/** PUT /api/availability/features — switch parts of a category's raid hub on or off; its posted panel is redrawn at once. */
const putFeatures = withUser({ csrf: true, body: true }, async ({ user, req, body, res }) => {
    const categoryId = str(body.categoryId);
    if (!knownHubCategory(categoryId, getConfig())) return apiError(res, 400, "bad_request", UNKNOWN_CATEGORY);
    if (!categoryOnActiveServer(user, req, categoryId)) return otherServer(res);
    const result = availabilityStore.setFeatures(categoryId, body.features);
    if (result.error) return apiError(res, 400, "bad_request", result.error);
    // not awaited, like the links: the Discord edit never holds up the save
    availabilityPanel.refreshPanels({ categoryId }).catch(() => {});
    ok(res, { categoryId, features: result.features });
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

/**
 * Names of the active categories and of every category an entry names: the Discord name, else the
 * name their events were created with (entryCategories.eventCategoryNames - the dialog's list names
 * them the same way); the event store is read only when Discord leaves a category unnamed.
 * @param {object[]} [entries] entries to name beyond the stored ones (a fresh write, a mocked list)
 */
function categoryNamesOf(config, entries = []) {
    const named = [...availabilityStore.listEntries(), ...entries].flatMap((e) => [e.categoryId, ...(scopeOf(e) || []).flatMap((s) => s.categoryIds)]);
    const ids = new Set([...(Array.isArray(config.categoryIds) ? config.categoryIds : []), ...named].map(str).filter(Boolean));
    const names = Object.fromEntries([...ids].map((id) => [id, availabilityPanel.categoryNameFor(id, { config }) || ""]));
    const fromEvents = eventCategoryNames(Object.keys(names).filter((id) => !names[id]));
    for (const id of Object.keys(fromEvents)) names[id] = fromEvents[id];
    return names;
}

/** The names an entry view reads: servers and categories (entryView, absenceOverview.raiderDetail). */
function viewNames(config, entries = []) {
    return { servers: serverNames(config), categories: categoryNamesOf(config, entries) };
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
    const names = viewNames(config);
    const view = absenceOverview.raiderDetail(userId, { versionId: versionOf(query, config), config, withReasons: isOrga(user), categoryNames: names.categories, servers: names.servers });
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
        // #990: the raider's own view never shows "left early"; the orga's view of somebody else does
        neutral: String(target.userId) === String(user.id),
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
    { method: "PUT", path: "/api/availability", handler: putEntry, area: "signup" },
    { method: "DELETE", path: "/api/availability", handler: deleteEntry, area: "signup" },
    { method: "GET", path: "/api/availability/panels", handler: getPanels, area: "settings" },
    { method: "POST", path: "/api/availability/panel", handler: postPanel, area: "settings" },
    { method: "DELETE", path: "/api/availability/panel", handler: deletePanel, area: "settings" },
    { method: "PUT", path: "/api/availability/links", handler: putLinks, area: "settings" },
    { method: "PUT", path: "/api/availability/features", handler: putFeatures, area: "settings" },
];

module.exports = { routes, _internal: { entryView, characterChoices, targetOf, knownHubCategory, mayTouchEntry, mayUseScope, knownCategory } };
