// The Discord event (a guild scheduled event) that belongs to an own event
// (#305) — what Raid-Helper calls `discordevent`. It puts the raid into
// Discord's own event list, so it shows in the server's sidebar, in the mobile
// app and in everyone's "interested" list.
//
// Three rules hold for all of it:
//
//   * **Best-effort, always.** A missing right, an offline bot, a Discord that
//     refuses — none of it may fail an event that was created, moved or
//     cancelled. Every function answers `{ warning }` instead of throwing, and
//     what went wrong is kept on the event (`discordEvent.error`) so the page
//     can say it.
//   * **The signup is ours.** Discord's "Interessiert" is not a signup — it
//     tells nobody a spec, a character or a role. The description therefore
//     says so in one plain sentence; without it a raid would have two rosters
//     and neither would be right.
//   * **Only a category that asked for it** (`config.categoryDiscordEvent`,
//     off by default). A category without the switch never gets a Discord
//     event, and an event whose category is switched off later keeps the one
//     it has (it is synced, never created anew).
//
// Where it takes place: the event's voice channel when it has one
// (`entityType: Voice`), else `External` with the signup message as its
// location — a link is all Discord takes there, and the message is where the
// signup actually happens.
//
// Stored on the event as `event.discordEvent = { id, guildId, at, error }`
// (eventStore.setEventDiscordEvent). A Discord event somebody deleted by hand
// answers 404 and is forgotten cleanly.
const {
    ChannelType, GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, GuildScheduledEventStatus,
} = require("discord.js");
const discord = require("./discord");
const eventStore = require("./eventStore");
const { eventEndTime } = require("../utils/eventTime");
const { getConfig } = require("./settingsStore");

// Discord's limits for a scheduled event.
const LIMITS = { name: 100, description: 1000, location: 100 };

// The sentence that keeps the two rosters apart. Nothing about a Discord event
// tells us a spec, so "Interessiert" can never stand in for a signup.
const SIGNUP_NOTE = "Anmeldung nur über die Nachricht im Kanal – „Interessiert“ hier zählt nicht.";

/** Discord's "this is gone already" for a scheduled event. */
const isGone = (e) => !!(e && (e.code === 10070 || e.code === 10008 || e.status === 404 || /unknown (guild )?scheduled event/i.test((e && e.message) || "")));

const clip = (text, max) => {
    const s = String(text || "").trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** Whether a category creates Discord events for its own events (off by default). */
function enabledFor(event, config = getConfig()) {
    const catId = String((event && event.categoryId) || "");
    return !!(catId && ((config && config.categoryDiscordEvent) || {})[catId] === true);
}

/** The link to an event's signup message, else to its channel, else "". */
function eventUrl(event) {
    const guildId = String((event && event.guildId) || "");
    const channelId = String((event && event.channelId) || "");
    if (!guildId || !channelId) return "";
    const messageId = event.message && event.message.messageId ? String(event.message.messageId) : "";
    return messageId
        ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}`
        : `https://discord.com/channels/${guildId}/${channelId}`;
}

/**
 * The description of the Discord event: the raid's own description (shortened),
 * the sentence that says where the signup happens, and the link to it.
 */
function describeEvent(event) {
    const own = clip(event && event.description, 600);
    const url = eventUrl(event);
    const cancelled = event && event.status === "cancelled";
    const reason = cancelled ? String((event.cancel && event.cancel.reason) || "").trim() : "";
    const lines = [
        cancelled ? `❌ Abgesagt${reason ? `: ${clip(reason, 200)}` : ""}` : "",
        own,
        SIGNUP_NOTE,
        url,
    ].filter(Boolean);
    return clip(lines.join("\n\n"), LIMITS.description);
}

/**
 * What a Discord event for this raid looks like — pure, plain API JSON, so the
 * tests read it without a client.
 *
 * `voiceChannelId` is only used when the channel really is a voice (or stage)
 * channel of that server; otherwise the event is an `External` one pointing at
 * the signup message. An external event MUST carry an end time, so the
 * duration (#305) is not optional here.
 *
 * @param {object} event an eventStore event
 * @param {{ voiceChannelId?: string }} opts the voice channel as it was verified
 */
function buildScheduledEvent(event, { voiceChannelId = "" } = {}) {
    const start = Number(event && event.startTime) || 0;
    const end = eventEndTime(event);
    const payload = {
        name: clip(event && event.title, LIMITS.name) || "Raid",
        description: describeEvent(event),
        scheduledStartTime: new Date(start * 1000).toISOString(),
        scheduledEndTime: new Date(end * 1000).toISOString(),
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    };
    if (voiceChannelId) {
        return { ...payload, entityType: GuildScheduledEventEntityType.Voice, channel: String(voiceChannelId) };
    }
    const url = eventUrl(event);
    return {
        ...payload,
        entityType: GuildScheduledEventEntityType.External,
        // ⚠️ `channel: null` is not decoration: discord.js only sends `channel_id`
        // when the option is present, and Discord refuses a switch back from a
        // voice event to an external one without an explicit null.
        channel: null,
        entityMetadata: { location: clip(url || (event && event.channelName ? `#${event.channelName}` : "Discord"), LIMITS.location) },
    };
}

/** The guild of an event, or null when the bot is not connected to it. */
function guildOf(event) {
    try {
        return discord.getGuild(String((event && event.guildId) || "")) || null;
    } catch {
        return null;
    }
}

/**
 * The event's voice channel id when that channel exists on the server and is a
 * voice or stage channel; "" otherwise. A channel that was deleted must not
 * make the whole Discord event fail — it falls back to an external one.
 */
function voiceChannelFor(guild, event) {
    const id = String((event && event.voiceChannelId) || "");
    if (!guild || !id) return "";
    const channel = guild.channels && guild.channels.cache ? guild.channels.cache.get(id) : null;
    if (!channel) return "";
    return channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice ? id : "";
}

/** Whether the bot may manage this server's events; null when that cannot be known. */
function canManageEvents(guildId) {
    try {
        return discord.botCanManageEvents(guildId);
    } catch {
        return null;
    }
}

const MISSING_RIGHT = "Dem Bot fehlt das Recht „Events verwalten“ – ohne das legt Discord kein Event an.";

/** Remember what went wrong, without losing a stored id. */
function noteError(eventId, error) {
    eventStore.setEventDiscordEvent(eventId, { error: String(error || ""), at: Date.now() });
    return { warning: String(error || "") };
}

/** The discord.js error as one German sentence. */
function errorText(e) {
    const message = (e && e.message) || "unbekannter Fehler";
    if (e && (e.code === 50013 || /missing permissions/i.test(message))) return MISSING_RIGHT;
    return message;
}

/** The scheduled event of a stored id, null when it is gone (404) — throws anything else. */
async function fetchScheduledEvent(guild, id) {
    try {
        return await guild.scheduledEvents.fetch(String(id));
    } catch (e) {
        if (isGone(e)) return null;
        throw e;
    }
}

/**
 * Create the Discord event for an own event.
 * @returns {Promise<{ id?: string, skipped?: string, warning?: string }>}
 *   `skipped`: "disabled" (the category does not want one), "exists", "past"
 *   (the raid is over), "cancelled", "offline".
 */
async function createForEvent(eventId, { config = getConfig(), now = Date.now() } = {}) {
    const event = eventStore.getEvent(eventId);
    if (!event) return { skipped: "not_found" };
    if (!enabledFor(event, config)) return { skipped: "disabled" };
    if (event.status === "cancelled") return { skipped: "cancelled" };
    if (event.discordEvent && event.discordEvent.id) return { skipped: "exists", id: event.discordEvent.id };
    if (eventEndTime(event) * 1000 <= now) return { skipped: "past" };
    const guild = guildOf(event);
    if (!guild || !guild.scheduledEvents) return { skipped: "offline" };
    if (canManageEvents(event.guildId) === false) return noteError(event.id, MISSING_RIGHT);
    try {
        const created = await guild.scheduledEvents.create(buildScheduledEvent(event, { voiceChannelId: voiceChannelFor(guild, event) }));
        eventStore.setEventDiscordEvent(event.id, { id: String(created.id), guildId: event.guildId, at: now, error: "" });
        return { id: String(created.id) };
    } catch (e) {
        return noteError(event.id, errorText(e));
    }
}

/**
 * Bring the Discord event in line with the raid: title, description, start,
 * end and place. Without one yet it is created (when the category wants it);
 * one that was deleted by hand is forgotten and, if it still makes sense,
 * created anew.
 * @returns {Promise<{ id?: string, skipped?: string, warning?: string }>}
 */
async function syncForEvent(eventId, { config = getConfig(), now = Date.now() } = {}) {
    const event = eventStore.getEvent(eventId);
    if (!event) return { skipped: "not_found" };
    const stored = event.discordEvent && event.discordEvent.id ? String(event.discordEvent.id) : "";
    if (!stored) return createForEvent(eventId, { config, now });
    const guild = guildOf(event);
    if (!guild || !guild.scheduledEvents) return { skipped: "offline" };
    if (canManageEvents(event.guildId) === false) return noteError(event.id, MISSING_RIGHT);
    let scheduled;
    try {
        scheduled = await fetchScheduledEvent(guild, stored);
    } catch (e) {
        return noteError(event.id, errorText(e));
    }
    if (!scheduled) {
        // Deleted in Discord — forget it, then create one again if the raid is still ahead.
        eventStore.setEventDiscordEvent(event.id, null);
        return createForEvent(eventId, { config, now });
    }
    // A finished or cancelled Discord event can no longer be edited; nothing to do.
    if (scheduled.status && scheduled.status !== GuildScheduledEventStatus.Scheduled && scheduled.status !== GuildScheduledEventStatus.Active) {
        return { skipped: "closed", id: stored };
    }
    try {
        await scheduled.edit(buildScheduledEvent(event, { voiceChannelId: voiceChannelFor(guild, event) }));
        eventStore.setEventDiscordEvent(event.id, { error: "", at: now });
        return { id: stored };
    } catch (e) {
        return noteError(event.id, errorText(e));
    }
}

/**
 * Call the Discord event off: its status becomes "Canceled" where Discord
 * allows it (a scheduled one), else it is deleted — an event still listed for a
 * raid that is not happening is worse than none. The record is kept either way
 * so reopening knows there was one.
 */
async function cancelForEvent(eventId, { now = Date.now() } = {}) {
    const event = eventStore.getEvent(eventId);
    if (!event) return { skipped: "not_found" };
    const stored = event.discordEvent && event.discordEvent.id ? String(event.discordEvent.id) : "";
    if (!stored) return { skipped: "none" };
    const guild = guildOf(event);
    if (!guild || !guild.scheduledEvents) return { skipped: "offline" };
    let scheduled;
    try {
        scheduled = await fetchScheduledEvent(guild, stored);
    } catch (e) {
        return noteError(event.id, errorText(e));
    }
    if (!scheduled) {
        eventStore.setEventDiscordEvent(event.id, null);
        return { skipped: "gone" };
    }
    try {
        if (scheduled.status === GuildScheduledEventStatus.Scheduled) {
            // Say it is off before it disappears: the description carries the reason.
            await scheduled.edit({ description: describeEvent(event) }).catch(() => undefined);
            await scheduled.setStatus(GuildScheduledEventStatus.Canceled);
        } else {
            await scheduled.delete();
            eventStore.setEventDiscordEvent(event.id, null);
            return { cancelled: true, deleted: true };
        }
        eventStore.setEventDiscordEvent(event.id, { error: "", at: now });
        return { cancelled: true, id: stored };
    } catch (e) {
        // Discord refuses some status changes; deleting is the honest fallback.
        try {
            await scheduled.delete();
            eventStore.setEventDiscordEvent(event.id, null);
            return { cancelled: true, deleted: true };
        } catch {
            return noteError(event.id, errorText(e));
        }
    }
}

/** Delete the Discord event and forget it. A 404 counts as deleted. */
async function deleteForEvent(event, { store = true } = {}) {
    const ev = typeof event === "string" ? eventStore.getEvent(event) : event;
    if (!ev) return { skipped: "not_found" };
    const stored = ev.discordEvent && ev.discordEvent.id ? String(ev.discordEvent.id) : "";
    if (!stored) return { skipped: "none" };
    const forget = () => {
        if (store) eventStore.setEventDiscordEvent(ev.id, null);
    };
    const guild = guildOf(ev);
    if (!guild || !guild.scheduledEvents) return { skipped: "offline" };
    try {
        const scheduled = await fetchScheduledEvent(guild, stored);
        if (!scheduled) {
            forget();
            return { deleted: false, skipped: "gone" };
        }
        await scheduled.delete();
        forget();
        return { deleted: true };
    } catch (e) {
        if (isGone(e)) {
            forget();
            return { deleted: false, skipped: "gone" };
        }
        return { warning: `Discord-Event nicht gelöscht: ${errorText(e)}` };
    }
}

/**
 * Take a cancellation back: a cancelled Discord event cannot be revived, so the
 * old one is dropped and a new one created (when the category wants one).
 */
async function reopenForEvent(eventId, { config = getConfig(), now = Date.now() } = {}) {
    const event = eventStore.getEvent(eventId);
    if (!event) return { skipped: "not_found" };
    if (event.discordEvent && event.discordEvent.id) {
        await deleteForEvent(event);
    }
    return createForEvent(eventId, { config, now });
}

/**
 * The one-line warning an action reports, or "" — every caller appends it to
 * its own `warnings`, so a Discord event never fails what it belongs to.
 */
function warningOf(result) {
    return result && result.warning ? `Discord-Event: ${result.warning}` : "";
}

module.exports = {
    createForEvent, syncForEvent, cancelForEvent, deleteForEvent, reopenForEvent,
    buildScheduledEvent, describeEvent, enabledFor, eventUrl, voiceChannelFor, warningOf,
    SIGNUP_NOTE, MISSING_RIGHT, LIMITS,
};
