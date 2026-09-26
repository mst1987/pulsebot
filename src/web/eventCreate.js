// Creating and editing an event, for every way into it: the web's create
// dialog (POST /api/raids, PATCH /api/raids for an own event, #261) and the
// Discord modal (/event anlegen, #260).
//
// Which source the event gets is decided by the category it lands in
// (`categorySignupSource`, eventSources.signupSourceFor) unless the caller names
// one ("Anmeldung über"): "raidhelper" creates it at Raid-Helper as before,
// "eventhelper" in the own store — and posts the bot's event message into the
// channel. The channel is chosen, cloned from an earlier event or created new
// (named by the category's schema, #259) the same way for both.
const { DateTime } = require("luxon");
const discord = require("./discord");
const discordChannels = require("./discordChannels");
const { normalizeChannelName, renderChannelName, DEFAULT_SCHEMA } = require("../utils/channelNames");
const eventStore = require("./eventStore");
const { getRaidEvent } = require("./raidEventStore");
const { loadEventGroups, eventLookbackSince } = require("./raidEventGroups");
const { signupSourceFor } = require("./eventSources");
const { postEventMessage, refreshEventMessage } = require("./eventMessage");
const discordEvent = require("./discordEvent");
const { warningOf } = discordEvent;
const { announceEvent } = require("./eventAnnounce");
const { scheduleOverviewSync, RAIDHELPER_CREATE_DELAY_MS } = require("./talkOverview");
const { raidContentIds } = require("./raidListing");
const { getConfig, getRaidTemplate } = require("./settingsStore");
const { getChannelConfig } = require("./channelArchiveStore");
const channelNaming = require("./channelNaming");
const { instanceById } = require("../config/gameVersions");
const { emojiStyleOf } = require("./appEmojis");
const { createRaidhelperClient } = require("../utils/raidhelper/client");
const { toRaidHelperDate } = require("../utils/time");

const { TIMEZONE } = require("../config/timezone");
const { fail } = require("./apiResult");
const SOURCES = ["raidhelper", "eventhelper"];

/** Unix seconds of a "dd-MM-yyyy" date and "HH:mm" time in Berlin time, or 0. */
function startTimeOf(date, time) {
    const dt = DateTime.fromFormat(`${date} ${String(time || "").trim()}`, "dd-MM-yyyy H:mm", { zone: TIMEZONE });
    return dt.isValid ? Math.floor(dt.toSeconds()) : 0;
}

/**
 * The channel of the event a new raid is cloned from, with its category.
 *
 * All the clone needs is that one channel id, so it is asked for **by event
 * id** instead of scanning the window the create dialog was filled from. That
 * scan was the bug behind "Ausgangs-Event nicht gefunden": it lists the guild's
 * events of the last 60 days, joins them against the live Discord channels and
 * keeps a per-window cache — so a Raid-Helper hiccup, a Discord reconnect or
 * simply enough time between opening the dialog and pressing the button could
 * leave the event out of a list it had plainly been in a minute earlier.
 *
 * An own event is read from the store. For a Raid-Helper event there are three
 * sources, in order of authority: Raid-Helper's own event endpoint, the
 * snapshot raidEventScan.js keeps, and finally the window scan (which can still
 * know an event whose channel Discord no longer has). The failures are told
 * apart, because "Raid-Helper antwortet gerade nicht" and "das Event gibt es
 * nicht mehr" call for different things from whoever reads it.
 *
 * @returns {Promise<{channelId: string, categoryId?: string, code?: string, message?: string}>}
 */
async function sourceChannelFor(rh, guildId, sourceEventId) {
    if (eventStore.isOwnEventId(sourceEventId)) {
        const own = eventStore.getEvent(sourceEventId);
        return own && own.channelId
            ? { channelId: own.channelId, categoryId: own.categoryId }
            : { channelId: "", code: "source_not_found", message: "Das Ausgangs-Event gibt es nicht mehr. Wähle ein anderes oder lege den Channel selbst an." };
    }

    let reachable = true;
    try {
        const ev = await rh.getEvent(sourceEventId);
        if (ev && ev.id && ev.channelId) return { channelId: String(ev.channelId) };
    } catch {
        reachable = false;
    }

    const snapshot = getRaidEvent(sourceEventId);
    if (snapshot && snapshot.channelId) return { channelId: String(snapshot.channelId), categoryId: snapshot.categoryId || "" };

    const { groups } = await loadEventGroups(guildId, { sinceSeconds: eventLookbackSince() });
    const found = groups.flatMap((g) => g.events).find((ev) => ev.id === sourceEventId);
    if (found && found.channelId) return { channelId: String(found.channelId), categoryId: found.categoryId || "" };

    return reachable
        ? { channelId: "", code: "source_not_found", message: "Das Ausgangs-Event gibt es bei Raid-Helper nicht mehr. Wähle ein anderes oder lege den Channel selbst an." }
        : { channelId: "", code: "raidhelper_unreachable", message: "Raid-Helper antwortet gerade nicht — das Ausgangs-Event ließ sich nicht laden. Gleich noch einmal versuchen." };
}

/**
 * The planning fields a raid template proposes for an event starting at
 * `startTime`: version, instances, size, tanks/healers, the melee/ranged
 * ranges, the required buffs, the deadline (hours before the start) and the
 * two switches. {} when there is no such template.
 *
 * The values are copied: an event changed afterwards never writes back into
 * its template ("Als Vorlage speichern" in the dialog is the only way there).
 */
function templateDefaults(templateId, startTime) {
    const t = templateId ? getRaidTemplate(String(templateId)) : null;
    if (!t) return {};
    const comp = t.composition || {};
    const range = (r) => (r ? { min: r.min || 0, max: r.max === undefined ? null : r.max } : 0);
    const out = {
        raidTemplateId: t.id,
        versionId: t.versionId,
        instanceIds: t.instanceIds || [],
        composition: {
            tank: comp.tank || 0,
            healer: comp.healer || 0,
            melee: range(comp.melee),
            ranged: range(comp.ranged),
        },
        requiredBuffs: t.requiredBuffs || [],
        fairness: t.fairness === true,
        wishes: t.wishes === true,
        // The waiting list (#306) travels with the template like the switches above.
        overflow: t.overflow === "off" ? "off" : "bench",
        lockAtLimit: t.lockAtLimit === true,
        // Colour and picture of the event message (#307) travel with the
        // template too — a copy, so a later change of the template leaves the
        // events that already exist alone. Empty = the rule set decides.
        color: t.color || "",
        image: { mode: (t.image && t.image.mode) || "thumbnail", url: (t.image && t.image.url) || "" },
        // letter tiles and role icons of the message; a template without one gives the default
        emojiStyle: emojiStyleOf(t.emojiStyle),
    };
    if (t.size) out.size = t.size;
    else delete out.composition; // a migrated template without size proposes no composition
    // How long an evening of this kind takes (#305); a template without one
    // leaves the event at the store's default.
    if (t.durationMinutes) out.durationMinutes = t.durationMinutes;
    const hours = t.signupDeadline && Number(t.signupDeadline.hoursBefore);
    if (hours > 0) out.signupDeadline = startTime - hours * 3600;
    return out;
}

function categoryMap(guildId) {
    try {
        return discord.getChannelCategoryMap(guildId) || {};
    } catch {
        return {};
    }
}

function categoryNameOf(guildId, categoryId) {
    try {
        const hit = (discord.listCategories(guildId) || []).find((c) => c.id === categoryId);
        return hit ? hit.name : "";
    } catch {
        return "";
    }
}

/**
 * The "{raid}" of a channel name: the chosen instances' short names in lower
 * case ("ssc-tk"), else what the category's schema stores as its raid.
 */
function raidTagOf(instanceIds, fallback = "") {
    const shorts = (instanceIds || []).map((id) => instanceById(id)).filter(Boolean).map((i) => String(i.short || i.id).toLowerCase());
    return shorts.length ? shorts.join("-") : fallback;
}

/** The naming schema a category stores (Kanäle → Schnell anlegen, #259), or {}. */
function storedSchema(guildId, categoryId) {
    try {
        return (getChannelConfig(guildId).schemas || {})[categoryId] || {};
    } catch {
        return {};
    }
}

/**
 * The name a new event channel gets in a category: its stored naming schema,
 * or the default schema, filled with the event's date and raid.
 * @param {string} isoDate "2026-09-24"
 */
function schemaChannelName(guildId, categoryId, isoDate, instanceIds) {
    const stored = storedSchema(guildId, categoryId);
    return renderChannelName(stored.schema || DEFAULT_SCHEMA, { date: isoDate, raid: raidTagOf(instanceIds, stored.raid || "") });
}

/** "01-10-2026" or "2026-10-01" → "2026-10-01"; "" for anything else. */
function isoDateOf(value) {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(toRaidHelperDate(value));
    return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

const given = (body, key) => body[key] !== undefined && body[key] !== null && body[key] !== "";
const PLAN_KEYS = ["versionId", "size", "composition", "compositionMax", "requiredBuffs", "durationMinutes", "signupDeadline", "fairness", "wishes", "autoSuggest", "overflow", "lockAtLimit", "color", "image", "emojiStyle"];
// Colour and picture (#307) are the two planning fields whose *empty* value
// means something ("take the rule set's"), so `given()` — which reads "" as
// absent — must not decide them; planFor() merges them by `!== undefined`.
const LOOK_KEYS = ["color", "image"];

/**
 * The deadline as unix seconds: `signupDeadlineHours` (the dialog's "Stunden
 * vor Start", counted from the Berlin start time here so the browser's time
 * zone never matters) wins over an absolute `signupDeadline`. undefined when
 * the body names neither; 0 = no deadline.
 */
function deadlineFrom(body, startTime) {
    if (given(body, "signupDeadlineHours")) {
        const hours = Number(body.signupDeadlineHours);
        return Number.isFinite(hours) && hours > 0 ? startTime - Math.round(hours * 3600) : 0;
    }
    return body.signupDeadline === undefined ? undefined : Number(body.signupDeadline) || 0;
}

/**
 * The planning fields of a new own event: what the body sends wins, the rest
 * comes from the raid template (the chosen one, else the category's default,
 * #266), the instances last from the title. Validated as a whole.
 * @returns {{ plan?: object, error?: object }}
 */
function planFor(body, categoryId, title, startTime) {
    const templateId = body.raidTemplateId || (getConfig().categoryRaidTemplate || {})[categoryId];
    const template = templateDefaults(templateId, startTime);
    const merged = { ...template };
    for (const key of PLAN_KEYS) {
        if (given(body, key)) merged[key] = body[key];
    }
    // "No colour" / "no picture" is a choice the dialog can make, so these two
    // count as given the moment the body names them at all (#307).
    for (const key of LOOK_KEYS) {
        if (body[key] !== undefined) merged[key] = body[key];
    }
    const deadline = deadlineFrom(body, startTime);
    if (deadline !== undefined && given(body, "signupDeadlineHours")) merged.signupDeadline = deadline;
    merged.instanceIds = Array.isArray(body.instanceIds) && body.instanceIds.length
        ? body.instanceIds
        : ((template.instanceIds || []).length ? template.instanceIds : raidContentIds({ title }).contentIds);
    const checked = eventStore.normalizePlan(merged);
    if (checked.error) return { error: fail(400, "invalid_plan", checked.error) };
    const signupDeadline = Number(merged.signupDeadline) || 0;
    if (signupDeadline && signupDeadline > startTime) return { error: fail(400, "invalid_plan", "Der Anmeldeschluss liegt nach dem Raidbeginn.") };
    return {
        plan: {
            ...checked.value,
            signupDeadline,
            // The voice channel (#305): the body's choice, else the category's preset.
            voiceChannelId: String(given(body, "voiceChannelId") ? body.voiceChannelId : ((getConfig().categoryVoiceChannel || {})[categoryId] || "")).trim(),
            fairness: merged.fairness === true,
            wishes: merged.wishes === true,
            autoSuggest: merged.autoSuggest === true,
            overflow: merged.overflow === "off" ? "off" : "bench",
            lockAtLimit: merged.lockAtLimit === true,
            emojiStyle: emojiStyleOf(merged.emojiStyle),
            raidTemplateId: template.raidTemplateId || "",
        },
    };
}

// ---- createEvent and its steps ----------------------------------------------------
//
// createEvent() validates (channelRequest, resolveChannelSource, ownEventPlan),
// normalises the category (categoryOf), makes the channel (makeChannel), then
// persists — at Raid-Helper (createAtRaidHelper) or in the own store
// (createOwnEvent) — and runs the own event's Discord side effects
// (publishOwnEvent). Nothing touches Discord before everything was checked.

/**
 * Which channel the body asks for: an existing one, a clone of an own/Raid-Helper
 * event's channel, or a new one. A channel made for this event ("neu nach Schema"
 * in the Discord modal and the web dialog) is like a clone only created once
 * everything else has been checked; a name left empty is filled from the
 * category's schema later.
 */
function channelRequest(body) {
    const channelId = String(body.channelId || "").trim();
    const sourceEventId = String(body.sourceEventId || "").trim();
    const newChannel = !channelId && !sourceEventId && body.newChannel && typeof body.newChannel === "object"
        ? {
            name: normalizeChannelName(body.newChannel.name),
            categoryId: String(body.newChannel.categoryId || "").trim(),
            templateChannelId: String(body.newChannel.templateChannelId || "").trim(),
        }
        : null;
    return { channelId, sourceEventId, newChannel };
}

/**
 * The channel a clone copies (`{ sourceChannel }`), none for an existing or a
 * new channel, or `{ error }` when the request names no usable channel.
 */
async function resolveChannelSource(rh, guildId, { channelId, sourceEventId, newChannel }) {
    if (newChannel && !newChannel.name && !newChannel.categoryId) return fail(400, "no_channel", "Der neue Kanal braucht einen Namen.");
    if (sourceEventId) {
        const sourceChannel = await sourceChannelFor(rh, guildId, sourceEventId);
        if (!sourceChannel.channelId) return fail(400, sourceChannel.code, sourceChannel.message);
        return { sourceChannel };
    }
    if (!channelId && !newChannel) return fail(400, "no_channel", "Kein Channel gewählt.");
    return { sourceChannel: null };
}

/**
 * The category the event lands in — it decides the source. A clone lands next to
 * its original, a new channel in the category it was asked for.
 * @returns {{ meta: object, categoryId: string }}
 */
function categoryOf(guildId, catMap, { channelId, newChannel }, sourceChannel) {
    const lookupChannel = sourceChannel ? sourceChannel.channelId : channelId;
    const meta = catMap[lookupChannel]
        || (newChannel ? { categoryId: newChannel.categoryId, categoryName: (catMap[newChannel.categoryId] || {}).name || categoryNameOf(guildId, newChannel.categoryId) } : {});
    const categoryId = meta.categoryId || (sourceChannel && sourceChannel.categoryId) || "";
    return { meta, categoryId };
}

/**
 * An own event's title, start and plan. Everything the own store would refuse is
 * checked here, before a channel is cloned, so a rejected event never leaves an
 * orphan channel behind.
 * @returns {{ plan: object, startTime: number } | { error: object }}
 */
function ownEventPlan(body, date, categoryId, title) {
    if (!title) return fail(400, "invalid_title", "Das Event braucht einen Titel.");
    const startTime = startTimeOf(date, body.time);
    if (!startTime) return fail(400, "invalid_time", "Ungültige Uhrzeit.");
    const planned = planFor(body, categoryId, title, startTime);
    if (planned.error) return planned.error;
    return { plan: planned.plan, startTime };
}

/**
 * The Discord side of the channel: clones the source event's channel or creates
 * the new one, both named and designed like the category's previous event
 * channel (#285) — the plain schema only when that cannot be worked out at all.
 * An existing channel is taken as it is.
 * @returns {Promise<{ channelId: string, channelName: string, naming: object|null } | { error: object }>}
 */
async function makeChannel({ guildId, categoryId, body, request, sourceChannel, instanceIds }) {
    const { sourceEventId, newChannel } = request;
    const isoDate = isoDateOf(body.date);
    const derive = async (extra) => {
        try {
            return await channelNaming.deriveChannelName({ guildId, categoryId, date: isoDate, instanceIds, ...extra });
        } catch {
            return null;
        }
    };
    const bySchema = () => schemaChannelName(guildId, categoryId, isoDate, instanceIds);
    try {
        if (sourceChannel) {
            const naming = await derive({ fromEventId: sourceEventId });
            const cloned = await discord.duplicateChannel(sourceChannel.channelId, String(body.channelName || "").trim() || (naming && naming.name) || bySchema());
            if (naming && naming.placement) await discordChannels.placeChannel(cloned.id, naming.placement);
            return { channelId: cloned.id, channelName: cloned.name || "", naming };
        }
        if (newChannel) {
            const naming = await derive({});
            const name = newChannel.name || (naming && naming.name) || bySchema();
            const templateChannelId = newChannel.templateChannelId || (naming ? naming.templateChannelId : storedSchema(guildId, categoryId).templateChannelId) || "";
            const created = await discordChannels.createFromTemplate(guildId, {
                name, parentId: newChannel.categoryId, templateChannelId, ...((naming && naming.placement) || {}),
            });
            return { channelId: created.id, channelName: created.name || name, naming };
        }
    } catch (e) {
        if (newChannel) return fail(400, "create_failed", `Kanal konnte nicht angelegt werden: ${discordChannels.discordErrorText(e)}`);
        return fail(400, "create_failed", e.message || "Channel konnte nicht dupliziert werden.");
    }
    return { channelId: request.channelId, channelName: "", naming: null };
}

/** The event at Raid-Helper; a raid template that links a Raid-Helper template stands in for a missing id. */
async function createAtRaidHelper(rh, { body, date, title, channel }) {
    const linked = !String(body.templateId || "").trim() && body.raidTemplateId ? getRaidTemplate(String(body.raidTemplateId)) : null;
    try {
        const result = await rh.createEvent({
            channelId: channel.channelId,
            leaderId: String(body.leaderId || "").trim(),
            templateId: String(body.templateId || "").trim() || (linked && linked.raidhelperTemplateId) || "",
            date,
            time: String(body.time || "").trim(),
            title,
            description: body.description || "",
        });
        if (result && result.status === "failed") {
            return fail(400, "create_failed", result.reason || result.message || "Raid-Helper hat die Erstellung abgelehnt.");
        }
        // The talk server's overview lists it once Raid-Helper's cached list has it.
        scheduleOverviewSync({ delayMs: RAIDHELPER_CREATE_DELAY_MS });
        // channelId: where it landed — a cloned or new channel is unknown to the caller otherwise.
        return {
            status: 201,
            body: result && typeof result === "object" ? { ...result, channelId: channel.channelId, ...namingBody(channel.naming, channel.channelName) } : result,
        };
    } catch (e) {
        return fail(400, "create_failed", e.message || "Event konnte nicht angelegt werden.");
    }
}

/** The own event in the store: `{ event }` or `{ error }` (the store's refusal). */
function createOwnEvent({ guildId, user, body, plan, startTime, title, meta, categoryId, channel }) {
    const created = eventStore.createEvent({
        ...plan,
        guildId,
        channelId: channel.channelId,
        channelName: channel.channelName || meta.name || "",
        categoryId,
        categoryName: meta.categoryName || "",
        title,
        description: body.description || "",
        leaderId: String(body.leaderId || "").trim() || (user && user.id) || "",
        startTime,
        createdBy: (user && user.id) || "",
    });
    return created.error ? fail(400, "create_failed", created.error) : { event: created.event };
}

/**
 * The Discord side effects of a new own event, in this order: the signup
 * message, the Discord event, the talk overview, the announcement. None of them
 * fails the create — each problem comes back as a warning.
 */
async function publishOwnEvent(eventId, body) {
    // The event exists either way; a message that could not be posted (bot
    // offline, missing rights) is reported, and the next roster change retries.
    let messageError = null;
    try {
        await postEventMessage(eventId);
    } catch (e) {
        messageError = e.message || "Die Event-Nachricht konnte nicht gepostet werden.";
    }
    // The Discord event (#305) comes after the message, so its description can
    // link it. Switched off for the category, or refused by Discord, it is a
    // warning — never a failed create.
    const discordEventError = warningOf(await discordEvent.createForEvent(eventId).catch((e) => ({ warning: (e && e.message) || "Fehler" })));
    scheduleOverviewSync();
    // "Beim Anlegen ankündigen" (#306): the category's switch unless the body
    // names its own. It runs after the signup message so the ping can link it,
    // and it never fails the create — a refused post comes back as announceError.
    const announced = await announceEvent(eventId, {
        want: body.announce === undefined ? undefined : body.announce === true,
    });
    return { messageError, discordEventError, announced };
}

/**
 * Create an event from the create dialog's body.
 *
 * Body: { title, date, time, description, leaderId, templateId (Raid-Helper),
 * and one of: channelId | sourceEventId (+ channelName) | newChannel: { name,
 * categoryId, templateChannelId } }, an optional signupSource ("raidhelper" |
 * "eventhelper", else the category's default) plus, for an EventHelper event,
 * the optional planning fields { raidTemplateId, versionId, instanceIds, size,
 * composition { tank, healer, melee, ranged } (melee/ranged a number or
 * { min, max }), requiredBuffs, signupDeadline (unix seconds) or
 * signupDeadlineHours, fairness, wishes, autoSuggest }. Missing planning
 * fields come from the raid template, then the rule set; missing instances are
 * read from the title. A cloned or new channel without a name is named by the
 * category's schema.
 *
 * @param {{ guildId: string, user?: { id: string }, body: object }} input
 * @returns {Promise<{ status: number, body: object } | { error: { status: number, code: string, message: string } }>}
 */
async function createEvent({ guildId, user, body = {} }) {
    // validation
    const date = toRaidHelperDate(body.date);
    if (!date) return fail(400, "invalid_date", "Ungültiges Datum.");
    const rh = createRaidhelperClient();
    const catMap = categoryMap(guildId);
    const request = channelRequest(body);
    const resolved = await resolveChannelSource(rh, guildId, request);
    if (resolved.error) return resolved;
    const { sourceChannel } = resolved;

    // normalisation: the category decides the source; the caller may pick the other one for one event
    const { meta, categoryId } = categoryOf(guildId, catMap, request, sourceChannel);
    const source = SOURCES.includes(body.signupSource) ? body.signupSource : signupSourceFor(categoryId);
    const title = String(body.title || "").trim();
    let plan = null;
    let startTime = 0;
    if (source === "eventhelper") {
        const own = ownEventPlan(body, date, categoryId, title);
        if (own.error) return own;
        ({ plan, startTime } = own);
    }

    // Discord: the channel, only now that everything was checked
    const channel = await makeChannel({ guildId, categoryId, body, request, sourceChannel, instanceIds: plan ? plan.instanceIds : body.instanceIds });
    if (channel.error) return channel;

    // persistence and the Discord side effects
    if (source === "raidhelper") return createAtRaidHelper(rh, { body, date, title, channel });
    const created = createOwnEvent({ guildId, user, body, plan, startTime, title, meta, categoryId, channel });
    if (created.error) return created;
    const published = await publishOwnEvent(created.event.id, body);
    const event = eventStore.getEvent(created.event.id) || created.event;
    return {
        status: 201,
        body: {
            id: event.id, source: "eventhelper", event, messageError: published.messageError, discordEventError: published.discordEventError,
            announced: published.announced.announced, announceError: published.announced.error || null,
            ...namingBody(channel.naming, channel.channelName),
        },
    };
}

/** Where a created channel's name and design came from, for the caller's confirmation (#285). */
function namingBody(naming, channelName) {
    if (!naming) return {};
    return {
        channelNaming: {
            name: channelName || naming.name, derivedName: naming.name, source: naming.source, label: naming.label, detail: naming.detail,
            design: naming.design, templateChannelId: naming.templateChannelId,
        },
    };
}

// The fields an edit logs by name (#288); two keys share one label.
const EDIT_FIELD_LABELS = {
    title: "Titel", description: "Beschreibung", leaderId: "Raidleitung", startTime: "Termin", versionId: "Spielversion",
    instanceIds: "Instanzen", size: "Größe", composition: "Zusammensetzung", compositionMax: "Zusammensetzung",
    requiredBuffs: "Pflicht-Buffs", signupDeadline: "Anmeldeschluss", fairness: "Fairness", wishes: "Wünsche",
    durationMinutes: "Dauer", voiceChannelId: "Sprachkanal",
    autoSuggest: "Vorschlag bei Anmeldeschluss", overflow: "Warteliste", lockAtLimit: "Sperre bei Voll",
    color: "Farbe", image: "Bild", emojiStyle: "Emoji-Stil",
};

/**
 * Change an own event from the same dialog (PATCH /api/raids, #261).
 *
 * Body: { id, title, date, time, description, leaderId } plus the planning
 * fields as on create. The channel stays — moving an event elsewhere is not an
 * edit. Only fields present in the body change, and the raid template the
 * event came from is never touched. A Raid-Helper event is refused: it is
 * edited at Raid-Helper.
 *
 * @param {{ guildId: string, body: object }} input
 */
async function updateEvent({ guildId, body = {}, user = null, byName = "" }) {
    const id = String(body.id || "").trim();
    if (!eventStore.isOwnEventId(id)) return fail(400, "not_own_event", "Nur EventHelper-Events lassen sich hier bearbeiten.");
    const current = eventStore.getEvent(id);
    if (!current || (guildId && current.guildId && current.guildId !== guildId)) return fail(404, "not_found", "Event nicht gefunden.");
    if (current.status === "cancelled") return fail(409, "cancelled", "Das Event ist abgesagt — erst die Absage zurücknehmen.");

    const patch = {};
    for (const key of ["title", "description", "leaderId", "instanceIds", "voiceChannelId", ...PLAN_KEYS]) {
        if (body[key] !== undefined) patch[key] = body[key];
    }
    if (body.date !== undefined || body.time !== undefined) {
        const cur = DateTime.fromSeconds(current.startTime, { zone: TIMEZONE });
        const date = body.date !== undefined ? toRaidHelperDate(body.date) : cur.toFormat("dd-MM-yyyy");
        if (!date) return fail(400, "invalid_date", "Ungültiges Datum.");
        const startTime = startTimeOf(date, body.time !== undefined ? body.time : cur.toFormat("HH:mm"));
        if (!startTime) return fail(400, "invalid_time", "Ungültige Uhrzeit.");
        patch.startTime = startTime;
    }
    for (const key of ["fairness", "wishes", "autoSuggest", "lockAtLimit"]) {
        if (patch[key] !== undefined) patch[key] = patch[key] === true;
    }
    const deadline = deadlineFrom(body, patch.startTime || current.startTime);
    if (deadline !== undefined) patch.signupDeadline = deadline;

    const updated = eventStore.updateEvent(id, patch);
    if (updated.error) return fail(400, "invalid_plan", updated.error);
    // Who changed what, on the event (#288) — the fields that really changed, named in German.
    const changed = [...new Set(Object.keys(EDIT_FIELD_LABELS)
        .filter((k) => JSON.stringify(current[k]) !== JSON.stringify(updated.event[k]))
        .map((k) => EDIT_FIELD_LABELS[k]))];
    eventStore.appendEventLog(id, {
        action: "edit",
        by: String((user && user.id) || ""),
        byName: String(byName || (user && (user.name || user.username)) || ""),
        detail: changed.join(", ") || "nichts geändert",
    });

    let messageError = null;
    try {
        await refreshEventMessage(id);
    } catch (e) {
        messageError = e.message || "Die Event-Nachricht konnte nicht aktualisiert werden.";
    }
    // Title, description, time and place also belong on the Discord event (#305).
    const discordEventError = warningOf(await discordEvent.syncForEvent(id).catch((e) => ({ warning: (e && e.message) || "Fehler" })));
    // Title and time also show in the talk server's overview (#257).
    scheduleOverviewSync();
    return { status: 200, body: { id, source: "eventhelper", event: updated.event, messageError, discordEventError } };
}

module.exports = {
    createEvent, updateEvent, sourceChannelFor, startTimeOf, templateDefaults, schemaChannelName, raidTagOf,
};
