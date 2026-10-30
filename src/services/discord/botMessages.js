// The fixed messages the bot keeps on one server of the list (#895), for the
// Discord overview of the web admin (docs/discord-servers.md "Discord-Übersicht"):
// Orga-Zentralen, Raid-Zentralen, raid overviews, role messages, the addon
// centre, recruitment posts. Each one says whether it still stands.
//
// The status comes from the client cache (channel, the bot's rights in it, the
// message cache) and one message fetch where the cache cannot say — not from
// linkCheck's memo, which cannot tell "no access" from "deleted" (statusOf).
// A status is kept CACHE_MS per message, so the page can be opened as often as
// anyone likes without asking Discord again; "unknown" is never kept.
const { PermissionsBitField } = require("discord.js");
const discord = require("./discord");
const linkCheck = require("./linkCheck");
const { listKnownCategories } = require("../categories/categoryNames");
const orgaHubStore = require("../../stores/orgaHubStore");
const raidOverviewStore = require("../../stores/raidOverviewStore");
const talkOverviewStore = require("../../stores/talkOverviewStore");
const roleMessageStore = require("../../stores/roleMessageStore");
const addonCenterStore = require("../../stores/addonCenterStore");
const { roleMessageGuild } = require("./roles/guildRoles");
const recruitmentStore = require("../../stores/recruitmentStore");
const availabilityStore = require("../../stores/availabilityStore");

const CACHE_MS = 10 * 60 * 1000;
const PARALLEL = 4;
// The whole check of one page view; like NAME_FETCH_MS, a page never waits longer.
const CHECK_MS = 5000;

const KIND_LABELS = {
    orgaHub: "Orga-Zentrale",
    availability: "Raid-Zentrale",
    raidOverview: "Raid-Übersicht",
    talkOverview: "Raid-Übersicht (Talk)",
    roleMessage: "Rollen-Nachricht",
    addonCenter: "Addon-Zentrale",
    recruitment: "Rekrutierung",
};

/** "guildId:channelId:messageId" → { at, status } */
const cache = new Map();

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

function entry(kind, raw, extra = {}) {
    return {
        kind,
        kindLabel: KIND_LABELS[kind],
        title: str(extra.title),
        categoryId: str(raw.categoryId),
        guildId: str(extra.guildId || raw.guildId),
        channelId: str(raw.channelId),
        messageId: str(raw.messageId),
        // a raid overview of every raid category of the server (`/createoverview scope:server`), shown as "All categories"
        ...(raw.scope === "server" ? { scope: "server" } : {}),
        // a forum post (recruitment): channelId is its thread, this its forum
        ...(str(raw.parentChannelId) ? { parentChannelId: str(raw.parentChannelId) } : {}),
    };
}

/** Every fixed message the stores know on this server (unchecked). */
function collect(guildId, config) {
    const gid = str(guildId);
    if (!gid) return [];
    const onGuild = (x) => x && str(x.guildId) === gid && str(x.messageId);
    const out = [];
    for (const h of orgaHubStore.listHubs().filter(onGuild)) out.push(entry("orgaHub", h));
    for (const p of availabilityStore.listPanels().filter(onGuild)) out.push(entry("availability", p));
    for (const o of raidOverviewStore.listOverviews().filter(onGuild)) out.push(entry("raidOverview", o));
    const servers = (config && config.discordServers) || {};
    // One raid list per link (#892, store keyed `from:to`): every link posted on this server.
    const labels = new Map((servers.servers || []).map((s) => [str(s && s.guildId), str(s && s.label)]));
    for (const { link: l, key, legacyKey } of talkOverviewStore.overviewKeys(servers.links || [])) {
        if (str(l.to) !== gid) continue;
        const state = talkOverviewStore.getOverviewState(key, { legacyKey });
        if (state.messageId) out.push(entry("talkOverview", state, { guildId: gid, title: labels.get(str(l.from)) || "" }));
    }
    for (const m of roleMessageStore.listMessages()) {
        if (roleMessageGuild(m, config || undefined) === gid && str(m.messageId)) out.push(entry("roleMessage", m, { guildId: gid, title: m.title }));
    }
    const center = addonCenterStore.getCenter();
    if (onGuild(center)) out.push(entry("addonCenter", center));
    for (const r of recruitmentStore.listRecruitmentPosts().filter(onGuild)) out.push(entry("recruitment", r, { title: r.title || r.channelName }));
    return out;
}

/** What a failed message fetch means: deleted, channel gone, no access, or "unknown" (timeout, 5xx …). */
function statusOfError(e) {
    const code = Number(e && e.code);
    const status = Number(e && (e.status || e.httpStatus));
    if (code === 10003) return "channel_missing";
    if (code === 10008 || status === 404) return "deleted";
    if (code === 50001 || code === 50013 || status === 403) return "no_access";
    return "unknown";
}

/**
 * "ok" | "deleted" | "channel_missing" | "no_access" | "unknown" of one message.
 *
 * Checked here and not through linkCheck.checkMessage: that one counts a
 * missing access (50001) as "missing" and remembers a missing message for good,
 * so a channel the bot merely cannot read would show "deleted" forever. The
 * channel and the bot's rights come from the cache; the message from the
 * message cache or one fetch. A standing message is reported to linkCheck so
 * its link works again everywhere.
 */
/**
 * The thread of a forum post that is not in the cache (Discord archives quiet posts and the cache drops them): the forum
 * decides. Forum gone = "channel_missing"; forum there = the thread fetched once; anything else `{ status: "unknown" }`.
 */
async function forumThreadOf(m, guild) {
    const forum = guild && guild.channels && guild.channels.cache ? guild.channels.cache.get(m.parentChannelId) : null;
    if (!forum) return { status: linkCheck.channelState(m.guildId, m.parentChannelId) === "missing" ? "channel_missing" : "unknown" };
    const client = discord.getClient();
    if (!client || !client.channels || typeof client.channels.fetch !== "function") return { status: "unknown" };
    try {
        const thread = await client.channels.fetch(m.channelId);
        return thread ? { thread } : { status: "channel_missing" };
    } catch (e) {
        return { status: statusOfError(e) };
    }
}

async function statusOf(m, online) {
    if (!online) return "unknown";
    const guild = discord.getGuild(m.guildId);
    let channel = guild && guild.channels && guild.channels.cache ? guild.channels.cache.get(m.channelId) : null;
    if (!channel && m.parentChannelId) {
        const found = await forumThreadOf(m, guild);
        if (!found.thread) return found.status;
        channel = found.thread;
    }
    if (!channel) return linkCheck.channelState(m.guildId, m.channelId) === "missing" ? "channel_missing" : "unknown";
    const me = guild.members ? guild.members.me : null;
    if (!me || typeof channel.permissionsFor !== "function") return "unknown";
    const perms = channel.permissionsFor(me);
    const F = PermissionsBitField.Flags;
    if (!perms || !perms.has(F.ViewChannel) || !perms.has(F.ReadMessageHistory)) return "no_access";
    if (!channel.messages || typeof channel.messages.fetch !== "function") return "unknown";
    const cached = channel.messages.cache ? channel.messages.cache.get(m.messageId) : null;
    try {
        if (!cached) await channel.messages.fetch(m.messageId);
    } catch (e) {
        return statusOfError(e);
    }
    linkCheck.messageFound(m.messageId);
    return "ok";
}

/** The channel name from the client cache, "" when unknown. */
function channelName(channelId) {
    const client = discord.getClient();
    const channel = client && client.channels && client.channels.cache ? client.channels.cache.get(channelId) : null;
    return channel ? str(channel.name) : "";
}

/** Check every message, PARALLEL at a time, into `states` (index by index). */
async function checkAll(list, online, states) {
    let next = 0;
    const worker = async () => {
        while (next < list.length) {
            const i = next;
            next += 1;
            states[i] = await statusOf(list[i], online).catch(() => "unknown");
        }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, list.length) }, worker));
}

/** Resolves after `ms`; the timer does not keep the process alive. */
function after(ms) {
    return new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        if (t && typeof t.unref === "function") t.unref();
    });
}

/**
 * The fixed messages of one server, each
 * `{ kind, kindLabel, title, categoryId, categoryName, channelId, channelName, messageId, link, status }`
 * (+ `scope: "server"` for a raid overview of the whole server).
 *
 * A status is kept CACHE_MS per message; "unknown" (bot offline, time limit,
 * Discord error) is never kept. `fresh` checks every message again. The whole
 * check stops after `checkMs` — what has not answered by then reads "unknown".
 * Never throws.
 */
async function botMessages(guildId, config, { now = Date.now(), fresh = false, checkMs = CHECK_MS } = {}) {
    const gid = str(guildId);
    const list = collect(gid, config);
    const online = discord.isOnline();
    const keyOf = (m) => `${m.guildId}:${m.channelId}:${m.messageId}`;
    const states = list.map(() => "unknown");
    const todo = [];
    list.forEach((m, i) => {
        const hit = cache.get(keyOf(m));
        if (!fresh && online && hit && now - hit.at < CACHE_MS) states[i] = hit.status;
        else todo.push(i);
    });
    const results = todo.map(() => "unknown");
    if (todo.length) await Promise.race([checkAll(todo.map((i) => list[i]), online, results), after(checkMs)]);
    // A snapshot: checks still running past the time limit change nothing any more.
    todo.forEach((i, j) => {
        states[i] = results[j];
        if (results[j] === "unknown") cache.delete(keyOf(list[i]));
        else cache.set(keyOf(list[i]), { at: now, status: results[j] });
    });

    const categories = new Map(listKnownCategories(gid).map((c) => [c.id, c.name]));
    return list.map((m, i) => ({
        ...m,
        categoryName: categories.get(m.categoryId) || "",
        channelName: channelName(m.channelId),
        link: states[i] === "ok" ? linkCheck.messageLink(m.guildId, m.channelId, m.messageId) : "",
        status: states[i],
    }));
}

/** Tests: forget every cached result. */
function clearCache() {
    cache.clear();
}

module.exports = { botMessages, collect, clearCache, statusOfError, CACHE_MS, CHECK_MS, KIND_LABELS };
