const { ok } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { sendResult } = require("../http/apiResult");
const { activeGuildFor } = require("../http/activeGuild");
const { loadEventGroups, eventLookbackSince } = require("../../services/events/raidEventGroups");
const { upcomingRows, loadPastRaids, raidContentIds } = require("../../services/events/raidListing");
const { getConfig, listRaidTemplates } = require("../../stores/settingsStore");
const { createEvent, updateEvent } = require("../../services/events/eventCreate");
const { decorateTemplate } = require("../../services/events/raidTemplates");
const eventStore = require("../../stores/eventStore");
const { getChannelConfig } = require("../../stores/channelArchiveStore");
const { publicVersions } = require("../../config/gameVersions");
const { mainVersionFor, resolveVersionQuery, visibleVersions, visibleRows } = require("../../services/events/mainVersion");
const { versionChoices } = require("../../services/characters/characterVersions");
const { DEFAULT_SCHEMA } = require("../../utils/channelNames");
const { deriveChannelName } = require("../../services/discord/channelNaming");
const { signupSourceFor } = require("../../services/events/eventSources");
const { listSignups } = require("../../stores/signupStore");
const discord = require("../../services/discord/discord");
const linkCheck = require("../../services/discord/linkCheck");
const { raidViewer, visibleEvents } = require("../../services/signups/eventVisibility");

/**
 * GET /api/raids[?version=<id>|all] — the active guild's upcoming events of
 * both sources (Raid-Helper and EventHelper) as flat rows, each with its raid
 * content(s), raid size and soft-reserve link (raidListing.js). Filtered by
 * game version (#545): the main version unless the page asks for another or
 * "all" — see mainVersion.resolveVersionQuery. A raider sees the raids of the
 * categories they may see and the ones they signed up for (eventVisibility.js).
 */
const getRaids = withUser({}, async ({ user, req, res, url }) => {
    const guildId = activeGuildFor(req);
    const { groups, error: err } = await loadEventGroups(guildId);
    // The server's name goes into the page's kicker ("Raid-Helper · Pulse").
    const guild = guildId ? (discord.listGuilds() || []).find((g) => g.id === guildId) : null;
    const config = getConfig();
    const viewer = await raidViewer(user, guildId, { config });
    const signUps = new Map((groups || []).flatMap((g) => (g.events || []).map((e) => [e.id, e.signUps])));
    // channelState per row (#537): the list links the Discord post only while the channel exists.
    const rows = linkCheck.withChannelState(guildId, visibleEvents(upcomingRows(groups), viewer, (row) => signUps.get(row.id)));
    const { versionId, mainVersion } = resolveVersionQuery(url.searchParams.get("version"), { config });
    const events = versionId ? rows.filter((r) => r.versionId === versionId) : rows;
    ok(res, {
        events, error: err, activeGuildId: guildId, guildName: (guild && guild.name) || "",
        version: versionId, mainVersion, versions: versionChoices(rows.map((r) => ({ versionIds: [r.versionId] })), mainVersion),
    });
});

/**
 * GET /api/raids/past[?version=<id>|all] — the raids that already took place,
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
    const viewer = await raidViewer(user, guildId, { config });
    const shown = visibleEvents(all, viewer);
    const rows = linkCheck.withChannelState(guildId, viewer.orga ? shown : shown.map(withoutLogs));
    const { versionId, mainVersion } = resolveVersionQuery(url.searchParams.get("version"), { config });
    const events = versionId ? rows.filter((r) => r.versionId === versionId) : rows;
    ok(res, {
        events, error: err, activeGuildId: guildId,
        version: versionId, mainVersion, versions: versionChoices(rows.map((r) => ({ versionIds: [r.versionId] })), mainVersion),
    });
});

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
 * @returns {Promise<{ id: string, name: string }[]>}
 */
async function leaderCandidates(guildId, user, editEvent) {
    const ids = [String(user.id)];
    // the character a raider signed up with — the label while Discord has no name for them
    const characters = {};
    if (editEvent && editEvent.leaderId) ids.push(String(editEvent.leaderId));
    try {
        const events = editEvent ? [editEvent] : eventStore.listEvents(guildId, { sinceSeconds: eventLookbackSince() });
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
 * GET /api/raids/new — everything the create dialog needs: defaults, channels,
 * categories, raid templates, the rule set, the naming schemas and reusable
 * events. With ?event=<own id> also the event to edit (#261): the same dialog
 * opens prefilled for an EventHelper event.
 */
const getRaidCreateContext = withUser({}, async ({ user, req, res, url }) => {
    const guildId = activeGuildFor(req);
    // Events that can be repeated for a new date — upcoming ones and those of the
    // lookback window, so a series whose next raid is not scheduled yet can still
    // be continued. Best-effort: an API error just leaves the list short
    // (loadEventGroups already swallows it).
    const { groups } = await loadEventGroups(guildId, { sinceSeconds: eventLookbackSince() });
    const config = getConfig();
    // Other versions hidden (#563): their events, templates, categories and rule sets are not offered.
    const visible = new Set(visibleVersions(config));
    const categoryShown = (id) => visible.has(mainVersionFor({ categoryId: id, config }));
    const reusableEvents = groups.filter((g) => categoryShown(g.categoryId)).flatMap((g) => g.events.map((ev) => ({
        id: ev.id, source: ev.source || "raidhelper", title: ev.title, templateId: ev.templateId,
        description: ev.description, channelId: ev.channelId, channelName: ev.channelName,
        categoryId: g.categoryId || "", categoryName: g.categoryName || "",
        startTime: ev.startTime || 0,
        contentIds: raidContentIds({ title: ev.title, categoryName: g.categoryName, channelName: ev.channelName, instanceIds: ev.instanceIds }).contentIds,
    })));
    const templates = visibleRows(listRaidTemplates(), (t) => t.versionId, config);
    const categoryDefaults = config.categoryRaidTemplate || {};
    // The default template per category, as the Raid-Helper template id the
    // create form sends — a category whose default links none has no entry.
    const rhById = new Map(templates.map((t) => [t.id, t.raidhelperTemplateId]));
    const categoryTemplates = Object.fromEntries(Object.entries(categoryDefaults)
        .map(([catId, tplId]) => [catId, rhById.get(tplId) || ""])
        .filter(([, rhId]) => rhId));
    const editEvent = editEventFor(url, guildId);
    const channels = safeList(() => discord.listTextChannels(guildId));
    const channelId = (config.raidDefaults || {}).channelId || "";
    const defaultChannel = channels.find((c) => c.id === channelId);
    ok(res, {
        defaults: {
            channelId,
            templateId: (defaultChannel && categoryTemplates[defaultChannel.parentId]) || "",
        },
        categoryTemplates,
        leaderId: user.id,
        leaderCandidates: await leaderCandidates(guildId, user, editEvent),
        channels,
        // The raid's voice channel (#305) and the preset per category.
        voiceChannels: safeList(() => discord.listVoiceChannels(guildId)),
        categoryVoiceChannel: config.categoryVoiceChannel || {},
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
        categories: safeList(() => discord.listCategories(guildId)).filter((c) => categoryShown(c.id)),
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
const createRaid = withUser({ csrf: true, body: true }, async ({ user, body, req, res }) => {
    const result = await createEvent({ guildId: activeGuildFor(req), user, body });
    if (result.error) return sendResult(res, result);
    ok(res, result.body, result.status);
});

/**
 * PATCH /api/raids — change an own (EventHelper) event with the create
 * dialog's fields. Body: { id, … }; a Raid-Helper id is refused (#261).
 */
const updateRaid = withUser({ csrf: true, body: true, archived: (body) => body.id }, async ({ user, body, req, res }) => {
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
