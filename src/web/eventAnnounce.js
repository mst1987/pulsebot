// "Beim Anlegen ankündigen" (#306): one short post per new own event that pings
// the category's raider role — the thing Raid-Helper did on create and we did
// not. Title, date and a link to the signup message, nothing else: whoever wants
// more opens the message the link points at.
//
// Two rules shape this module:
//
//   * it is the ping machinery of #264 and nothing beside it — pingDelivery's
//     deliverAnnouncement() decides what a role mention means on which server,
//     who gets a DM instead and what "event | talk | both" costs. There is no
//     second delivery path here;
//   * it happens exactly once per event. `event.announcedAt` is written when a
//     post went out (eventStore.setEventAnnounced, which never overwrites an
//     earlier moment), and every caller runs through announceEvent(), so
//     editing, re-posting the signup message or creating the same date twice
//     cannot ping the raiders again.
//
// A series event (#289) is announced like a hand-made one: it goes through
// eventCreate.createEvent(), so there is one switch and no special path.
const eventStore = require("./eventStore");
const { getConfig } = require("./settingsStore");
const { normalizePingTarget, deliverAnnouncement } = require("./pingDelivery");

/**
 * The category's announcement setting (#306), or the caller's own choice.
 * `want` is what a create dialog sent: `true`/`false` overrides the category,
 * `undefined` follows it.
 * @returns {{ enabled: boolean, target: string }}
 */
function announceSetting(categoryId, { config = getConfig(), want } = {}) {
    const entry = ((config && config.categoryAnnounce) || {})[String(categoryId || "")] || {};
    const target = normalizePingTarget(entry.target);
    if (want === true) return { enabled: true, target };
    if (want === false) return { enabled: false, target };
    return { enabled: entry.enabled === true, target };
}

/** A jump link to the event's signup message, else to its channel, else "". */
function messageUrl(event) {
    const guildId = String((event && event.guildId) || "");
    const channelId = String((event && event.channelId) || "");
    const messageId = String((event && event.message && event.message.messageId) || "");
    if (!guildId || !channelId) return "";
    return `https://discord.com/channels/${guildId}/${channelId}${messageId ? `/${messageId}` : ""}`;
}

/**
 * The announcement itself: one line with the raid, its date and the link to
 * the signup message — the shape pingDelivery/discord.postAnnouncement expect
 * (`{ title, body }`, rendered as an embed with the role mentions above it).
 */
function buildAnnouncement(event) {
    const title = String((event && event.title) || "Raid").trim() || "Raid";
    const start = Number(event && event.startTime) || 0;
    const url = messageUrl(event);
    const when = start ? `<t:${start}:F> · <t:${start}:R>` : "";
    const line = [when, url ? `[Sign up](${url})` : ""].filter(Boolean).join("\n");
    return { title: `New raid: ${title}`, body: line || "A new raid is on the calendar." };
}

/**
 * Announce a freshly created own event, once.
 *
 * @param {string} eventId
 * @param {{ want?: boolean, config?: object, now?: number }} opts
 *   `want`: the create dialog's own switch — true/false overrides the category.
 * @returns {Promise<{ announced: boolean, target?: string, skipped?: string, error?: string, delivery?: object }>}
 *   `skipped`: "off" (nobody asked for it), "already" (this event was announced),
 *   "not_own" / "not_found" — never a throw, a create is never failed by its ping.
 */
async function announceEvent(eventId, { want, config = getConfig(), now = Date.now() } = {}) {
    const event = eventStore.isOwnEventId(eventId) ? eventStore.getEvent(eventId) : null;
    if (!event) return { announced: false, skipped: eventStore.isOwnEventId(eventId) ? "not_found" : "not_own" };
    if (event.announcedAt) return { announced: false, skipped: "already" };
    const setting = announceSetting(event.categoryId, { config, want });
    if (!setting.enabled) return { announced: false, skipped: "off" };

    const roleIds = ((config.categoryRoles || {})[String(event.categoryId || "")] || []).map(String).filter(Boolean);
    try {
        const delivery = await deliverAnnouncement({
            target: setting.target,
            event,
            channelId: event.channelId,
            template: buildAnnouncement(event),
            roleIds,
            guildId: event.guildId,
            config,
        });
        eventStore.setEventAnnounced(event.id, now);
        eventStore.appendEventLog(event.id, { action: "announce", detail: `Ziel ${setting.target}`, at: now });
        return { announced: true, target: setting.target, delivery };
    } catch (e) {
        // Nothing is marked, so the announcement can still be sent by hand
        // (Raid-Detail → Anmelde-Aufruf) without the event counting as announced.
        return { announced: false, target: setting.target, error: e.message || "Die Ankündigung konnte nicht gepostet werden." };
    }
}

module.exports = { announceSetting, buildAnnouncement, messageUrl, announceEvent };
