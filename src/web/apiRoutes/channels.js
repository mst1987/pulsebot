const { DateTime } = require("luxon");
const { ok, error } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const { activeGuildFor } = require("../activeGuild");
const discord = require("../discord");
const discordChannels = require("../discordChannels");
const archiveStore = require("../channelArchiveStore");
const { listStoredEvents, ownUpcomingRaw } = require("../eventSources");
const { fetchEventsCached } = require("../raidEventGroups");
const { runSerial, summarize, eventStatusByChannel } = require("../channelOps");
const { getConfig, listRecruitmentPosts } = require("../settingsStore");
const { resolvePurposes, purposeSummary } = require("../channelPurposes");
const { DEFAULT_SCHEMA, PLACEHOLDERS, planChannels, renderChannelName } = require("../../utils/channelNames");

/** The word a bulk delete must be confirmed with (a single delete wants the channel's name). */
const BULK_DELETE_WORD = "LÖSCHEN";
/** How long the page waits for Raid-Helper's upcoming events before it draws without them. */
const EVENTS_TIMEOUT_MS = 4000;

/** How many tracked recruitment posts sit in each channel of the guild. */
function recruitmentPostsByChannel(guildId) {
    const counts = {};
    for (const post of listRecruitmentPosts() || []) {
        if (guildId && post.guildId && post.guildId !== guildId) continue;
        if (post.channelId) counts[post.channelId] = (counts[post.channelId] || 0) + 1;
    }
    return counts;
}

/**
 * Past events from the persisted snapshot plus the upcoming ones from Raid-Helper
 * (cached, best-effort, bounded) — without the latter a channel of next week's
 * raid would simply carry no badge, which is better than a page that hangs.
 */
async function eventsFor(guildId) {
    // Both sources: the stored past events and the EventHelper's own upcoming ones.
    const stored = [...listStoredEvents(guildId), ...ownUpcomingRaw(guildId)];
    let upcoming = [];
    let timer = null;
    try {
        const result = await Promise.race([
            fetchEventsCached(0),
            new Promise((resolve) => {
                timer = setTimeout(() => resolve(null), EVENTS_TIMEOUT_MS);
            }),
        ]);
        upcoming = (result && result.events) || [];
    } catch {
        upcoming = [];
    } finally {
        clearTimeout(timer);
    }
    return [...stored, ...upcoming];
}

/** The archive part of the page: the category, the deadline, and who waits there. */
function archiveFor(guildId, channels, connected) {
    const config = archiveStore.getChannelConfig(guildId);
    const entries = archiveStore.listArchived(guildId);
    if (connected) {
        // A channel deleted by hand in Discord has nothing left to wait for.
        const live = new Set(channels.map((c) => c.id));
        const gone = entries.filter((e) => !live.has(e.channelId)).map((e) => e.channelId);
        if (gone.length) archiveStore.forgetArchived(gone);
    }
    const archived = config.archiveCategoryId ? channels.filter((c) => c.parentId === config.archiveCategoryId) : [];
    return {
        categoryId: config.archiveCategoryId,
        ...archiveStore.archiveHint({ archived, entries, hintDays: config.archiveDeleteHintDays }),
    };
}

/**
 * GET /api/channels — the active guild's categories and channels (with the
 * bot's rights, topic and slowmode per channel), what the bot uses which
 * channel for (`purposes`, settings — see channelPurposes.js), which channels
 * carry an upcoming or past event, the archive with its waiting channels, and
 * the stored naming schemas.
 */
async function getChannels(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const guildId = activeGuildFor(req);
    const categories = discord.listCategories(guildId);
    const channels = discord.listAllChannels(guildId);
    const guild = (discord.listGuilds() || []).find((g) => g.id === guildId);
    // The lists are only live while the bot is connected to this guild; without
    // it every stored channel would read "nicht gefunden".
    const connected = !!guild;
    const purposes = resolvePurposes(getConfig(), channels, categories, connected);
    const config = archiveStore.getChannelConfig(guildId);
    ok(res, {
        categories,
        channels,
        details: discordChannels.listChannelDetails(guildId),
        activeGuildId: guildId,
        guildName: guild ? guild.name : "",
        connected,
        canManage: discordChannels.botCanManageChannels(guildId),
        purposes,
        purposeSummary: purposeSummary(purposes),
        recruitmentPosts: recruitmentPostsByChannel(guildId),
        events: guildId ? eventStatusByChannel(await eventsFor(guildId)) : {},
        archive: archiveFor(guildId, channels, connected),
        schemas: config.schemas,
        defaultSchema: DEFAULT_SCHEMA,
        placeholders: PLACEHOLDERS,
    });
}

/** POST /api/channels — create a channel in the active guild. Body: { name, type, parentId }. */
async function createChannel(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_guild", "Kein Server gewählt.");
    const body = await readJsonBody(req);
    try {
        const created = await discord.createChannel(guildId, {
            name: String(body.name || "").trim(),
            type: String(body.type || "text").trim(),
            parentId: String(body.parentId || "").trim(),
        });
        ok(res, created, 201);
    } catch (e) {
        error(res, 400, "create_failed", e.message || "Kanal konnte nicht erstellt werden.");
    }
}

/** POST /api/channels/duplicate — clone a channel. Body: { channelId, name }. */
async function duplicateChannel(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const channelId = String(body.channelId || "").trim();
    if (!channelId) return error(res, 400, "no_channel", "Kein Kanal gewählt.");
    try {
        const created = await discord.duplicateChannel(channelId, String(body.name || "").trim());
        ok(res, created, 201);
    } catch (e) {
        error(res, 400, "duplicate_failed", e.message || "Kanal konnte nicht dupliziert werden.");
    }
}

/** The ids of a body, only those of the active guild — a stale page must not reach another server. */
function idsOfGuild(body, guildId) {
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map((id) => String(id || "").trim()).filter(Boolean))] : [];
    const known = new Map(discord.listAllChannels(guildId).map((c) => [c.id, c]));
    return { ids: ids.filter((id) => known.has(id)), unknown: ids.filter((id) => !known.has(id)), known };
}

const unknownResults = (ids) => ids.map((id) => ({ id, ok: false, error: "Kanal nicht auf diesem Server" }));

/**
 * PATCH /api/channels — change one or several channels. Body:
 * `{ ids, changes: { name?, topic?, parentId?, rateLimitPerUser? } }`. Only the
 * fields present in `changes` are applied (a bulk edit's "unverändert" is simply
 * absent), one channel after another; the answer says per channel what happened.
 */
async function patchChannels(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_guild", "Kein Server gewählt.");
    const body = await readJsonBody(req);
    const changes = body.changes && typeof body.changes === "object" ? body.changes : {};
    try {
        discordChannels.pickChanges(changes);
    } catch (e) {
        return error(res, 400, "invalid_changes", e.message);
    }
    const { ids, unknown } = idsOfGuild(body, guildId);
    if (!ids.length && !unknown.length) return error(res, 400, "no_channel", "Kein Kanal gewählt.");
    const results = [
        ...await runSerial(ids, (id) => discordChannels.editChannel(id, changes)),
        ...unknownResults(unknown),
    ];
    ok(res, { results, ...summarize(results, "geändert") });
}

/** POST /api/channels/archive — move channels into the archive category. Body: { ids }. */
async function archiveChannels(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_guild", "Kein Server gewählt.");
    const { archiveCategoryId } = archiveStore.getChannelConfig(guildId);
    if (!archiveCategoryId) return error(res, 400, "no_archive", "Keine Archiv-Kategorie festgelegt.");
    const body = await readJsonBody(req);
    const { ids, unknown } = idsOfGuild(body, guildId);
    if (!ids.length && !unknown.length) return error(res, 400, "no_channel", "Kein Kanal gewählt.");
    const results = [
        ...await runSerial(ids, async (id) => {
            const archived = await discordChannels.archiveChannel(id, archiveCategoryId);
            archiveStore.recordArchived({ ...archived, channelId: id, guildId, by: user.id, byName: user.name });
            return { name: archived.name };
        }),
        ...unknownResults(unknown),
    ];
    ok(res, { results, ...summarize(results, "archiviert") });
}

/**
 * POST /api/channels/delete — delete channels from the archive. Body:
 * `{ ids, confirm }`: one channel wants its own name typed, several the word
 * LÖSCHEN. A channel outside the archive category is refused per channel
 * (discordChannels.deleteChannel), whatever the page sent.
 */
async function deleteChannels(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_guild", "Kein Server gewählt.");
    const { archiveCategoryId } = archiveStore.getChannelConfig(guildId);
    if (!archiveCategoryId) return error(res, 400, "no_archive", "Keine Archiv-Kategorie festgelegt.");
    const body = await readJsonBody(req);
    const { ids, unknown, known } = idsOfGuild(body, guildId);
    if (!ids.length && !unknown.length) return error(res, 400, "no_channel", "Kein Kanal gewählt.");
    const confirm = String(body.confirm || "").trim();
    const single = ids.length === 1 && !unknown.length;
    const expected = single ? known.get(ids[0]).name : BULK_DELETE_WORD;
    if (confirm !== expected) {
        return error(res, 400, "not_confirmed", single ? "Zum Löschen den Kanalnamen eintippen." : `Zum Löschen „${BULK_DELETE_WORD}“ eintippen.`);
    }
    const results = [
        ...await runSerial(ids, async (id) => {
            const deleted = await discordChannels.deleteChannel(id, archiveCategoryId);
            archiveStore.forgetArchived([id]);
            return { name: deleted.name };
        }),
        ...unknownResults(unknown),
    ];
    ok(res, { results, ...summarize(results, "gelöscht") });
}

/** A day in the guild's time zone ("2026-09-23") for an event start in seconds. */
function dayOf(startTime) {
    return startTime ? DateTime.fromSeconds(Number(startTime), { zone: "Europe/Berlin" }).toISODate() : "";
}

/**
 * POST /api/channels/rename-preview — what "Umbenennen nach Schema" would make
 * of the chosen channels. Body: `{ ids, schema, raid }`. The date placeholders
 * come from the channel's event (when it has one), `{name}` is its current name,
 * `{nr}` its place in the selection. Changes nothing.
 */
async function renamePreview(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const guildId = activeGuildFor(req);
    const body = await readJsonBody(req);
    const { ids, known } = idsOfGuild(body, guildId);
    const events = eventStatusByChannel(listStoredEvents(guildId));
    const schema = String(body.schema || "").trim() || "{name}";
    const taken = new Set([...known.values()].filter((c) => !ids.includes(c.id)).map((c) => c.name));
    const rows = ids.map((id, i) => {
        const channel = known.get(id);
        const ev = events[id];
        const to = renderChannelName(schema, { date: ev ? dayOf(ev.startTime) : "", raid: body.raid || "", name: channel.name, nr: i + 1 });
        const row = { id, from: channel.name, to, hasDate: !!ev, conflict: !to || taken.has(to) };
        if (to) taken.add(to);
        return row;
    });
    ok(res, { rows });
}

/**
 * POST /api/channels/batch — quick-create by naming schema. Body:
 * `{ categoryId, schema, raid, tag, from, count, interval, templateChannelId, dryRun, saveSchema }`.
 * `dryRun` only answers the plan (names, and which exist already); otherwise the
 * missing ones are created one after another and existing names are skipped,
 * never duplicated. `saveSchema` remembers schema, raid and template for the category.
 */
async function batchCreate(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_guild", "Kein Server gewählt.");
    const body = await readJsonBody(req);
    const categoryId = String(body.categoryId || "").trim();
    const schema = String(body.schema || "").trim() || DEFAULT_SCHEMA;
    const existingNames = discord.listAllChannels(guildId).map((c) => c.name);
    const plan = planChannels({
        schema, raid: body.raid || "", tag: body.tag || "", from: body.from, count: body.count, interval: body.interval, existingNames,
    });
    if (!plan.length) return error(res, 400, "invalid_date", "Kein gültiges Datum.");
    if (body.dryRun) return ok(res, { plan });

    if (body.saveSchema && categoryId) {
        archiveStore.saveCategorySchema(guildId, categoryId, { schema, raid: body.raid || "", templateChannelId: body.templateChannelId || "" });
    }
    const todo = plan.filter((p) => !p.exists);
    const templateChannelId = String(body.templateChannelId || "").trim();
    const created = await runSerial(todo.map((p) => p.name), (name) => discordChannels.createFromTemplate(guildId, {
        name, parentId: categoryId, templateChannelId,
    }));
    const skipped = plan.length - todo.length;
    const summary = summarize(created, "angelegt");
    ok(res, {
        plan,
        results: created,
        skipped,
        ...summary,
        message: skipped ? `${summary.message}, ${skipped} übersprungen (existiert)` : summary.message,
    }, 201);
}

/**
 * POST /api/channels/config — the archive settings. Body:
 * `{ archiveCategoryId?, archiveDeleteHintDays?, createArchiveCategory? }`;
 * `createArchiveCategory` is a name — the category is created and becomes the archive.
 */
async function saveConfig(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_guild", "Kein Server gewählt.");
    const body = await readJsonBody(req);
    let archiveCategoryId = body.archiveCategoryId;
    if (body.createArchiveCategory) {
        try {
            archiveCategoryId = (await discordChannels.createCategory(guildId, body.createArchiveCategory)).id;
        } catch (e) {
            return error(res, 400, "create_failed", discordChannels.discordErrorText(e));
        }
    } else if (archiveCategoryId) {
        const known = discord.listCategories(guildId).some((c) => c.id === String(archiveCategoryId));
        if (!known) return error(res, 400, "unknown_category", "Kategorie nicht auf diesem Server.");
    }
    const config = archiveStore.saveChannelConfig(guildId, {
        archiveCategoryId,
        archiveDeleteHintDays: body.archiveDeleteHintDays,
    });
    ok(res, { config });
}

module.exports = {
    BULK_DELETE_WORD,
    getChannels, createChannel, duplicateChannel,
    patchChannels, archiveChannels, deleteChannels, renamePreview, batchCreate, saveConfig,
};
