// Creating an event, for every way into it: the web's create dialog
// (POST /api/raids) today, the Discord modal (#260) later.
//
// Which source the event gets is decided by the category it lands in
// (`categorySignupSource`, eventSources.signupSourceFor): "raidhelper" creates
// it at Raid-Helper as before, "eventhelper" in the own store — and posts the
// bot's event message into the channel. The channel is chosen or cloned from an
// earlier event the same way for both.
const { DateTime } = require("luxon");
const discord = require("./discord");
const eventStore = require("./eventStore");
const { getRaidEvent } = require("./raidEventStore");
const { loadEventGroups, eventLookbackSince } = require("./raidEventGroups");
const { signupSourceFor } = require("./eventSources");
const { postEventMessage } = require("./eventMessage");
const { raidContentIds } = require("./raidListing");
const { createRaidhelperClient } = require("../utils/raidhelperClient");
const { toRaidHelperDate } = require("../utils/date");

const ZONE = "Europe/Berlin";

/** Unix seconds of a "dd-MM-yyyy" date and "HH:mm" time in Berlin time, or 0. */
function startTimeOf(date, time) {
    const dt = DateTime.fromFormat(`${date} ${String(time || "").trim()}`, "dd-MM-yyyy H:mm", { zone: ZONE });
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

function categoryMap(guildId) {
    try {
        return discord.getChannelCategoryMap(guildId) || {};
    } catch {
        return {};
    }
}

const fail = (status, code, message) => ({ error: { status, code, message } });

/**
 * Create an event from the create dialog's body.
 *
 * Body: { title, date, time, description, leaderId, templateId, channelId |
 * sourceEventId + channelName } plus, for an EventHelper category, the
 * optional planning fields { versionId, instanceIds, size, composition,
 * signupDeadline (unix seconds), fairness, wishes }. Missing planning fields
 * come from the rule set; missing instances are read from the title.
 *
 * @param {{ guildId: string, user?: { id: string }, body: object }} input
 * @returns {Promise<{ status: number, body: object } | { error: { status: number, code: string, message: string } }>}
 */
async function createEvent({ guildId, user, body = {} }) {
    const date = toRaidHelperDate(body.date);
    if (!date) return fail(400, "invalid_date", "Ungültiges Datum.");
    const rh = createRaidhelperClient();
    const catMap = categoryMap(guildId);

    let channelId = String(body.channelId || "").trim();
    const sourceEventId = String(body.sourceEventId || "").trim();
    let sourceChannel = null;
    if (sourceEventId) {
        sourceChannel = await sourceChannelFor(rh, guildId, sourceEventId);
        if (!sourceChannel.channelId) return fail(400, sourceChannel.code, sourceChannel.message);
    } else if (!channelId) {
        return fail(400, "no_channel", "Kein Channel gewählt.");
    }

    // The category decides the source. A clone lands next to its original.
    const lookupChannel = sourceChannel ? sourceChannel.channelId : channelId;
    const meta = catMap[lookupChannel] || {};
    const categoryId = meta.categoryId || (sourceChannel && sourceChannel.categoryId) || "";
    const source = signupSourceFor(categoryId);

    const title = String(body.title || "").trim();
    let plan = null;
    let startTime = 0;
    if (source === "eventhelper") {
        // Everything the own store would refuse is checked before a channel is
        // cloned, so a rejected event never leaves an orphan channel behind.
        if (!title) return fail(400, "invalid_title", "Das Event braucht einen Titel.");
        startTime = startTimeOf(date, body.time);
        if (!startTime) return fail(400, "invalid_time", "Ungültige Uhrzeit.");
        const instanceIds = Array.isArray(body.instanceIds) && body.instanceIds.length
            ? body.instanceIds
            : raidContentIds({ title }).contentIds;
        const checked = eventStore.normalizePlan({ ...body, instanceIds });
        if (checked.error) return fail(400, "invalid_plan", checked.error);
        plan = checked.value;
    }

    let channelName = "";
    try {
        if (sourceChannel) {
            const cloned = await discord.duplicateChannel(sourceChannel.channelId, String(body.channelName || "").trim());
            channelId = cloned.id;
            channelName = cloned.name || "";
        }
    } catch (e) {
        return fail(400, "create_failed", e.message || "Channel konnte nicht dupliziert werden.");
    }

    if (source === "raidhelper") {
        try {
            const result = await rh.createEvent({
                channelId,
                leaderId: String(body.leaderId || "").trim(),
                templateId: String(body.templateId || "").trim(),
                date,
                time: String(body.time || "").trim(),
                title,
                description: body.description || "",
            });
            if (result && result.status === "failed") {
                return fail(400, "create_failed", result.reason || result.message || "Raid-Helper hat die Erstellung abgelehnt.");
            }
            return { status: 201, body: result };
        } catch (e) {
            return fail(400, "create_failed", e.message || "Event konnte nicht angelegt werden.");
        }
    }

    const created = eventStore.createEvent({
        ...plan,
        guildId,
        channelId,
        channelName: channelName || meta.name || "",
        categoryId,
        categoryName: meta.categoryName || "",
        title,
        description: body.description || "",
        leaderId: String(body.leaderId || "").trim() || (user && user.id) || "",
        startTime,
        signupDeadline: body.signupDeadline,
        fairness: body.fairness,
        wishes: body.wishes,
        createdBy: (user && user.id) || "",
    });
    if (created.error) return fail(400, "create_failed", created.error);

    // The event exists either way; a message that could not be posted (bot
    // offline, missing rights) is reported, and the next roster change retries.
    let messageError = null;
    try {
        await postEventMessage(created.event.id);
    } catch (e) {
        messageError = e.message || "Die Event-Nachricht konnte nicht gepostet werden.";
    }
    const event = eventStore.getEvent(created.event.id) || created.event;
    return { status: 201, body: { id: event.id, source: "eventhelper", event, messageError } };
}

module.exports = { createEvent, sourceChannelFor, startTimeOf };
