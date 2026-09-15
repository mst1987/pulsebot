const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const { loadEventGroups, eventLookbackSince } = require("../raidEventGroups");
const { getRaidEvent } = require("../raidEventStore");
const { upcomingRows, loadPastRaids, raidContentIds } = require("../raidListing");
const { getConfig, listRaidTemplates } = require("../settingsStore");
const discord = require("../discord");
const { createRaidhelperClient } = require("../../utils/raidhelperClient");
const { toRaidHelperDate } = require("../../utils/date");

/**
 * GET /api/raids — the active guild's upcoming Raid-Helper events as flat rows,
 * each with its raid content(s), raid size and soft-reserve link (raidListing.js).
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
        id: ev.id, title: ev.title, templateId: ev.templateId,
        description: ev.description, channelId: ev.channelId, channelName: ev.channelName,
        categoryId: g.categoryId || "", categoryName: g.categoryName || "",
        startTime: ev.startTime || 0,
        contentIds: raidContentIds({ title: ev.title, categoryName: g.categoryName, channelName: ev.channelName }).contentIds,
    })));
    ok(res, {
        defaults: getConfig().raidDefaults,
        leaderId: user.id,
        channels: discord.listTextChannels(guildId),
        templates: listRaidTemplates(),
        reusableEvents,
    });
}

/**
 * The channel of the event a new raid is cloned from.
 *
 * All the clone needs is that one channel id, so it is asked for **by event
 * id** instead of scanning the window the create dialog was filled from. That
 * scan was the bug behind "Ausgangs-Event nicht gefunden": it lists the guild's
 * events of the last 60 days, joins them against the live Discord channels and
 * keeps a per-window cache — so a Raid-Helper hiccup, a Discord reconnect or
 * simply enough time between opening the dialog and pressing the button could
 * leave the event out of a list it had plainly been in a minute earlier.
 *
 * Three sources, in order of authority: Raid-Helper's own event endpoint, the
 * snapshot raidEventScan.js keeps, and finally the window scan (which can still
 * know an event whose channel Discord no longer has). The failures are told
 * apart, because "Raid-Helper antwortet gerade nicht" and "das Event gibt es
 * nicht mehr" call for different things from whoever reads it.
 *
 * @returns {Promise<{channelId: string, code?: string, message?: string}>}
 */
async function sourceChannelFor(rh, guildId, sourceEventId) {
    let reachable = true;
    try {
        const ev = await rh.getEvent(sourceEventId);
        if (ev && ev.id && ev.channelId) return { channelId: String(ev.channelId) };
    } catch {
        reachable = false;
    }

    const snapshot = getRaidEvent(sourceEventId);
    if (snapshot && snapshot.channelId) return { channelId: String(snapshot.channelId) };

    const { groups } = await loadEventGroups(guildId, { sinceSeconds: eventLookbackSince() });
    const found = groups.flatMap((g) => g.events).find((ev) => ev.id === sourceEventId);
    if (found && found.channelId) return { channelId: String(found.channelId) };

    return reachable
        ? { channelId: "", code: "source_not_found", message: "Das Ausgangs-Event gibt es bei Raid-Helper nicht mehr. Wähle ein anderes oder lege den Channel selbst an." }
        : { channelId: "", code: "raidhelper_unreachable", message: "Raid-Helper antwortet gerade nicht — das Ausgangs-Event ließ sich nicht laden. Gleich noch einmal versuchen." };
}

/** POST /api/raids — create a Raid-Helper event, optionally cloning a source event's channel. */
async function createRaid(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const date = toRaidHelperDate(body.date);
    if (!date) return error(res, 400, "invalid_date", "Ungültiges Datum.");
    try {
        const rh = createRaidhelperClient();
        let channelId = String(body.channelId || "").trim();
        const sourceEventId = String(body.sourceEventId || "").trim();
        // Reuse an existing event for a new date: clone its channel (name taken
        // over and edited by the admin), then post the new event there. Looked up
        // in the same window the create dialog offered it from.
        if (sourceEventId) {
            const source = await sourceChannelFor(rh, activeGuildFor(req), sourceEventId);
            if (!source.channelId) return error(res, 400, source.code, source.message);
            const cloned = await discord.duplicateChannel(source.channelId, String(body.channelName || "").trim());
            channelId = cloned.id;
        }
        if (!channelId) return error(res, 400, "no_channel", "Kein Channel gewählt.");
        const result = await rh.createEvent({
            channelId,
            leaderId: String(body.leaderId || "").trim(),
            templateId: String(body.templateId || "").trim(),
            date,
            time: String(body.time || "").trim(),
            title: String(body.title || "").trim(),
            description: body.description || "",
        });
        if (result && result.status === "failed") {
            const msg = result.reason || result.message || "Raid-Helper hat die Erstellung abgelehnt.";
            return error(res, 400, "create_failed", msg);
        }
        ok(res, result, 201);
    } catch (e) {
        error(res, 400, "create_failed", e.message || "Event konnte nicht angelegt werden.");
    }
}

module.exports = { getRaids, getPastRaids, getRaidCreateContext, createRaid };
