// A softres.it list a raid lead made on softres.it itself and posted into the
// raid's channel: the bot notices the link and ties it to the event, so the
// dashboard and the raid page show the softres as present ("Softres fehlt"
// goes away) without anyone pasting it into the web menu.
//
//   * onMessage(message)  - the live listener (bot.js, next to the log detection)
//   * backfill()          - once after the start and every 30 minutes: the last
//                           messages of the channel of every upcoming softres raid
//                           without a list (a link posted while the bot was down)
//
// Which event a channel belongs to is answered from stored data only - the own
// events and the synced Raid-Helper list (raidhelperEventsStore); Raid-Helper
// itself is never asked (1000 requests a day). A record that already has a url
// is never overwritten, whoever made it: the menu wins.
const eventStore = require("../../stores/eventStore");
const { readSnapshot } = require("../../stores/raidhelperEventsStore");
const { getEventSoftres, setEventSoftresLink } = require("../../stores/eventSoftresStore");
const { lootSystemOf } = require("../../stores/eventLootSystemStore");
const discord = require("../discord/discord");
const logger = require("../../logger").child("softresDetect");

const SOFTRES_URL = /https?:\/\/(?:www\.)?softres\.it\/raid\/([a-zA-Z0-9]+)/gi;
// A raid counts as "not yet over" this long after its start.
const OVER_AFTER_MS = 6 * 60 * 60 * 1000;
const BACKFILL_DAYS = 14;
const BACKFILL_MESSAGES = 50;
const BACKFILL_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 60 * 1000;

let timers = { first: null, interval: null };

/** All text a softres link might hide in: content and embeds. */
function messageText(message) {
    const parts = [message.content || ""];
    for (const embed of message.embeds || []) {
        for (const v of [embed.url, embed.title, embed.description]) if (v) parts.push(v);
        if (embed.author && embed.author.url) parts.push(embed.author.url);
        for (const field of embed.fields || []) parts.push(field.name || "", field.value || "");
    }
    return parts.join("\n");
}

/** Every softres.it raid in a message (or text) as https://softres.it/raid/ID, once each, in order. */
function extractSoftresUrls(input) {
    const text = typeof input === "string" ? input : messageText(input || {});
    const urls = [];
    for (const m of text.matchAll(SOFTRES_URL)) {
        const url = "https://softres.it/raid/" + m[1];
        if (!urls.includes(url)) urls.push(url);
    }
    return urls;
}

/** Non-cancelled events of both sources in a channel, in one shape (stored data only). */
function eventsInChannel(channelId, guildId) {
    const cid = String(channelId || "");
    if (!cid) return [];
    const own = eventStore.listEvents(guildId || "")
        .filter((e) => e.channelId === cid && e.status !== "cancelled")
        .map((e) => ({ id: e.id, source: "own", startTime: Number(e.startTime) || 0, categoryId: e.categoryId || "", channelId: cid }));
    let categoryId = null;
    const rh = (readSnapshot().events || [])
        .filter((e) => String(e.channelId || "") === cid && e.id)
        .map((e) => {
            if (categoryId === null) {
                const meta = guildId ? discord.getChannelCategoryMap(guildId)[cid] : null;
                categoryId = (meta && meta.categoryId) || "";
            }
            return { id: String(e.id), source: "raidhelper", startTime: Number(e.startTime) || 0, categoryId, channelId: cid };
        });
    return [...own, ...rh];
}

/** The soonest event of the channel that is not over at atMs, or null. */
function targetEvent(channelId, guildId, atMs) {
    const minStart = Math.floor((atMs - OVER_AFTER_MS) / 1000);
    return eventsInChannel(channelId, guildId)
        .filter((e) => e.startTime >= minStart)
        .sort((a, b) => a.startTime - b.startTime)[0] || null;
}

function authorName(message) {
    return (message.member && message.member.displayName)
        || (message.author && (message.author.globalName || message.author.username)) || "Discord";
}

/**
 * React to one message. Returns what happened:
 * { linked: true, eventId, url } or { linked: false, reason }.
 */
function onMessage(message) {
    if (!message || !message.guild) return { linked: false, reason: "dm" };
    const selfId = message.client && message.client.user && message.client.user.id;
    if (message.author && selfId && message.author.id === selfId) return { linked: false, reason: "self" };
    const urls = extractSoftresUrls(message);
    if (!urls.length) return { linked: false, reason: "no-link" };
    const at = Number(message.createdTimestamp) || Date.now();
    const event = targetEvent(message.channelId || (message.channel && message.channel.id), message.guild.id, at);
    if (!event) return { linked: false, reason: "no-event" };
    const existing = getEventSoftres(event.id);
    if (existing && existing.url) return { linked: false, reason: "has-list", eventId: event.id };
    const url = urls[0];
    setEventSoftresLink(event.id, { url, editUrl: url });
    if (event.source === "own") {
        eventStore.appendEventLog(event.id, {
            action: "softresLinked", by: String((message.author && message.author.id) || ""), byName: authorName(message), detail: url,
        });
    }
    logger.info("softres " + url + " linked to " + event.id);
    return { linked: true, eventId: event.id, url };
}

/**
 * Look through the recent messages of every upcoming softres raid without a
 * list, once per channel. Best-effort: a channel that cannot be read is skipped.
 * @returns {Promise<{ checked: number, linked: { eventId: string, url: string }[] }>}
 */
async function backfill({ now = Date.now() } = {}) {
    const result = { checked: 0, linked: [] };
    const from = Math.floor((now - OVER_AFTER_MS) / 1000);
    const to = Math.floor(now / 1000) + BACKFILL_DAYS * 86400;
    for (const g of discord.listGuilds()) {
        const channels = new Set();
        for (const ev of eventStore.listEvents(g.id, { sinceSeconds: from, untilSeconds: to })) {
            if (ev.channelId && ev.status !== "cancelled") channels.add(ev.channelId);
        }
        for (const ev of readSnapshot().events || []) {
            const t = Number(ev.startTime) || 0;
            if (ev.channelId && t >= from && t <= to) channels.add(String(ev.channelId));
        }
        for (const channelId of channels) {
            const event = targetEvent(channelId, g.id, now);
            if (!event || event.startTime > to) continue;
            if ((getEventSoftres(event.id) || {}).url) continue;
            if (!lootSystemOf(event.id, event.categoryId).softres) continue;
            result.checked += 1;
            try {
                const channel = await discord.fetchTextChannel(channelId);
                const messages = await channel.messages.fetch({ limit: BACKFILL_MESSAGES });
                const newest = [...messages.values()]
                    .filter((m) => now - (Number(m.createdTimestamp) || 0) <= BACKFILL_MAX_AGE_MS)
                    .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
                    .find((m) => extractSoftresUrls(m).length);
                if (!newest) continue;
                const done = onMessage(newest);
                if (done.linked) result.linked.push({ eventId: done.eventId, url: done.url });
            } catch (e) {
                logger.warn("backfill " + channelId + ": " + e.message);
            }
        }
    }
    return result;
}

/** Backfill soon after the start, then every 30 minutes (unref'd; idempotent). */
function startSoftresDetect({ intervalMs = SWEEP_INTERVAL_MS, firstDelayMs = FIRST_SWEEP_DELAY_MS } = {}) {
    if (timers.interval) return timers.interval;
    const run = () => backfill().catch((e) => logger.warn("backfill failed: " + e.message));
    timers.first = setTimeout(run, firstDelayMs);
    timers.interval = setInterval(run, intervalMs);
    for (const t of [timers.first, timers.interval]) if (t.unref) t.unref();
    return timers.interval;
}

function stopSoftresDetect() {
    clearTimeout(timers.first);
    clearInterval(timers.interval);
    timers = { first: null, interval: null };
}

module.exports = { extractSoftresUrls, onMessage, backfill, eventsInChannel, startSoftresDetect, stopSoftresDetect };
