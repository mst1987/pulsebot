// The fixed messages the bot keeps on one server (event or talk side), for the
// Discord overview of the web admin (docs/discord-servers.md "Discord-Übersicht"):
// Orga-Zentralen, Raid-Zentralen, raid overviews, role messages, the addon
// centre, recruitment posts. Each one says whether it still stands.
//
// The status comes from linkCheck (its memo, the client cache, a request only
// where neither can say). The result of one server is kept CACHE_MS, so the
// page can be opened as often as anyone likes without asking Discord again;
// a result read while the bot is offline is not kept.
const discord = require("./discord");
const linkCheck = require("./linkCheck");
const { listKnownCategories } = require("./categoryNames");
const orgaHubStore = require("../../stores/orgaHubStore");
const raidOverviewStore = require("../../stores/raidOverviewStore");
const talkOverviewStore = require("../../stores/talkOverviewStore");
const roleMessageStore = require("../../stores/roleMessageStore");
const addonCenterStore = require("../../stores/addonCenterStore");
const recruitmentStore = require("../../stores/recruitmentStore");
const availabilityStore = require("../../stores/availabilityStore");

const CACHE_MS = 10 * 60 * 1000;
const PARALLEL = 4;

const KIND_LABELS = {
    orgaHub: "Orga-Zentrale",
    availability: "Raid-Zentrale",
    raidOverview: "Raid-Übersicht",
    talkOverview: "Raid-Übersicht (Talk)",
    roleMessage: "Rollen-Nachricht",
    addonCenter: "Addon-Zentrale",
    recruitment: "Rekrutierung",
};

/** guildId → { at, key, list } */
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
    };
}

/** Every fixed message the stores know on this server (unchecked). */
function collect(side, guildId, config) {
    const gid = str(guildId);
    if (!gid) return [];
    const onGuild = (x) => x && str(x.guildId) === gid && str(x.messageId);
    const out = [];
    for (const h of orgaHubStore.listHubs().filter(onGuild)) out.push(entry("orgaHub", h));
    for (const p of availabilityStore.listPanels().filter(onGuild)) out.push(entry("availability", p));
    for (const o of raidOverviewStore.listOverviews().filter(onGuild)) out.push(entry("raidOverview", o));
    const servers = (config && config.discordServers) || {};
    for (const g of servers.eventGuilds || []) {
        if (!g || str(g.overviewGuildId) !== gid || !g.guildId) continue;
        const state = talkOverviewStore.getOverviewState(g.guildId);
        if (state.messageId) out.push(entry("talkOverview", state, { guildId: gid, title: g.label }));
    }
    for (const m of roleMessageStore.listMessages()) {
        if (m.guildSide === side && str(m.messageId)) out.push(entry("roleMessage", m, { guildId: gid, title: m.title }));
    }
    const center = addonCenterStore.getCenter();
    if (onGuild(center)) out.push(entry("addonCenter", center));
    for (const r of recruitmentStore.listRecruitmentPosts().filter(onGuild)) out.push(entry("recruitment", r, { title: r.title || r.channelName }));
    return out;
}

/** "ok" | "deleted" | "channel_missing" | "unknown" of one message. */
async function statusOf(m, online) {
    if (!online) return "unknown";
    const state = await linkCheck.checkMessage(m.guildId, m.channelId, m.messageId);
    if (state === "ok") return "ok";
    if (state !== "missing") return "unknown";
    return linkCheck.channelState(m.guildId, m.channelId) === "missing" ? "channel_missing" : "deleted";
}

/** The channel name from the client cache, "" when unknown. */
function channelName(channelId) {
    const client = discord.getClient();
    const channel = client && client.channels && client.channels.cache ? client.channels.cache.get(channelId) : null;
    return channel ? str(channel.name) : "";
}

/**
 * The fixed messages of one server, each
 * `{ kind, kindLabel, title, categoryId, categoryName, channelId, channelName, messageId, link, status }`.
 * Never throws; with the bot offline every status reads "unknown".
 */
async function botMessages(side, guildId, config, { now = Date.now(), fresh = false } = {}) {
    const gid = str(guildId);
    const list = collect(side, gid, config);
    const key = list.map((m) => `${m.kind}:${m.channelId}:${m.messageId}`).join("|");
    const hit = cache.get(`${side}:${gid}`);
    if (!fresh && hit && hit.key === key && now - hit.at < CACHE_MS) return hit.list.map((m) => ({ ...m }));

    const online = discord.isOnline();
    const categories = new Map(listKnownCategories(gid).map((c) => [c.id, c.name]));
    const out = [];
    for (let i = 0; i < list.length; i += PARALLEL) {
        const chunk = list.slice(i, i + PARALLEL);
        const states = await Promise.all(chunk.map((m) => statusOf(m, online).catch(() => "unknown")));
        chunk.forEach((m, j) => out.push({
            ...m,
            categoryName: categories.get(m.categoryId) || "",
            channelName: channelName(m.channelId),
            link: states[j] === "ok" ? linkCheck.messageLink(m.guildId, m.channelId, m.messageId) : "",
            status: states[j],
        }));
    }
    if (online) cache.set(`${side}:${gid}`, { at: now, key, list: out });
    return out.map((m) => ({ ...m }));
}

/** Tests: forget every cached result. */
function clearCache() {
    cache.clear();
}

module.exports = { botMessages, collect, clearCache, CACHE_MS, KIND_LABELS };
