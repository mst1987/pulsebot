// How a new event channel is named and what it copies (#285) — one answer for
// every way a channel comes about: /event anlegen, the web's create dialog,
// Kanäle → Schnell anlegen, "Umbenennen nach Schema" and /kanal anlegen.
//
// The rule, in order:
//   1. a schema the orga stored for the category (Kanäle, anything but the
//      default schema) wins — "nach Schema der Kategorie";
//   2. else the name of the category's latest event channel (the one with the
//      same raid first), with only its date, weekday and raid replaced —
//      "abgeleitet aus #…";
//   3. else the default schema, with the emoji/separator prefix of that latest
//      channel — "Standard-Schema".
// The new channel is a copy of the stored template channel, else of that
// latest event channel (rights, topic, slowmode), and is sorted in right after
// the previous date. Only a category without any event channel gets a plain
// channel with the category's rights.
//
// The result always says where the name came from (`label`, `detail`), so the
// bot and the web can show it instead of leaving the admin to guess.

const { DateTime } = require("luxon");
const discord = require("./discord");
const archiveStore = require("../../stores/channelArchiveStore");
const { loadEventGroups, eventLookbackSince } = require("../../web/raidEventGroups");
const { raidContentIds } = require("../../web/raidListing");
const { instanceById } = require("../../config/gameVersions");
const {
    DEFAULT_SCHEMA, normalizeChannelName, renderChannelName, derivePatternFromName, applyPattern, patternParts,
    prefixOf, describeReplaced, listParts, placementFor,
} = require("../../utils/channelNames");

const { TIMEZONE } = require("../../config/timezone");

/** An event start (unix seconds) as its Berlin day, "2026-09-17". */
function berlinDay(startTime) {
    return startTime ? DateTime.fromSeconds(Number(startTime), { zone: TIMEZONE }).toISODate() : "";
}

/** The instances of an event: its own plan, else what its title or channel names. */
function instancesOf(ev) {
    if (Array.isArray(ev.instanceIds) && ev.instanceIds.length) return ev.instanceIds;
    try {
        return raidContentIds({ title: ev.title, channelName: ev.channelName }).contentIds || [];
    } catch {
        return [];
    }
}

/** ["ssc", "tk"] → the parts of the raid tag as a channel name spells them ("ssc", "tk"). */
function tagParts(instanceIds = []) {
    return (instanceIds || [])
        .map((id) => normalizeChannelName((instanceById(id) || {}).short || id))
        .filter(Boolean);
}

/** The spellings an event's raid may have in its channel name: short names, ids, the stored tag. */
function raidTagsOf(ev, storedRaid = "") {
    const ids = instancesOf(ev);
    const tags = [tagParts(ids), ids.map((id) => normalizeChannelName(id)).filter(Boolean)];
    if (storedRaid) tags.push([storedRaid]);
    return tags.filter((t) => t.length);
}

/** The raid tag of a set of instances, "ssc-tk"; "" without any. */
function raidTagFor(instanceIds) {
    return tagParts(instanceIds).join("-");
}

/**
 * What naming needs from the outside: the events (upcoming and the lookback
 * window, both sources), the live channels and the stored schemas. Every read
 * is best-effort — without events a category simply has no previous channel.
 */
async function loadNamingInputs(guildId, { events } = {}) {
    let list = events;
    if (!list) {
        try {
            const { groups } = await loadEventGroups(guildId, { sinceSeconds: eventLookbackSince() });
            list = (groups || []).flatMap((g) => g.events || []);
        } catch {
            list = [];
        }
    }
    let channels = [];
    try {
        channels = discord.listAllChannels(guildId) || [];
    } catch {
        channels = [];
    }
    let schemas = {};
    try {
        schemas = archiveStore.getChannelConfig(guildId).schemas || {};
    } catch {
        schemas = {};
    }
    return { events: list || [], channels, schemas };
}

/**
 * Pure: how channels of a category are named right now. `fromEventId` names
 * the event whose channel is duplicated (its channel is the source then, in
 * whatever category it sits); `excludeChannelId` leaves a channel out as a
 * source (renaming a channel after itself says nothing).
 */
function namingContext({ categoryId = "", raid = "", fromEventId = "", excludeChannelId = "", events = [], channels = [], schemas = {} } = {}) {
    const byId = new Map((channels || []).map((c) => [String(c.id), c]));
    const stored = (schemas || {})[categoryId] || {};
    const row = (ev) => {
        const channel = byId.get(String(ev.channelId || ""));
        return channel ? { ev, channel, day: berlinDay(ev.startTime), tag: raidTagFor(instancesOf(ev)) } : null;
    };

    // The category's event channels that still exist there, one row per channel (its newest event).
    const rows = [];
    const seen = new Set();
    for (const ev of [...(events || [])].sort((a, b) => (Number(b.startTime) || 0) - (Number(a.startTime) || 0))) {
        const r = row(ev);
        if (!r || !categoryId || String(r.channel.parentId || "") !== String(categoryId) || seen.has(r.channel.id)) continue;
        seen.add(r.channel.id);
        if (r.channel.id !== excludeChannelId) rows.push(r);
    }

    let candidates;
    if (fromEventId) {
        const ev = (events || []).find((e) => String(e.id) === String(fromEventId));
        const r = ev ? row(ev) : null;
        candidates = r ? [r] : [];
    } else {
        const wanted = normalizeChannelName(Array.isArray(raid) ? raid.join("-") : raid);
        const same = wanted ? rows.filter((r) => r.tag === wanted) : [];
        candidates = [...same, ...rows.filter((r) => !same.includes(r))];
    }

    let source = null;
    let pattern = null;
    for (const c of candidates) {
        const p = derivePatternFromName(c.channel.name, { date: c.day, raidTags: raidTagsOf(c.ev, stored.raid) });
        if (p.recognized) {
            source = c;
            pattern = p;
            break;
        }
    }
    const design = source || candidates[0] || null;
    // A stored template channel is used as it was stored (a vanished one fails loudly on create, as before).
    // A duplicate copies its own source channel, never the stored template.
    const template = stored.templateChannelId && !fromEventId
        ? byId.get(String(stored.templateChannelId)) || { id: String(stored.templateChannelId), name: "" }
        : null;
    const customSchema = stored.schema && stored.schema !== DEFAULT_SCHEMA ? stored.schema : "";

    return {
        categoryId,
        source: customSchema ? "schema" : pattern ? "previous" : "default",
        schema: customSchema || DEFAULT_SCHEMA,
        storedRaid: stored.raid || "",
        pattern,
        fromChannel: design ? design.channel.name : "",
        fromChannelId: design ? design.channel.id : "",
        fromDay: design ? design.day : "",
        prefix: !customSchema && !pattern && design ? prefixOf(design.channel.name) : "",
        templateChannelId: template ? template.id : design ? design.channel.id : "",
        templateChannelName: template ? template.name : design ? design.channel.name : "",
        eventChannels: rows.map((r) => ({ day: r.day, channelId: r.channel.id })),
    };
}

/**
 * Pure: the name for a day ("2026-09-24") in a naming context, with what was
 * replaced. `raid` is the new event's raid tag ("ssc-tk"); empty keeps the old
 * one (derived) resp. the stored one (schema).
 */
function nameFor(ctx, day, raid = "") {
    const tag = Array.isArray(raid) ? raid.join("-") : String(raid || "");
    if (ctx.source === "previous") return applyPattern(ctx.pattern, { date: day, raid: tag });
    const name = renderChannelName(ctx.schema, { date: day, raid: tag || ctx.storedRaid });
    if (ctx.source === "default" && ctx.prefix) return { name: normalizeChannelName(`${ctx.prefix}${name}`), replaced: [] };
    return { name, replaced: [] };
}

/**
 * Where the name came from, as the bot and the web show it: `label` (short,
 * the badge) and `detail` (the tooltip / the part in brackets).
 */
function describeNaming(ctx, replaced = [], date = "") {
    const design = ctx.templateChannelName
        ? `Rechte und Thema von #${ctx.templateChannelName}`
        : ctx.templateChannelId ? "Rechte und Thema vom Vorlage-Kanal" : "Rechte der Kategorie";
    if (ctx.source === "previous") {
        const changed = describeReplaced(replaced);
        return {
            label: `abgeleitet aus #${ctx.fromChannel}`,
            detail: changed || (date ? `${listParts(patternParts(ctx.pattern))} unverändert` : replacedParts(ctx)),
            design,
        };
    }
    if (ctx.source === "schema") return { label: "nach Schema der Kategorie", detail: `Schema ${ctx.schema}`, design };
    return {
        label: "Standard-Schema",
        detail: ctx.prefix ? `${DEFAULT_SCHEMA} mit dem Anfang „${ctx.prefix}“ von #${ctx.fromChannel}` : ctx.fromChannel
            ? `${DEFAULT_SCHEMA} — in #${ctx.fromChannel} ist kein Datum erkennbar`
            : `${DEFAULT_SCHEMA} — die Kategorie hat noch keinen Event-Kanal`,
        design,
    };
}

/** "Datum und Raid werden ersetzt" / "Datum wird ersetzt". */
function replacedParts(ctx) {
    const parts = patternParts(ctx.pattern);
    return `${listParts(parts)} ${parts.length > 1 ? "werden" : "wird"} ersetzt`;
}

/** The one line for Discord: "abgeleitet aus #🔥・mi-17-09 (Datum 17-09 → 24-09)". */
function namingLine(naming) {
    return naming.detail ? `${naming.label} (${naming.detail})` : naming.label;
}

/**
 * Step 1 of /event anlegen knows no date yet: what will happen to the name.
 * "neu wie #🔥・mi-17-09-ssc-tk — Datum und Raid werden ersetzt".
 */
function stepLine(ctx) {
    if (ctx.source === "previous") return `neu wie #${ctx.fromChannel} — ${replacedParts(ctx)}`;
    if (ctx.source === "schema") return `neu nach Schema der Kategorie \`${ctx.schema}\``;
    return `neu nach Standard-Schema \`${ctx.prefix}${DEFAULT_SCHEMA}\``;
}

/**
 * Everything about one new channel: `{ name, source, label, detail, design,
 * fromChannel, fromChannelId, replaced, templateChannelId, templateChannelName,
 * placement }`. `date` "2026-09-24" (may be empty for a preview without a day).
 */
async function deriveChannelName({ guildId, categoryId = "", date = "", raid = "", instanceIds, fromEventId = "", excludeChannelId = "", events } = {}) {
    const inputs = await loadNamingInputs(guildId, { events });
    const tag = raid || (instanceIds ? raidTagFor(instanceIds) : "");
    const ctx = namingContext({ ...inputs, categoryId, raid: tag, fromEventId, excludeChannelId });
    return describeResult(ctx, date, tag);
}

/** The naming result of a context for one day (pure). */
function describeResult(ctx, date, raid = "") {
    const { name, replaced } = nameFor(ctx, date, raid);
    return {
        name,
        source: ctx.source,
        schema: ctx.source === "previous" ? "" : `${ctx.prefix}${ctx.schema}`,
        ...describeNaming(ctx, replaced, date),
        step: stepLine(ctx),
        fromChannel: ctx.fromChannel,
        fromChannelId: ctx.fromChannelId,
        replaced,
        templateChannelId: ctx.templateChannelId,
        templateChannelName: ctx.templateChannelName,
        placement: placementFor(ctx.eventChannels, date),
    };
}

module.exports = {
    berlinDay, raidTagFor, raidTagsOf, loadNamingInputs, namingContext, nameFor, describeNaming, describeResult,
    namingLine, stepLine, deriveChannelName,
};
