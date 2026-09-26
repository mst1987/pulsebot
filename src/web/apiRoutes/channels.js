const { DateTime } = require("luxon");
const { ok, error } = require("../apiResponse");
const { withUser } = require("../apiHandler");
const { activeGuildFor } = require("../activeGuild");
const discord = require("../discord");
const discordChannels = require("../discordChannels");
const archiveStore = require("../channelArchiveStore");
const { listStoredEvents, ownUpcomingRaw, signupSourceFor } = require("../eventSources");
const { fetchEventsCached } = require("../raidEventGroups");
const { runSerial, summarize, eventStatusByChannel } = require("../channelOps");
const { getConfig, getRaidTemplate, listRecruitmentPosts } = require("../settingsStore");
const { resolvePurposes, purposeSummary } = require("../channelPurposes");
const eventCreate = require("../eventCreate");
const { userCanAny } = require("../../config/permissions");
const { parseClockTime } = require("../../utils/time");
const channelNaming = require("../channelNaming");
const { DEFAULT_SCHEMA, PLACEHOLDERS, planChannels, placementFor, renderChannelName } = require("../../utils/channelNames");
const { TIMEZONE } = require("../../config/timezone");

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
 * What "gleich Event anlegen" in the quick-create would use per category: the
 * category's default raid template (`categoryRaidTemplate`, #266) and the source
 * of its new events (`categorySignupSource`). Only categories with either.
 * @returns {Record<string, { templateId: string, templateName: string, source: string }>}
 */
function quickEventDefaults(categories, config = getConfig()) {
    const out = {};
    const templates = config.categoryRaidTemplate || {};
    for (const c of categories || []) {
        const templateId = String(templates[c.id] || "");
        const template = templateId ? getRaidTemplate(templateId) : null;
        out[c.id] = {
            templateId: template ? template.id : "",
            templateName: template ? template.name || template.id : "",
            source: signupSourceFor(c.id),
        };
    }
    return out;
}

/**
 * GET /api/channels — the active guild's categories and channels (with the
 * bot's rights, topic and slowmode per channel), what the bot uses which
 * channel for (`purposes`, settings — see channelPurposes.js), which channels
 * carry an upcoming or past event, the archive with its waiting channels, and
 * the stored naming schemas.
 */
const getChannels = withUser({}, async ({ user, req, res }) => {
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
        // "gleich Event anlegen" (quick-create): only offered to whoever may create raids.
        canCreateEvents: userCanAny(user, ["raids"], "write"),
        eventDefaults: quickEventDefaults(categories),
        defaultSchema: DEFAULT_SCHEMA,
        placeholders: PLACEHOLDERS,
    });
});

/** POST /api/channels — create a channel in the active guild. Body: { name, type, parentId }. */
const createChannel = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_guild", "Kein Server gewählt.");
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
});

/** POST /api/channels/duplicate — clone a channel. Body: { channelId, name }. */
const duplicateChannel = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const channelId = String(body.channelId || "").trim();
    if (!channelId) return error(res, 400, "no_channel", "Kein Kanal gewählt.");
    try {
        const created = await discord.duplicateChannel(channelId, String(body.name || "").trim());
        ok(res, created, 201);
    } catch (e) {
        error(res, 400, "duplicate_failed", e.message || "Kanal konnte nicht dupliziert werden.");
    }
});

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
const patchChannels = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_guild", "Kein Server gewählt.");
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
});

/** POST /api/channels/archive — move channels into the archive category. Body: { ids }. */
const archiveChannels = withUser({ csrf: true, body: true }, async ({ user, body, req, res }) => {
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_guild", "Kein Server gewählt.");
    const { archiveCategoryId } = archiveStore.getChannelConfig(guildId);
    if (!archiveCategoryId) return error(res, 400, "no_archive", "Keine Archiv-Kategorie festgelegt.");
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
});

/**
 * POST /api/channels/delete — delete channels. Body: `{ ids, confirm, anywhere }`:
 * one channel wants its own name typed, several the word LÖSCHEN. Without
 * `anywhere` (the archive tab) a channel outside the archive category is
 * refused per channel; with it (the channel list) any channel may go, a
 * category never (discordChannels.deleteChannel, whatever the page sent).
 */
const deleteChannels = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_guild", "Kein Server gewählt.");
    const { archiveCategoryId } = archiveStore.getChannelConfig(guildId);
    const anywhere = body.anywhere === true;
    if (!anywhere && !archiveCategoryId) return error(res, 400, "no_archive", "Keine Archiv-Kategorie festgelegt.");
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
            const deleted = await discordChannels.deleteChannel(id, archiveCategoryId, { anywhere });
            archiveStore.forgetArchived([id]);
            return { name: deleted.name };
        }),
        ...unknownResults(unknown),
    ];
    ok(res, { results, ...summarize(results, "gelöscht") });
});

/** A day in the guild's time zone ("2026-09-23") for an event start in seconds. */
function dayOf(startTime) {
    return startTime ? DateTime.fromSeconds(Number(startTime), { zone: TIMEZONE }).toISODate() : "";
}

/** The part of a naming result the page shows: the badge and its tooltip (#285). */
function namingView(result) {
    if (!result) return null;
    return {
        source: result.source, label: result.label, detail: result.detail, design: result.design,
        fromChannel: result.fromChannel, templateChannelId: result.templateChannelId, templateChannelName: result.templateChannelName,
    };
}

/**
 * POST /api/channels/rename-preview — what "Umbenennen nach Schema" would make
 * of the chosen channels. Body: `{ ids, schema, raid }`. The date placeholders
 * come from the channel's event (when it has one), `{name}` is its current name,
 * `{nr}` its place in the selection. An empty schema names each channel like
 * the latest *other* event channel of its category (#285) — every row says so
 * in `naming`. Changes nothing.
 */
const renamePreview = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const guildId = activeGuildFor(req);
    const { ids, known } = idsOfGuild(body, guildId);
    const rawEvents = await eventsFor(guildId);
    const events = eventStatusByChannel(rawEvents);
    const schemaInput = String(body.schema || "").trim();
    const raid = String(body.raid || "").trim();
    const schemas = archiveStore.getChannelConfig(guildId).schemas || {};
    const allChannels = [...known.values()];
    const taken = new Set(allChannels.filter((c) => !ids.includes(c.id)).map((c) => c.name));
    const rows = ids.map((id, i) => {
        const channel = known.get(id);
        const ev = events[id];
        const day = ev ? dayOf(ev.startTime) : "";
        let to;
        let naming = null;
        if (schemaInput) {
            to = renderChannelName(schemaInput, { date: day, raid, name: channel.name, nr: i + 1 });
        } else if (!day) {
            to = channel.name; // no event, no date: nothing to derive, the name stays
        } else {
            const ctx = channelNaming.namingContext({
                events: rawEvents, channels: allChannels, schemas, categoryId: channel.parentId, raid, excludeChannelId: id,
            });
            const result = channelNaming.describeResult(ctx, day, raid);
            // Renaming only follows a real model: with nothing to derive from, a
            // channel is not forced onto the default schema — it keeps its name.
            to = result.source === "default" ? channel.name : result.name;
            naming = namingView(result);
        }
        const row = { id, from: channel.name, to, hasDate: !!ev, conflict: !to || taken.has(to), naming };
        if (to) taken.add(to);
        return row;
    });
    ok(res, { rows });
});

/**
 * The job toast's text after a quick-create with events: the totals, then one
 * line per channel whose event did not come about. `results` are runSerial's.
 */
function eventBatchMessage(results, skipped) {
    const channels = summarize(results, "angelegt");
    const withChannel = results.filter((r) => r.ok);
    const events = withChannel.filter((r) => r.eventId).length;
    const lines = [`${channels.message} · ${events} ${events === 1 ? "Event" : "Events"} angelegt${skipped ? ` · ${skipped} übersprungen (existiert)` : ""}`];
    for (const r of results) {
        if (!r.ok) lines.push(`${r.id}: Kanal fehlgeschlagen – ${r.error}`);
        else if (!r.eventId) lines.push(`${r.name || r.id}: Event fehlgeschlagen – ${r.eventError}`);
        else if (r.messageError) lines.push(`${r.name || r.id}: Event angelegt, Nachricht fehlt – ${r.messageError}`);
    }
    return { message: lines.join("\n"), failed: channels.failed + (withChannel.length - events) };
}

/**
 * What quick-create shows above its preview: where the names come from and
 * which channel the new ones copy. A typed schema is named as such.
 */
function batchNaming(ctx, { schemaInput, day, raid, templateChannelId, channels }) {
    const result = channelNaming.describeResult(ctx, day, raid);
    const template = templateChannelId ? (channels || []).find((c) => c.id === templateChannelId) : null;
    const view = {
        ...namingView(result),
        templateChannelId: template ? template.id : "",
        templateChannelName: template ? template.name : "",
        design: template ? `Rechte und Thema von #${template.name}` : templateChannelId ? "Rechte und Thema vom Vorlage-Kanal" : "Rechte der Kategorie",
    };
    return schemaInput ? { ...view, source: "typed", label: "nach eingegebenem Schema", detail: `Schema ${schemaInput}` } : view;
}

/**
 * POST /api/channels/batch — quick-create by naming schema. Body:
 * `{ categoryId, schema, raid, tag, from, count, interval, templateChannelId, dryRun, saveSchema, withEvent, time, ignoreStoredSchema }`.
 * `dryRun` only answers the plan (names, and which exist already); otherwise the
 * missing ones are created one after another and existing names are skipped,
 * never duplicated. `saveSchema` remembers schema, raid and template (and the
 * time, with an event) for the category.
 *
 * `withEvent` ("gleich Event anlegen", needs `raids` write and a category) makes
 * an event in every channel created, through eventCreate.createEvent — the one
 * way in: date from the series, `time`, the category's default raid template
 * and the category's source (Raid-Helper or EventHelper). A channel whose event
 * fails stays; the result says so per channel (`eventId` / `eventError`).
 */
const batchCreate = withUser({ csrf: true, body: true }, async ({ user, body, req, res }) => {
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_guild", "Kein Server gewählt.");
    const categoryId = String(body.categoryId || "").trim();
    const schemaInput = String(body.schema || "").trim();
    const schema = schemaInput || DEFAULT_SCHEMA;
    const raid = String(body.raid || "").trim();
    const channels = discord.listAllChannels(guildId);
    const existingNames = channels.map((c) => c.name);
    // In a category, new channels look like its previous event channel (#285):
    // an empty schema names them after it, and they are copies of it unless a
    // template channel is chosen.
    // `ignoreStoredSchema` (the schema dialog's preview): what an empty field would
    // mean once saved — derived from the channels, not the schema stored so far.
    const inputs = categoryId ? await channelNaming.loadNamingInputs(guildId) : null;
    if (inputs && body.ignoreStoredSchema) inputs.schemas = { ...inputs.schemas, [categoryId]: {} };
    const ctx = inputs ? channelNaming.namingContext({ ...inputs, categoryId, raid }) : null;
    const plan = planChannels({
        schema, raid, tag: body.tag || "", from: body.from, count: body.count, interval: body.interval, existingNames,
        render: ctx && !schemaInput ? (day) => channelNaming.nameFor(ctx, day, raid).name : null,
    });
    if (!plan.length) return error(res, 400, "invalid_date", "Kein gültiges Datum.");
    const templateChannelId = String(body.templateChannelId || "").trim() || (ctx ? ctx.templateChannelId : "");
    const naming = ctx ? batchNaming(ctx, { schemaInput, day: plan[0].date, raid, templateChannelId, channels }) : null;
    if (body.dryRun) return ok(res, { plan, naming });

    const withEvent = body.withEvent === true;
    const time = withEvent ? parseClockTime(body.time) : "";
    if (withEvent) {
        if (!userCanAny(user, ["raids"], "write")) return error(res, 403, "forbidden", "Events anlegen braucht Schreibrechte für Raids.");
        if (!categoryId) return error(res, 400, "no_category", "Für Events braucht es eine Kategorie.");
        if (!time) return error(res, 400, "invalid_time", "Ungültige Uhrzeit.");
    }

    if (body.saveSchema && categoryId) {
        archiveStore.saveCategorySchema(guildId, categoryId, {
            schema, raid: body.raid || "", templateChannelId: body.templateChannelId || "", ...(withEvent ? { time } : {}),
        });
    }
    const todo = plan.filter((p) => !p.exists);
    const dayByName = new Map(todo.map((p) => [p.name, p.date]));
    // Each new channel is sorted in behind the previous date — including the ones this series just made.
    const anchors = ctx ? [...ctx.eventChannels] : [];
    const defaults = withEvent ? quickEventDefaults([{ id: categoryId }])[categoryId] : null;
    const title = defaults
        ? defaults.templateName || ((discord.listCategories(guildId) || []).find((c) => c.id === categoryId) || {}).name || "Raid"
        : "";
    const created = await runSerial(todo.map((p) => p.name), async (name) => {
        const day = dayByName.get(name);
        const channel = await discordChannels.createFromTemplate(guildId, {
            name, parentId: categoryId, templateChannelId, ...(ctx ? placementFor(anchors, day) : {}),
        });
        if (ctx) anchors.push({ day, channelId: channel.id });
        if (!withEvent) return channel;
        const made = await eventCreate.createEvent({
            guildId,
            user,
            body: {
                title,
                date: dayByName.get(name),
                time,
                channelId: channel.id,
                signupSource: defaults.source,
                ...(defaults.templateId ? { raidTemplateId: defaults.templateId } : {}),
            },
        }).catch((e) => ({ error: { message: e.message || "Event konnte nicht angelegt werden." } }));
        if (made.error) return { ...channel, channelId: channel.id, eventError: made.error.message };
        const eventId = String((made.body && (made.body.id || made.body.eventId || (made.body.event && made.body.event.id))) || "created");
        return { ...channel, channelId: channel.id, eventId, messageError: (made.body && made.body.messageError) || undefined };
    });
    const skipped = plan.length - todo.length;
    if (withEvent) {
        const summary = eventBatchMessage(created, skipped);
        return ok(res, { plan, naming, results: created, skipped, done: created.filter((r) => r.ok).length, ...summary }, 201);
    }
    const summary = summarize(created, "angelegt");
    ok(res, {
        plan,
        naming,
        results: created,
        skipped,
        ...summary,
        message: skipped ? `${summary.message}, ${skipped} übersprungen (existiert)` : summary.message,
    }, 201);
});

/** A stored schema longer than a channel name can be is a typo, not a design. */
const SCHEMA_MAX = 200;

/**
 * POST /api/channels/schema — a category's naming schema, set on its own (the
 * Kanäle page's category head) instead of only as a side effect of quick-create.
 * Body: `{ categoryId, schema, raid, templateChannelId }`. An empty schema means
 * "wie der letzte Event-Kanal" again; the time "gleich Event anlegen" remembered
 * stays. Answers the stored entry.
 */
const saveSchema = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_guild", "Kein Server gewählt.");
    const categoryId = String(body.categoryId || "").trim();
    const schema = String(body.schema || "").trim();
    const templateChannelId = String(body.templateChannelId || "").trim();
    if (!discord.listCategories(guildId).some((c) => c.id === categoryId)) {
        return error(res, 400, "unknown_category", "Kategorie nicht auf diesem Server.");
    }
    if (schema.length > SCHEMA_MAX) return error(res, 400, "schema_too_long", `Das Schema ist länger als ${SCHEMA_MAX} Zeichen.`);
    if (schema && !renderChannelName(schema, { date: "2026-01-01", raid: "raid", nr: 1 })) {
        return error(res, 400, "schema_empty", "Aus diesem Schema entsteht kein Kanalname.");
    }
    if (templateChannelId && !discord.listAllChannels(guildId).some((c) => c.id === templateChannelId)) {
        return error(res, 400, "unknown_channel", "Vorlage-Kanal nicht auf diesem Server.");
    }
    const stored = archiveStore.saveCategorySchema(guildId, categoryId, {
        schema, raid: String(body.raid || "").trim(), templateChannelId,
    });
    ok(res, { schema: stored });
});

/**
 * POST /api/channels/config — the archive settings. Body:
 * `{ archiveCategoryId?, archiveDeleteHintDays?, createArchiveCategory? }`;
 * `createArchiveCategory` is a name — the category is created and becomes the archive.
 */
const saveConfig = withUser({ csrf: true, body: true }, async ({ body, req, res }) => {
    const guildId = activeGuildFor(req);
    if (!guildId) return error(res, 400, "no_guild", "Kein Server gewählt.");
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
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/channels", handler: getChannels, area: "channels" },
    { method: "POST", path: "/api/channels", handler: createChannel, area: "channels" },
    { method: "PATCH", path: "/api/channels", handler: patchChannels, area: "channels" },
    { method: "POST", path: "/api/channels/duplicate", handler: duplicateChannel, area: "channels" },
    { method: "POST", path: "/api/channels/archive", handler: archiveChannels, area: "channels" },
    { method: "POST", path: "/api/channels/delete", handler: deleteChannels, area: "channels" },
    { method: "POST", path: "/api/channels/rename-preview", handler: renamePreview, area: "channels" },
    { method: "POST", path: "/api/channels/batch", handler: batchCreate, area: "channels" },
    { method: "POST", path: "/api/channels/schema", handler: saveSchema, area: "channels" },
    { method: "POST", path: "/api/channels/config", handler: saveConfig, area: "channels" },
];

module.exports = {
    BULK_DELETE_WORD,
    getChannels, createChannel, duplicateChannel,
    patchChannels, archiveChannels, deleteChannels, renamePreview, batchCreate, saveSchema, saveConfig,
    routes,
};
