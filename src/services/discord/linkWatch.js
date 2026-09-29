// What happens when Discord takes a link target away (#537): a channel or one
// of the bot's tracked messages is deleted. linkCheck.js learns it at once (no
// five-minute wait), and whatever shows a link to it is drawn again:
//
//   channel deleted  → every own event in it gets a log entry ("Kanal in
//                      Discord gelöscht"), the raid overviews redraw — their
//                      line for that raid says "channel missing" — and the
//                      dashboard shows the task "Kanal von <Event> fehlt"
//                      (computed on read, dashboard.js).
//   message deleted  → an own event's signup message is posted anew (the
//                      sweep would not: its hash still matches), a posted
//                      setup is marked as not posted, a raid overview message
//                      is posted anew by its sync.
//
// MESSAGE_DELETE comes in as a raw gateway packet: the client has no
// Partials.Message (#430), so a message it did not cache (every message after
// a restart) would never reach "messageDelete".
const linkCheck = require("./linkCheck");
const eventStore = require("../../stores/eventStore");
const { getOverviewState } = require("../../stores/talkOverviewStore");
const { getConfig } = require("../../stores/settingsStore");
const logger = require("../../logger").child("linkWatch");

// How long after a deletion the overviews redraw — a bulk delete of several
// channels ends in one redraw.
const REDRAW_DELAY_MS = 1500;
// Own events this far back still get their log entry (a raid of yesterday evening).
const LOOKBACK_S = 2 * 86400;

/** Lazily: talkOverview/eventMessage pull in much of the bot, which the tests of this module mock. */
function scheduleOverviews() {
    require("../talk/talkOverview").scheduleOverviewSync({ delayMs: REDRAW_DELAY_MS });
}

function recentOwnEvents(now = Date.now()) {
    return eventStore.listEvents("", { sinceSeconds: Math.floor(now / 1000) - LOOKBACK_S });
}

/** A channel was deleted in Discord. Returns the ids of the own events that lived in it. */
function onChannelDelete(channel, { now = Date.now() } = {}) {
    const channelId = String((channel && channel.id) || "");
    if (!channelId) return [];
    linkCheck.channelDeleted(channelId, now);
    const hit = recentOwnEvents(now).filter((e) => String(e.channelId) === channelId);
    for (const event of hit) {
        eventStore.appendEventLog(event.id, { action: "channelGone", by: "", byName: "Discord", detail: `#${event.channelName || channelId}` });
        logger.info(`Kanal #${event.channelName || channelId} von ${event.id} gelöscht`);
    }
    scheduleOverviews();
    return hit.map((e) => e.id);
}

/** Whether a message is one of the raid overview messages. */
function isOverviewMessage(messageId, config = getConfig()) {
    const entries = (((config && config.discordServers) || {}).eventGuilds) || [];
    return entries.some((e) => e && e.guildId && getOverviewState(e.guildId).messageId === messageId);
}

/** A message was deleted in Discord. Returns what was done about it. */
function onMessageDelete({ channelId, messageId }, { now = Date.now() } = {}) {
    const id = String(messageId || "");
    if (!id) return { redrawn: [], setupCleared: [], overview: false };
    linkCheck.messageDeleted(id, now);
    const redrawn = [];
    const setupCleared = [];
    for (const event of recentOwnEvents(now)) {
        if (event.message && String(event.message.messageId) === id) {
            // Forget it, so the redraw posts it anew instead of finding its hash unchanged.
            eventStore.setEventMessage(event.id, null);
            redrawn.push(event.id);
        }
        if (event.setupPost && String(event.setupPost.messageId) === id) {
            eventStore.setEventSetupPost(event.id, { messageId: "" });
            setupCleared.push(event.id);
        }
    }
    if (redrawn.length) {
        const { redrawEventMessage } = require("../events/eventMessage");
        for (const eventId of redrawn) redrawEventMessage(eventId);
    }
    const overview = isOverviewMessage(id);
    if (overview || redrawn.length) scheduleOverviews();
    return { redrawn, setupCleared, overview, channelId: String(channelId || "") };
}

/** Hook both into the bot client (bot.js). */
function attach(client) {
    client.on("channelDelete", (channel) => {
        try {
            onChannelDelete(channel);
        } catch (e) {
            logger.error("channelDelete:", e.message);
        }
    });
    client.on("raw", (packet) => {
        if (!packet || !packet.d) return;
        let ids = [];
        if (packet.t === "MESSAGE_DELETE") ids = [packet.d.id];
        else if (packet.t === "MESSAGE_DELETE_BULK") ids = packet.d.ids || [];
        try {
            for (const id of ids) onMessageDelete({ channelId: packet.d.channel_id, messageId: id });
        } catch (e) {
            logger.error("messageDelete:", e.message);
        }
    });
}

module.exports = { attach, onChannelDelete, onMessageDelete, REDRAW_DELAY_MS };
