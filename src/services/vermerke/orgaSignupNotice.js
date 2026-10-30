// The read side of the orga's hint at signup (docs/vermerke.md, #983): the bot
// process registers postBatch as the flush handler of orgaSignupQueue. A batch
// is the first signups of one server within about two minutes; whoever of them
// carries a warning or a shadowban on that server (own or shared, not hidden,
// not expired - vermerkeShort) gets one line in a message to the orga:
//
//   @Name (Char) · Raid <time> · Warnung · Nicht erschienen ×3 · Vermerke-Link
//
// Where: the category's Orga-Zentrale (orgaHubStore) when it lives on the
// raid's server and the bot can post there, otherwise the orga channel of the
// category / the server (signupNotes.noteChannelFor). No channel = only a log
// line. Never into a public channel, a thread or a DM; the person never sees it.
// No free text and no author of a Vermerk, only level and reasons with counts.
const discord = require("../discord/discord");
const { getConfig } = require("../../stores/settingsStore");
const hubs = require("../../stores/orgaHubStore");
const { noteChannelFor, plainText } = require("../signups/signupNotes");
const { shortFor, levelRank } = require("./vermerkeShort");
const { card, CARD_TEXT_LIMIT } = require("../../utils/discord/card");
const { publicBaseUrl } = require("../../utils/publicUrl");
const queue = require("./orgaSignupQueue");

const LEVEL_LABELS = { hint: "Hinweis", warning: "Warnung", shadowban: "Shadowban" };
const REASON_LABELS = {
    late_signoff: "Späte Abmeldung",
    no_show: "Nicht erschienen",
    left_early: "Früh gegangen",
    left_server: "Server verlassen",
    behavior: "Verhalten",
    loot: "Loot",
    other: "Sonstiges",
};
const REASON_ORDER = Object.keys(REASON_LABELS);
// Room for the heading and the note inside one card.
const LINES_LIMIT = CARD_TEXT_LIMIT - 400;

const str = (v) => (v === null || v === undefined ? "" : String(v)).trim();

/** Does this level count for the server's switch ("warning" = warning or shadowban)? */
function levelCounts(level, switchLevel) {
    const floor = levelRank(switchLevel) > 0 ? levelRank(switchLevel) : levelRank("warning");
    return levelRank(level) >= floor;
}

/** "Nicht erschienen ×3 · Verhalten" - most frequent first. */
function reasonsText(reasons = {}) {
    return Object.entries(reasons)
        .filter(([, n]) => Number(n) > 0)
        .sort(([a, na], [b, nb]) => nb - na || REASON_ORDER.indexOf(a) - REASON_ORDER.indexOf(b))
        .map(([reason, n]) => `${REASON_LABELS[reason] || REASON_LABELS.other}${n > 1 ? ` ×${n}` : ""}`)
        .join(" · ");
}

/** One line of the message for a signup and the person's short form. */
function buildNoticeLine(item, short, { base = publicBaseUrl() } = {}) {
    const name = plainText(item.name);
    const who = `<@${item.userId}>${name ? ` (${name})` : ""}`;
    // startTime is unix seconds, as in the event store
    const start = Number(item.startTime) > 0 ? ` <t:${Math.floor(Number(item.startTime))}:f>` : "";
    const raid = `**${plainText(item.title) || "Raid"}**${start}`;
    const reasons = reasonsText(short.reasons);
    const link = base ? `[Vermerke](${base}/vermerke?user=${encodeURIComponent(item.userId)})` : "";
    return [who, raid, LEVEL_LABELS[short.level] || short.level, reasons, link].filter(Boolean).join(" · ");
}

/** The card(s) of one channel: as many lines as fit, the rest in the next card. */
function buildNoticePosts(lines) {
    const chunks = [];
    let current = [];
    let size = 0;
    for (const line of lines) {
        if (current.length && size + line.length + 1 > LINES_LIMIT) {
            chunks.push(current);
            current = [];
            size = 0;
        }
        current.push(line);
        size += line.length + 1;
    }
    if (current.length) chunks.push(current);
    return chunks.map((chunk) => card({
        kind: "warn",
        kicker: "Vermerke",
        title: chunk.length === 1 ? "Anmeldung mit Vermerk" : `${chunk.length} Anmeldungen mit Vermerk`,
        text: chunk.join("\n"),
        note: "Nur für die Orga – die Person sieht das nicht.",
    }));
}

/** The server a channel lives on, from the bot's cache; "" = unknown. */
function guildOfChannel(channelId) {
    try {
        const client = typeof discord.getClient === "function" ? discord.getClient() : null;
        const channel = client && client.channels && client.channels.cache ? client.channels.cache.get(str(channelId)) : null;
        return channel ? str(channel.guildId || (channel.guild && channel.guild.id)) : "";
    } catch {
        return "";
    }
}

/** Where a raid category's hint goes on this server: Orga-Zentrale, else the orga channel. "" = nowhere. */
function channelFor(categoryId, guildId, config) {
    // A channel on another server never takes the post (postPayload would refuse
    // it with wrong_guild): the category's own channel then falls back to the
    // server's default instead of losing the line.
    const onGuild = (id) => {
        if (!discord.channelVisible(id)) return false;
        const owner = guildOfChannel(id);
        return !owner || owner === str(guildId);
    };
    const hub = categoryId ? hubs.getHub(categoryId) : null;
    if (hub && hub.channelId && str(hub.guildId) === str(guildId) && onGuild(hub.channelId)) return hub.channelId;
    const channelId = noteChannelFor(categoryId, config, { reachable: onGuild, guildId }) || "";
    return channelId && onGuild(channelId) ? channelId : "";
}

/**
 * Turn one server's batch into posts. Re-reads the switch (off by now =
 * nothing). Returns what happened per channel (tests, log).
 * @param {string} guildId
 * @param {Array<{ eventId, categoryId, title, startTime, userId, name }>} items
 */
async function postBatch(guildId, items, { config = getConfig(), now = Date.now(), base = publicBaseUrl() } = {}) {
    const notice = queue.orgaNoticeOf(guildId, { config });
    if (!notice.enabled || !Array.isArray(items) || !items.length) return { posted: 0, lines: 0 };
    const shorts = shortFor(guildId, [...new Set(items.map((i) => i.userId))], { now });
    const byChannel = new Map();
    let lines = 0;
    let noChannel = 0;
    for (const item of items) {
        const short = shorts[item.userId];
        if (!short || !levelCounts(short.level, notice.level)) continue;
        lines += 1;
        const channelId = channelFor(item.categoryId, guildId, config);
        if (!channelId) {
            noChannel += 1;
            continue;
        }
        if (!byChannel.has(channelId)) byChannel.set(channelId, []);
        byChannel.get(channelId).push(buildNoticeLine(item, short, { base }));
    }
    if (noChannel) console.log(`[orgaSignupNotice] ${noChannel} Anmeldung(en) mit Vermerk auf ${guildId}: kein Orga-Kanal, nur geloggt.`);
    let posted = 0;
    for (const [channelId, channelLines] of byChannel) {
        for (const post of buildNoticePosts(channelLines)) {
            try {
                await discord.postPayload(channelId, post, { guildId });
                posted += 1;
            } catch (e) {
                console.warn(`[orgaSignupNotice] Hinweis nicht in ${channelId} gepostet: ${(e && e.message) || e}`);
            }
        }
    }
    return { posted, lines, noChannel };
}

/** Register the handler (bot process start, web/http/jobs.js). */
function startOrgaSignupNotice() {
    queue.setFlushHandler((guildId, items) => postBatch(guildId, items));
}

/** Unregister and drop whatever was still waiting. */
function stopOrgaSignupNotice() {
    queue.setFlushHandler(null);
    queue.clearPending();
}

module.exports = {
    LEVEL_LABELS, REASON_LABELS, levelCounts, reasonsText, buildNoticeLine, buildNoticePosts, channelFor, postBatch,
    startOrgaSignupNotice, stopOrgaSignupNotice,
};
