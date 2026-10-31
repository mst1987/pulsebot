const { ok } = require("../../http/apiResponse");
const { withUser } = require("../../http/apiHandler");
const { sendResult } = require("../../http/apiResult");
const { activeGuildFor } = require("../../http/activeGuild");
const { serverSetting } = require("../../../services/discord/servers/serverSettings");
const { loadEventGroups, eventLookbackSince } = require("../../../services/events/raidEventGroups");
const { upcomingRows, loadPastRaids, raidContentIds } = require("../../../services/events/overview/raidListing");
const { getConfig, listRaidTemplates } = require("../../../stores/settings/settingsStore");
const { createEvent, updateEvent } = require("../../../services/events/eventCreate");
const { decorateTemplate } = require("../../../services/events/raidTemplates");
const eventStore = require("../../../stores/events/eventStore");
const { getChannelConfig } = require("../../../stores/discord/channelArchiveStore");
const { publicVersions } = require("../../../config/gameVersions");
const { mainVersionFor, versionOfEvent, resolveVersionQuery, visibleVersions, knownVersion } = require("../../../services/versions/mainVersion");
const { versionChoices } = require("../../../services/characters/characterVersions");
const { DEFAULT_SCHEMA } = require("../../../utils/channelNames");
const { deriveChannelName } = require("../../../services/discord/channelNaming");
const { signupSourceFor } = require("../../../services/events/eventSources");
const { listSignups } = require("../../../stores/events/signupStore");
const discord = require("../../../services/discord/discord");
const linkCheck = require("../../../services/discord/linkCheck");
const { raidViewer, visibleEvents } = require("../../../services/signups/eventVisibility");
const { userCan } = require("../../../config/permissions");
const { isGlobalRaidOrga, canOrgaRaid, canCreateRaids, withOrgaFlags } = require("../../events/raidOrgaAccess");
const { requestCache } = require("../../../services/roster/categoryOrga");
const { newEventRow, eventCategoryScope, createGuard, updateRefusal, foreignChannelRefusal } = require("../../events/eventCreateAccess");

/**
 * GET /api/raids[?version=<id>] — the active guild's upcoming events of both
 * sources (Raid-Helper and EventHelper) as flat rows, each with its raid
 * content(s), raid size and soft-reserve link (raidListing.js). One game
 * version (#545, #741): the main version unless the page asks for another —
 * see mainVersion.resolveVersionQuery. A raider sees the raids of the
 * categories they may see and the ones they signed up for (eventVisibility.js).
 */
const getRaids = withUser({}, async ({ user, req, res, url }) => {
    const guildId = activeGuildFor(req);
    const { groups, error: err } = await loadEventGroups(guildId);
    // The server's name goes into the page's kicker ("Raid-Helper · Pulse").
    const guild = guildId ? (discord.listGuilds() || []).find((g) => g.id === guildId) : null;
    const config = getConfig();
    const viewer = await raidViewer(user, guildId, { config, cache: requestCache(req) });
    const signUps = new Map((groups || []).flatMap((g) => (g.events || []).map((e) => [e.id, e.signUps])));
    // channelState per row (#537): the list links the Discord post only while the channel exists.
    const rows = linkCheck.withChannelState(guildId, visibleEvents(upcomingRows(groups), viewer, (row) => signUps.get(row.id)));
    const { versionId, mainVersion } = resolveVersionQuery(url.searchParams.get("version"), { config });
    const shown = versionId ? rows.filter((r) => r.versionId === versionId) : rows;
    // per row whether the caller is its orga (#729): "Wiederholen" and "Kanal fehlt" follow it
    const events = await withOrgaFlags(user, shown, req, { groups });
    ok(res, {
        // the Raid-Helper sync message points into the settings: the orga's, a raider just gets the list
        events, error: viewer.orga ? err : null, activeGuildId: guildId, guildName: (guild && guild.name) || "",
        version: versionId, mainVersion, versions: versionChoices(rows.map((r) => ({ versionIds: [r.versionId] })), mainVersion),
        ...await orgaFields(user, viewer, req),
    });
});

/**
 * What a raid list says about the caller (#729): `orga` - the global orga, or the orga of a category (the
 * page's orga parts: the series, the logs column); `canCreate` - POST /api/raids lets them create
 * (raidOrgaAccess.canCreateRaids): "Neues Event".
 */
async function orgaFields(user, viewer, req) {
    return {
        orga: !!viewer.orga || (viewer.orgaCategories || []).length > 0,
        canCreate: await canCreateRaids(user, req),
    };
}

/**
 * GET /api/raids/past[?version=<id>] — the raids that already took place,
 * newest first, with their logs, open log decisions and loot count. Its own
 * request because it rescans the event snapshot and assigns fresh logs first,
 * which the coming raids have no need to wait for. Filtered by game version
 * (#545) like GET /api/raids. A raider sees the same raids as there
 * (eventVisibility.js) and no log details: the logs are the orga's work.
 */
const getPastRaids = withUser({}, async ({ user, req, res, url }) => {
    const guildId = activeGuildFor(req);
    const { events: all, error: err } = await loadPastRaids(guildId);
    const config = getConfig();
    const viewer = await raidViewer(user, guildId, { config, cache: requestCache(req) });
    const shown = linkCheck.withChannelState(guildId, visibleEvents(all, viewer));
    const { versionId, mainVersion } = resolveVersionQuery(url.searchParams.get("version"), { config });
    const inVersion = versionId ? shown.filter((r) => r.versionId === versionId) : shown;
    // the logs are the orga's work: the global orga's rows keep them, and the rows the caller is the orga of (#729)
    const flagged = await withOrgaFlags(user, inVersion, req);
    // an unassigned log names the other raids it fits: the global orga all of them, a category's orga those of its categories
    const scope = viewer.orga ? null : new Set(viewer.orgaCategories || []);
    const events = flagged.map((row) => (viewer.orga || row.canOrga ? scopedAlsoFits(row, scope) : withoutLogs(row)));
    ok(res, {
        events, error: viewer.orga ? err : null, activeGuildId: guildId,
        version: versionId, mainVersion, versions: versionChoices(shown.map((r) => ({ versionIds: [r.versionId] })), mainVersion),
        ...await orgaFields(user, viewer, req),
    });
});

/**
 * A past raid's open log decisions with `alsoFits` cut to the raids of `scope` (the categories of a category's
 * orga, #729 review: the titles of other categories' raids are not theirs); null = every raid. The helper field
 * `alsoFitsCategoryIds` never leaves the server.
 */
function scopedAlsoFits(row, scope) {
    if (!Array.isArray(row.pendingLogs)) return row;
    const pendingLogs = row.pendingLogs.map((p) => {
        const ids = p.alsoFitsCategoryIds || [];
        const alsoFits = scope ? (p.alsoFits || []).filter((_, i) => scope.has(String(ids[i] || ""))) : (p.alsoFits || []);
        return { title: p.title, alsoFits };
    });
    return { ...row, pendingLogs };
}

/** A past raid's row without its logs, for a raider (the loot count stays: loot is for everyone). */
function withoutLogs(row) {
    return { ...row, logs: [], pendingLogs: [], pendingLogCount: 0 };
}

/** A Discord list that may throw while the bot is offline — [] then. */
function safeList(fn) {
    try {
        return fn() || [];
    } catch {
        return [];
    }
}

/**
 * `{ [categoryId]: source }` for every listed category and every category with
 * a stored source, each resolved through signupSourceFor (#291), so the create
 * dialog needs to know nothing about the default.
 */
function resolvedSignupSources(config, categories) {
    const ids = new Set([...(categories || []).map((c) => String(c && c.id)), ...Object.keys(config.categorySignupSource || {})]);
    ids.delete("");
    ids.delete("undefined");
    return Object.fromEntries([...ids].map((id) => [id, signupSourceFor(id, config)]));
}

/** The channel naming schema per category (Kanäle, #259); {} when unreadable. */
function channelSchemas(guildId) {
    try {
        const schemas = getChannelConfig(guildId).schemas || {};
        return Object.fromEntries(Object.entries(schemas)
            .map(([catId, s]) => [catId, { schema: (s && s.schema) || "", raid: (s && s.raid) || "" }]));
    } catch {
        return {};
    }
}

/** The own event ?event= names, for the dialog's edit mode; null for none, a Raid-Helper id or another server's event. */
function editEventFor(url, guildId) {
    const id = url && url.searchParams ? String(url.searchParams.get("event") || "").trim() : "";
    if (!id || !eventStore.isOwnEventId(id)) return null;
    const event = eventStore.getEvent(id);
    return event && (!guildId || !event.guildId || event.guildId === guildId) ? event : null;
}

/** How many signed-up people at most the leader dropdown lists. */
const MAX_LEADER_CANDIDATES = 60;

/** How long the create dialog's request waits for Discord's names of the leader candidates. */
const LEADER_NAMES_WAIT_MS = 400;

/**
 * Who can lead an event, for the create dialog's dropdown: the one creating it
 * (first), the leader of the event being edited, and everybody signed up to the
 * event being edited — or, for a new event, to the guild's own events from the
 * lookback window on. Discord user ids with a name each, without duplicates.
 * @param {string} guildId
 * @param {{ id: string, name?: string }} user  the orga creating the event
 * @param {object|null} editEvent  the own event being edited, if any
 * @param {Set<string>|null} [scope]  only the events of these categories (the orga of a category, #728); null = all
 * @returns {Promise<{ id: string, name: string }[]>}
 */
async function leaderCandidates(guildId, user, editEvent, scope = null) {
    const ids = [String(user.id)];
    // the character a raider signed up with — the label while Discord has no name for them
    const characters = {};
    if (editEvent && editEvent.leaderId) ids.push(String(editEvent.leaderId));
    try {
        const events = (editEvent ? [editEvent] : eventStore.listEvents(guildId, { sinceSeconds: eventLookbackSince() }))
            .filter((ev) => !scope || scope.has(String(ev.categoryId || "")));
        for (const ev of events) {
            for (const s of listSignups(ev.id)) {
                if (!s || !s.userId) continue;
                ids.push(String(s.userId));
                if (s.character && !characters[s.userId]) characters[s.userId] = String(s.character);
            }
        }
    } catch {
        // the store is unreadable: the creator alone is still a valid answer
    }
    const unique = [...new Set(ids)].slice(0, MAX_LEADER_CANDIDATES);
    let names = {};
    try {
        // The dialog does not wait for Discord: a name not known within LEADER_NAMES_WAIT_MS
        // shows the signup's character, and the lookup fills the cache for the next open.
        names = (await discord.resolveUserNames(guildId, unique.filter((id) => id !== String(user.id)), { waitMs: LEADER_NAMES_WAIT_MS })) || {};
    } catch {
        names = {};
    }
    return unique.map((id) => ({ id, name: id === String(user.id) ? user.name || names[id] || "" : names[id] || characters[id] || "" }));
}

/**
 * GET /api/raids/new[?event=<own id>][&version=<id>] — everything the create
 * dialog needs: defaults, channels, categories, raid templates, the rule set,
 * the naming schemas and the reusable events of the shown game version (#741).
 * With ?event=<own id> also the event to edit (#261): the same dialog opens
 * prefilled for an EventHelper event.
 * Everyone but the global orga with `raids` write (#728) gets only the categories whose current roster
 * they manage - and with them only the channels, voice channels, raids to repeat and leader candidates
 * of those categories, and an event to edit only when it is one of their raids (a raider: none).
 */
const getRaidCreateContext = withUser({}, async ({ user, req, res, url }) => {
    const guildId = activeGuildFor(req);
    const scope = await eventCategoryScope(user, req);
    const inScope = (categoryId) => !scope || scope.has(String(categoryId || ""));
    // Events that can be repeated for a new date — upcoming ones and those of the
    // lookback window, so a series whose next raid is not scheduled yet can still
    // be continued. Best-effort: an API error just leaves the list short
    // (loadEventGroups already swallows it).
    const { groups } = await loadEventGroups(guildId, { sinceSeconds: eventLookbackSince() });
    const config = getConfig();
    // Other versions hidden (#563): their events, templates, categories and rule sets are not offered.
    const visible = new Set(visibleVersions(config));
    // The raids to repeat are those of the version the page shows (#741, `?version=`):
    // each by its own stored version, not by what its category plays today — an
    // old TBC raid of a category that moved on to Forever stays a TBC raid.
    const { versionId: shownVersion } = resolveVersionQuery(url && url.searchParams.get("version"), { config });
    const editCandidate = editEventFor(url, guildId);
    const editEvent = editCandidate && (!scope || await canOrgaRaid(user, editCandidate, req)) ? editCandidate : null;
    // The dialog is one of the shown version (#741): only the categories that play
    // it and its raid templates. The category of the event being edited stays,
    // whatever it plays now (a raid keeps its version, #737).
    const categoryShown = (id) => (editEvent && editEvent.categoryId === id) || mainVersionFor({ categoryId: id, config }) === shownVersion;
    const reusableEvents = groups.flatMap((g) => g.events.map((ev) => {
        const versionId = versionOfEvent({ id: ev.id, versionId: ev.versionId, categoryId: g.categoryId }, { config });
        return {
            id: ev.id, source: ev.source || "raidhelper", title: ev.title, templateId: ev.templateId,
            description: ev.description, channelId: ev.channelId, channelName: ev.channelName,
            categoryId: g.categoryId || "", categoryName: ev.categoryName || g.categoryName || "",
            startTime: ev.startTime || 0,
            versionId,
            contentIds: raidContentIds({ title: ev.title, categoryName: g.categoryName, channelName: ev.channelName, instanceIds: ev.instanceIds, versionId }).contentIds,
        };
    })).filter((ev) => ev.versionId === shownVersion && inScope(ev.categoryId));
    const templates = listRaidTemplates().filter((t) => (knownVersion(t.versionId) || mainVersionFor({ config })) === shownVersion);
    const categoryDefaults = config.categoryRaidTemplate || {};
    // The default template per category, as the Raid-Helper template id the
    // create form sends — a category whose default links none has no entry.
    const rhById = new Map(templates.map((t) => [t.id, t.raidhelperTemplateId]));
    const categoryTemplates = Object.fromEntries(Object.entries(categoryDefaults)
        .map(([catId, tplId]) => [catId, rhById.get(tplId) || ""])
        .filter(([, rhId]) => rhId));
    const channels = safeList(() => discord.listTextChannels(guildId)).filter((c) => inScope(c.parentId));
    const presetVoice = config.categoryVoiceChannel || {};
    const ownPresets = new Set(Object.entries(presetVoice).filter(([catId]) => inScope(catId)).map(([, id]) => String(id)));
    // The preset channel of the active server (#924): another server's preset is no channel here,
    // and only a channel of the offered list counts.
    const presetChannel = String((serverSetting(guildId, "raidDefaults", { config }) || {}).channelId || "");
    const channelId = presetChannel && channels.some((c) => c.id === presetChannel) ? presetChannel : "";
    const defaultChannel = channels.find((c) => c.id === channelId);
    ok(res, {
        defaults: {
            channelId,
            templateId: (defaultChannel && categoryTemplates[defaultChannel.parentId]) || "",
        },
        categoryTemplates,
        leaderId: user.id,
        leaderCandidates: await leaderCandidates(guildId, user, editEvent, scope),
        channels,
        // The raid's voice channel (#305) and the preset per category - for the orga of a category those
        // of their categories (eventCreateAccess.voiceAllowed).
        voiceChannels: safeList(() => discord.listVoiceChannels(guildId)).filter((c) => inScope(c.parentId) || ownPresets.has(String(c.id))),
        categoryVoiceChannel: Object.fromEntries(Object.entries(presetVoice).filter(([catId]) => inScope(catId))),
        // "Als Vorlage speichern" writes a raid template - global, area `raids` write (#728: not the category's)
        canSaveTemplate: userCan(user, "raids", "write"),
        templates,
        reusableEvents,
        // Where each category creates its new events, resolved on the server
        // (#291: a category nobody picked a source for follows signupSourceDefault,
        // EventHelper for a new one) — the dialog only reads "eventhelper".
        signupSources: resolvedSignupSources(config, safeList(() => discord.listCategories(guildId))),
        // "Beim Anlegen ankündigen" per category (#306) — the dialog's switch starts there.
        categoryAnnounce: config.categoryAnnounce || {},
        // The planning step (#261): categories, the raid templates with their
        // badges and the default per category, the rule set, the naming schemas.
        categories: safeList(() => discord.listCategories(guildId)).filter((c) => categoryShown(c.id) && inScope(c.id)),
        categoryRaidTemplates: categoryDefaults,
        raidTemplates: templates.map((t) => decorateTemplate({ instanceIds: [], ...t }, categoryDefaults)),
        versions: publicVersions().filter((v) => visible.has(v.id)),
        // The main version (#541) and the categories that play another one: a
        // plan without a template starts in the version of its category.
        defaultVersion: mainVersionFor({ config }),
        categoryVersions: config.categoryVersion || {},
        channelSchemas: channelSchemas(guildId),
        defaultSchema: DEFAULT_SCHEMA,
        editEvent,
    });
});

/**
 * GET /api/raids/channel-name?categoryId=&date=2026-09-24&instanceIds=ssc,tk[&sourceEventId=]
 * — the name a new event channel gets and where it comes from (#285): like the
 * category's previous event channel, by its stored schema or the default one.
 * The create dialog shows it as its name suggestion plus one badge.
 */
const getChannelName = withUser({}, async ({ req, res, url }) => {
    const guildId = activeGuildFor(req);
    const q = (key) => String((url && url.searchParams && url.searchParams.get(key)) || "").trim();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(q("date")) ? q("date") : "";
    const instanceIds = q("instanceIds").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10);
    const result = await deriveChannelName({
        guildId, categoryId: q("categoryId"), date, instanceIds, fromEventId: q("sourceEventId"),
    });
    const shown = { ...result };
    delete shown.placement; // where Discord sorts it in is the server's business
    ok(res, shown);
});

/**
 * POST /api/raids — create an event, optionally cloning a source event's
 * channel or creating a new one by the category's schema. Raid-Helper or the
 * own store, by the category's default source; the work is eventCreate.js',
 * shared with the Discord modal (#260).
 */
const createRaid = withUser({ orgaScoped: newEventRow, write: "raids", csrf: true, body: true }, async ({ user, body, req, res }) => {
    // The orga of a category (#728) creates in their categories only, in the version the category plays
    // now, with channels of that category (eventCreateAccess.js) - checked on what createEvent works out.
    // Every channel of the request belongs to the active server (#925), before anything is cloned or
    // posted - for the global orga too: their rights hold on this server only, a full admin on all.
    const foreign = foreignChannelRefusal(user, req, body);
    if (foreign) return sendResult(res, foreign);
    const guard = isGlobalRaidOrga(user) ? null : createGuard(user, req);
    const result = await createEvent({ guildId: activeGuildFor(req), user, body, guard });
    if (result.error) return sendResult(res, result);
    ok(res, result.body, result.status);
});

/**
 * PATCH /api/raids — change an own (EventHelper) event with the create
 * dialog's fields. Body: { id, … }; a Raid-Helper id is refused (#261).
 * The orga of the raid's category as well (#728), without changing its version.
 */
const updateRaid = withUser({ orgaScoped: (body) => body.id, write: "raids", csrf: true, body: true, archived: (body) => body.id }, async ({ user, body, req, res }) => {
    // a changed voice channel belongs to the active server (#925)
    const id = String(body.id || "").trim();
    const before = eventStore.isOwnEventId(id) ? eventStore.getEvent(id) : null;
    const voice = String(body.voiceChannelId === undefined || body.voiceChannelId === null ? "" : body.voiceChannelId).trim();
    if (body.voiceChannelId !== undefined && voice !== String((before && before.voiceChannelId) || "").trim()) {
        const foreign = foreignChannelRefusal(user, req, { voiceChannelId: voice });
        if (foreign) return sendResult(res, foreign);
    }
    if (!isGlobalRaidOrga(user)) {
        const current = eventStore.isOwnEventId(String(body.id || "").trim()) ? eventStore.getEvent(String(body.id).trim()) : null;
        const refused = current ? updateRefusal(current, body, req) : null;
        if (refused) return sendResult(res, refused);
    }
    const result = await updateEvent({ guildId: activeGuildFor(req), body, user, byName: user.name });
    if (result.error) return sendResult(res, result);
    ok(res, result.body, result.status);
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/raids", handler: getRaids, area: "raids" },
    { method: "GET", path: "/api/raids/past", handler: getPastRaids, area: "raids" },
    { method: "GET", path: "/api/raids/new", handler: getRaidCreateContext, area: "raids" },
    { method: "GET", path: "/api/raids/channel-name", handler: getChannelName, area: "raids" },
    { method: "POST", path: "/api/raids", handler: createRaid, area: "raids" },
    { method: "PATCH", path: "/api/raids", handler: updateRaid, area: "raids" },
];

module.exports = { leaderCandidates, getRaids, getPastRaids, getRaidCreateContext, getChannelName, createRaid, updateRaid, routes };
