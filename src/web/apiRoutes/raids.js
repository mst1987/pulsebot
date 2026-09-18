const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const { loadEventGroups, eventLookbackSince } = require("../raidEventGroups");
const { upcomingRows, loadPastRaids, raidContentIds } = require("../raidListing");
const { getConfig, listRaidTemplates } = require("../settingsStore");
const { createEvent, updateEvent } = require("../eventCreate");
const { decorateTemplate } = require("../raidTemplates");
const eventStore = require("../eventStore");
const { getChannelConfig } = require("../channelArchiveStore");
const { publicVersions, DEFAULT_VERSION } = require("../../config/gameVersions");
const { DEFAULT_SCHEMA } = require("../../utils/channelNames");
const { deriveChannelName } = require("../channelNaming");
const { signupSourceFor } = require("../eventSources");
const discord = require("../discord");

/**
 * GET /api/raids — the active guild's upcoming events of both sources
 * (Raid-Helper and EventHelper) as flat rows, each with its raid content(s),
 * raid size and soft-reserve link (raidListing.js).
 */
async function getRaids(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    const { groups, error: err } = await loadEventGroups(guildId);
    // The server's name goes into the page's kicker ("Raid-Helper · Pulse").
    const guild = guildId ? (discord.listGuilds() || []).find((g) => g.id === guildId) : null;
    ok(res, { events: upcomingRows(groups), error: err, activeGuildId: guildId, guildName: (guild && guild.name) || "" });
}

/**
 * GET /api/raids/past — the raids that already took place, newest first, with
 * their logs, open log decisions and loot count. Its own request because it
 * rescans the event snapshot and assigns fresh logs first, which the coming
 * raids have no need to wait for.
 */
async function getPastRaids(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    const { events, error: err } = await loadPastRaids(guildId);
    ok(res, { events, error: err, activeGuildId: guildId });
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

/**
 * GET /api/raids/new — everything the create dialog needs: defaults, channels,
 * categories, raid templates, the rule set, the naming schemas and reusable
 * events. With ?event=<own id> also the event to edit (#261): the same dialog
 * opens prefilled for an EventHelper event.
 */
async function getRaidCreateContext(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    // Events that can be repeated for a new date — upcoming ones and those of the
    // lookback window, so a series whose next raid is not scheduled yet can still
    // be continued. Best-effort: an API error just leaves the list short
    // (loadEventGroups already swallows it).
    const { groups } = await loadEventGroups(guildId, { sinceSeconds: eventLookbackSince() });
    const reusableEvents = groups.flatMap((g) => g.events.map((ev) => ({
        id: ev.id, source: ev.source || "raidhelper", title: ev.title, templateId: ev.templateId,
        description: ev.description, channelId: ev.channelId, channelName: ev.channelName,
        categoryId: g.categoryId || "", categoryName: g.categoryName || "",
        startTime: ev.startTime || 0,
        contentIds: raidContentIds({ title: ev.title, categoryName: g.categoryName, channelName: ev.channelName, instanceIds: ev.instanceIds }).contentIds,
    })));
    const config = getConfig();
    const templates = listRaidTemplates();
    const categoryDefaults = config.categoryRaidTemplate || {};
    // The default template per category, as the Raid-Helper template id the
    // create form sends — a category whose default links none has no entry.
    const rhById = new Map(templates.map((t) => [t.id, t.raidhelperTemplateId]));
    const categoryTemplates = Object.fromEntries(Object.entries(categoryDefaults)
        .map(([catId, tplId]) => [catId, rhById.get(tplId) || ""])
        .filter(([, rhId]) => rhId));
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
        categories: safeList(() => discord.listCategories(guildId)),
        categoryRaidTemplates: categoryDefaults,
        raidTemplates: templates.map((t) => decorateTemplate({ instanceIds: [], ...t }, categoryDefaults)),
        versions: publicVersions(),
        defaultVersion: DEFAULT_VERSION,
        channelSchemas: channelSchemas(guildId),
        defaultSchema: DEFAULT_SCHEMA,
        editEvent: editEventFor(url, guildId),
    });
}

/**
 * GET /api/raids/channel-name?categoryId=&date=2026-09-24&instanceIds=ssc,tk[&sourceEventId=]
 * — the name a new event channel gets and where it comes from (#285): like the
 * category's previous event channel, by its stored schema or the default one.
 * The create dialog shows it as its name suggestion plus one badge.
 */
async function getChannelName(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
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
}

/**
 * POST /api/raids — create an event, optionally cloning a source event's
 * channel or creating a new one by the category's schema. Raid-Helper or the
 * own store, by the category's default source; the work is eventCreate.js',
 * shared with the Discord modal (#260).
 */
async function createRaid(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const result = await createEvent({ guildId: activeGuildFor(req), user, body });
    if (result.error) return error(res, result.error.status, result.error.code, result.error.message);
    ok(res, result.body, result.status);
}

/**
 * PATCH /api/raids — change an own (EventHelper) event with the create
 * dialog's fields. Body: { id, … }; a Raid-Helper id is refused (#261).
 */
async function updateRaid(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const result = await updateEvent({ guildId: activeGuildFor(req), body, user, byName: user.name });
    if (result.error) return error(res, result.error.status, result.error.code, result.error.message);
    ok(res, result.body, result.status);
}

module.exports = { getRaids, getPastRaids, getRaidCreateContext, getChannelName, createRaid, updateRaid };
