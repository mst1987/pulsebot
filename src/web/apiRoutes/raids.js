const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const { loadEventGroups, eventLookbackSince } = require("../raidEventGroups");
const { upcomingRows, loadPastRaids, raidContentIds } = require("../raidListing");
const { getConfig, listRaidTemplates } = require("../settingsStore");
const { createEvent } = require("../eventCreate");
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

/** GET /api/raids/new — everything the create dialog needs: defaults, channels, templates, reusable events. */
async function getRaidCreateContext(req, res) {
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
    // The default template per category, as the Raid-Helper template id the
    // create form sends — a category whose default links none has no entry.
    const rhById = new Map(templates.map((t) => [t.id, t.raidhelperTemplateId]));
    const categoryTemplates = Object.fromEntries(Object.entries(config.categoryRaidTemplate || {})
        .map(([catId, tplId]) => [catId, rhById.get(tplId) || ""])
        .filter(([, rhId]) => rhId));
    const channels = discord.listTextChannels(guildId);
    const channelId = (config.raidDefaults || {}).channelId || "";
    const defaultChannel = (channels || []).find((c) => c.id === channelId);
    ok(res, {
        defaults: {
            channelId,
            templateId: (defaultChannel && categoryTemplates[defaultChannel.parentId]) || "",
        },
        categoryTemplates,
        leaderId: user.id,
        channels,
        templates,
        reusableEvents,
        // Which categories create their new events in the EventHelper (missing = Raid-Helper).
        signupSources: getConfig().categorySignupSource || {},
    });
}

/**
 * POST /api/raids — create an event, optionally cloning a source event's
 * channel. Raid-Helper or the own store, by the category's default source;
 * the work is eventCreate.js', shared with the Discord modal (#260).
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

module.exports = { getRaids, getPastRaids, getRaidCreateContext, createRaid };
