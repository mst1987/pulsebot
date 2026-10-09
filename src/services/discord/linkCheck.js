// The one place a link into an overview is built (#537): "Links dürfen nicht
// kaputt sein. Alles, was in den Übersichten steht, MUSS funktionieren."
//
// Every overview — the talk overview, the signup message's link line, the
// setup message, the raid plan post, "Event verwalten", the web lists — asks
// here instead of gluing a URL together, and gets "" for a link that would not
// work. `test/services/discord/linkCheck.guard.test.js` keeps
// `discord.com/channels/` out of every other file in `src/`.
//
// Discord links (channel, message):
//   * The bot's client keeps every channel of every guild it is on in its cache
//     (Guilds intent), so while it is online a channel that is not in its
//     guild's cache is gone — deleted, or the guild is one the bot left. That
//     answer is synchronous, so the pure message builders can use it.
//   * checkChannel()/checkMessage() confirm with a request where the cache
//     cannot say (a guild the bot is not on, a message): Unknown Channel
//     (10003), Unknown Message (10008), Missing Access (50001) and a 404 mean
//     "missing". Their answers are remembered for five minutes.
//   * The bot offline: the last state known in this process stands — a link
//     that worked a minute ago still does, a deleted channel stays deleted.
//     Nothing known at all ("unknown") leaves the link out: a missing link
//     costs a click, a broken one costs trust.
//   * channelDeleted()/messageDeleted() (linkWatch.js, from the gateway) mark
//     at once, without waiting for the five minutes.
//
// Web links: only with PUBLIC_BASE_URL set (an http(s) address — the built-in
// localhost fallback is no link a raider can open) and only to a target that
// exists: an own event for its public page and calendar, a published raid plan
// for its read link. External links (sheet, softres) only when stored and well
// formed.
const discord = require("./discord");
const { publicBaseUrl } = require("../../utils/publicUrl");

const TTL_MS = 5 * 60 * 1000;
// Discord's codes for "not there / not for you".
const GONE_CODES = new Set([10003, 10004, 10008, 50001]);
const MAX_MESSAGES = 2000;

/** channelId → { state: "ok" | "missing", at } */
const channels = new Map();
/** messageId → { state: "ok" | "missing", at } */
const messages = new Map();

const str = (v) => (v === undefined || v === null ? "" : String(v));

/** Whether a Discord error says the target is gone (or the bot may not see it). */
function isGone(e) {
    if (!e) return false;
    if (GONE_CODES.has(Number(e.code))) return true;
    if (e.code === "channel_not_found") return true;
    if (Number(e.status) === 404 || Number(e.httpStatus) === 404) return true;
    return /unknown (channel|message)|missing access/i.test(e.message || "");
}

function remember(map, id, state, now = Date.now()) {
    map.set(id, { state, at: now });
    if (map.size > MAX_MESSAGES) map.delete(map.keys().next().value);
    return state;
}

/** The bot client while it is online, else null (a mocked discord module may lack either function). */
function onlineClient() {
    const online = typeof discord.isOnline === "function" ? discord.isOnline() : false;
    const client = online && typeof discord.getClient === "function" ? discord.getClient() : null;
    return client || null;
}

/**
 * What the client's cache says right now: "ok", "missing", or null when it
 * cannot say (bot offline, guild not cached).
 */
function liveChannelState(guildId, channelId) {
    const client = onlineClient();
    if (!client) return null;
    const cached = client.channels && client.channels.cache ? client.channels.cache.get(channelId) : null;
    if (cached) return "ok";
    const guild = guildId && client.guilds && client.guilds.cache ? client.guilds.cache.get(guildId) : null;
    if (!guild || !guild.channels || !guild.channels.cache) return null;
    return guild.channels.cache.has(channelId) ? "ok" : "missing";
}

/**
 * "ok" | "missing" | "unknown" — synchronous, for the message builders.
 * Order: a deletion seen on the gateway, the client's cache, the last known state.
 */
function channelState(guildId, channelId, now = Date.now()) {
    const id = str(channelId);
    if (!id) return "missing";
    const memo = channels.get(id);
    // A deletion seen on the gateway wins until the cache agrees (it does at once in practice).
    if (memo && memo.state === "missing" && memo.deleted) return "missing";
    const live = liveChannelState(str(guildId), id);
    if (live) return remember(channels, id, live, now);
    return memo ? memo.state : "unknown";
}

/**
 * The same, confirmed with a request where the cache cannot say (a guild the
 * bot is not on). Never throws.
 */
async function checkChannel(guildId, channelId, now = Date.now()) {
    const id = str(channelId);
    if (!id) return "missing";
    const quick = channelState(guildId, id, now);
    const memo = channels.get(id);
    if (quick !== "unknown" && (liveChannelState(str(guildId), id) || (memo && now - memo.at < TTL_MS))) return quick;
    const client = onlineClient();
    if (!client || !client.channels) return quick;
    try {
        const channel = await client.channels.fetch(id);
        return remember(channels, id, channel ? "ok" : "missing", now);
    } catch (e) {
        if (isGone(e)) return remember(channels, id, "missing", now);
        return quick;
    }
}

/** checkChannel() for several `{ guildId, channelId }` at once. */
async function checkChannels(list, now = Date.now()) {
    const seen = new Map();
    for (const item of list || []) {
        const id = str(item && item.channelId);
        if (id && !seen.has(id)) seen.set(id, str(item.guildId));
    }
    await Promise.all([...seen].map(([id, guildId]) => checkChannel(guildId, id, now)));
}

/** "ok" | "missing" | "unknown" for a message; its channel decides first. */
function messageState(guildId, channelId, messageId) {
    const channel = channelState(guildId, channelId);
    if (channel !== "ok") return channel;
    const memo = messages.get(str(messageId));
    return memo && memo.state === "missing" ? "missing" : "ok";
}

/** messageState() confirmed with a request. Never throws. */
async function checkMessage(guildId, channelId, messageId, now = Date.now()) {
    const id = str(messageId);
    if (!id) return "missing";
    const channel = await checkChannel(guildId, channelId, now);
    if (channel !== "ok") return channel;
    const memo = messages.get(id);
    if (memo && (memo.state === "missing" || now - memo.at < TTL_MS)) return memo.state;
    try {
        const ch = await discord.fetchTextChannel(channelId);
        await ch.messages.fetch(id);
        return remember(messages, id, "ok", now);
    } catch (e) {
        if (isGone(e)) return remember(messages, id, "missing", now);
        return memo ? memo.state : "ok";
    }
}

/** The gateway saw the channel go: every link to it is gone now. */
function channelDeleted(channelId, now = Date.now()) {
    const id = str(channelId);
    if (id) channels.set(id, { state: "missing", at: now, deleted: true });
}

/** A channel that exists for sure (just created). */
function channelCreated(channelId, now = Date.now()) {
    const id = str(channelId);
    if (id) channels.set(id, { state: "ok", at: now });
}

/** The gateway saw the message go. */
function messageDeleted(messageId, now = Date.now()) {
    const id = str(messageId);
    if (id) remember(messages, id, "missing", now);
}

function rawChannelUrl(guildId, channelId, messageId = "") {
    return `https://discord.com/channels/${guildId}/${channelId}${messageId ? `/${messageId}` : ""}`;
}

/** The channel's jump link, "" unless the channel is known to exist. */
function channelLink(guildId, channelId) {
    const g = str(guildId);
    const c = str(channelId);
    if (!g || !c) return "";
    return channelState(g, c) === "ok" ? rawChannelUrl(g, c) : "";
}

/** A message's jump link, "" unless channel and message are known to exist. */
function messageLink(guildId, channelId, messageId) {
    const g = str(guildId);
    const c = str(channelId);
    const m = str(messageId);
    if (!g || !c || !m) return "";
    return messageState(g, c, m) === "ok" ? rawChannelUrl(g, c, m) : "";
}

/**
 * The link to an event's signup message, else to its channel, else "" — for
 * everything that says "sign up there" (announcement, ping DM, Discord event).
 */
function eventLink(event, guildId = "") {
    const g = str(guildId || (event && event.guildId));
    const c = str(event && event.channelId);
    const m = str(event && event.message && event.message.messageId);
    const onChannel = event && event.message && event.message.channelId ? str(event.message.channelId) : c;
    return (m && onChannel === c && messageLink(g, c, m)) || channelLink(g, c);
}

/**
 * What an overview shows for an event's channel:
 * `{ state, url }` — `url` only when it works; `state` "missing" means the
 * reader sees "channel missing" instead of a link.
 */
function channelInfo(guildId, channelId) {
    const state = str(channelId) ? channelState(guildId, channelId) : "missing";
    return { state, url: state === "ok" ? channelLink(guildId, channelId) : "" };
}

/**
 * Event rows for the web lists with `channelState` beside their `channelId`
 * ("ok" | "missing" | "unknown"): the client links the Discord post only on
 * "ok" (lib/discord/discordLinks.ts) and says "Kanal fehlt" on "missing".
 */
function withChannelState(guildId, rows) {
    return (rows || []).map((row) => (row && row.channelId
        ? { ...row, channelState: channelState(row.guildId || guildId, row.channelId) }
        : row));
}

/** PUBLIC_BASE_URL when it is a real http(s) address, else "". */
function webBase() {
    const base = publicBaseUrl();
    // Without PUBLIC_BASE_URL the config falls back to http://localhost:<port> — no address a raider can open.
    if (!process.env.PUBLIC_BASE_URL && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(base)) return "";
    return /^https?:\/\/[^\s/]+/i.test(base) ? base : "";
}

/** A page of the web menu (`/raids`, `/signups?event=…`), "" without PUBLIC_BASE_URL. */
function webLink(pathname) {
    const base = webBase();
    const path = str(pathname);
    if (!base || !path) return "";
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** The lazily required stores — kept out of the top so discord.js tests need none of them. */
function ownEvent(eventId) {
    const eventStore = require("../../stores/eventStore");
    const id = str(eventId);
    return id && eventStore.isOwnEventId(id) ? eventStore.getEvent(id) : null;
}

/**
 * A web link to something that has to exist:
 *   "event"    the public event page `/e/<id>` (own events only)
 *   "comp"     `/e/<id>/comp` (own events only)
 *   "calendar" `/r/cal/<id>.ics` (own events only)
 *   "signup"   `/signups?event=<id>`
 *   "setup"    `/raids/detail?event=<id>&tab=setup`
 *   "raidplan" the read link `/p/<token>` of a published plan
 * "" when the base url is missing or the target is not there.
 */
function webTarget(kind, eventId) {
    const id = str(eventId);
    if (!id || !webBase()) return "";
    const enc = encodeURIComponent(id);
    switch (kind) {
        case "event": return ownEvent(id) ? webLink(`/e/${enc}`) : "";
        case "comp": return ownEvent(id) ? webLink(`/e/${enc}/comp`) : "";
        case "calendar": return ownEvent(id) ? webLink(`/r/cal/${enc}.ics`) : "";
        case "signup": return webLink(`/signups?event=${enc}`);
        case "setup": return webLink(`/raids/detail?event=${enc}&tab=setup`);
        case "raidplan": {
            const plan = require("../../stores/raidplanStore").getPlan(id);
            return plan && plan.status === "published" && plan.publicToken ? webLink(`/p/${plan.publicToken}`) : "";
        }
        default: return "";
    }
}

/** A stored external link (sheet, softres) when it is a well-formed http(s) address, else "". */
function externalLink(url) {
    const text = str(url).trim();
    if (!/^https?:\/\/[^\s<>()]+$/i.test(text)) return "";
    try {
        const parsed = new URL(text);
        return parsed.hostname ? text : "";
    } catch {
        return "";
    }
}

/** Forget everything (tests). */
function _reset() {
    channels.clear();
    messages.clear();
}

module.exports = {
    TTL_MS, isGone,
    channelState, checkChannel, checkChannels, messageState, checkMessage,
    channelDeleted, channelCreated, messageDeleted,
    channelLink, messageLink, eventLink, channelInfo, withChannelState,
    webBase, webLink, webTarget, externalLink,
    _reset,
};
