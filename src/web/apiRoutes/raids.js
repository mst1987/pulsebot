const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const { loadEventGroups } = require("../raidEventGroups");
const { getConfig, listRaidTemplates } = require("../settingsStore");
const discord = require("../discord");
const Raidhelper = require("../../classes/raidhelper");
const { toRaidHelperDate } = require("../../utils/date");

/** GET /api/raids — all upcoming Raid-Helper events of the active guild, grouped by Discord category. */
async function getRaids(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    const { groups, error: err } = await loadEventGroups(guildId);
    ok(res, { groups, error: err, activeGuildId: guildId });
}

/** GET /api/raids/new — everything the create form needs: defaults, channels, reusable events. */
async function getRaidCreateContext(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    // Existing events feed the "reuse an event for a new date" picker. Best-effort:
    // an API error just leaves the picker empty (loadEventGroups already swallows it).
    const { groups } = await loadEventGroups(guildId);
    const reusableEvents = groups.flatMap((g) => g.events).map((ev) => ({
        id: ev.id, title: ev.title, templateId: ev.templateId,
        description: ev.description, channelId: ev.channelId, channelName: ev.channelName,
    }));
    ok(res, {
        defaults: getConfig().raidDefaults,
        leaderId: user.id,
        channels: discord.listTextChannels(guildId),
        templates: listRaidTemplates(),
        reusableEvents,
    });
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
        const rh = new Raidhelper();
        let channelId = String(body.channelId || "").trim();
        const sourceEventId = String(body.sourceEventId || "").trim();
        // Reuse an existing event for a new date: clone its channel (name taken
        // over and edited by the admin), then post the new event there.
        if (sourceEventId) {
            const guildId = activeGuildFor(req);
            const { groups } = await loadEventGroups(guildId);
            const source = groups.flatMap((g) => g.events).find((ev) => ev.id === sourceEventId);
            if (!source) return error(res, 400, "source_not_found", "Ausgangs-Event nicht gefunden.");
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

module.exports = { getRaids, getRaidCreateContext, createRaid };
