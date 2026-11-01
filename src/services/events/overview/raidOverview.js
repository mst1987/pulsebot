// The raid overviews of the categories (design "C", Oct 2026): the messages
// `/createoverview` posts into a category's channel, listing its upcoming raids
// by raid ID (services/events/overview/raidOverviewPanel.js builds it). Where they sit is
// remembered in stores/events/raidOverviewStore.js, so they keep themselves current:
//
//   - the sweep (startRaidOverviews): a minute after the start, then every five
//     minutes - a raid that began falls out, the Raid-Helper sync brought news;
//   - a nudge a few seconds after an own event or a signup changed
//     (eventStore.onEventsChanged, signupStore.onSignupsChanged) and after the
//     Raid-Helper sync wrote its list (raidhelperSync.js).
//
// A message is edited only when its content changed (`hash`, taken over the
// content without the footer's "last change" time, which shows the last edit).
// The raids come from loadEventGroups() - both sources, Raid-Helper through the
// central cached sync, never a request of its own. A message deleted in Discord
// ("Unknown Message") is forgotten, not posted again: the orga placed it by hand.
//
// `/createoverview scope:server` posts the overview of a whole server instead
// (store entry `scope: "server"`, currentServerContent): the raids of every raid
// category of that server in one card, each raid's second line opening with its
// category - for a public channel like "raid-overview" outside the raid categories.
// Same sweep, nudge, hash and limits; the adoption scan below never takes it for
// the overview of its channel's category (it skips every message the store knows).
//
// With `config.discordVisuals.overviewWeekStrip` (on unless switched off) each ID
// opens with its week drawn as a picture (raidWeekStrip.js): the PNG is rendered
// only when the content hash changed (it covers the SVG) and goes with the edit as
// the message's file, replacing the old one (discordImage.withImages). A picture
// that cannot be rendered leaves the message in its text form.
//
// Overviews posted before the bot remembered them (the old `/createoverview`
// text with its buttons, or the card `update-events` made of it) are found once
// per server (adoptExisting): the recent messages of every text channel
// under a category are searched for a message of the bot that came from
// `/createoverview` or still carries the "update-events" button. The scan
// pauses between channels, tolerates any failure and notes the server as done
// only when it went through every channel.
const store = require("../../../stores/events/raidOverviewStore");
const { isRaidSibling } = require("../../../utils/raidGroup");
const eventStore = require("../../../stores/events/eventStore");
const signupStore = require("../../../stores/events/signupStore");
const settingsStore = require("../../../stores/settings/settingsStore");
const { inServerOverview } = require("../../../stores/settings/configSchema");
const discord = require("../../discord/discord");
const guildRoles = require("../../discord/roles/guildRoles");
const { categoryLang, serverLang } = require("../../discord/botLanguage");
const { guildOfEvent, storedCategoryGuilds } = require("../../discord/servers/serverOf");
const { loadEventGroups } = require("../raidEventGroups");
const { visibleRows, versionOfEvent } = require("../../versions/mainVersion");
const { attendingCount } = require("../../talk/talkOverview");
const { raidOverviewPayload, shownRaids, payloadHash } = require("./raidOverviewPanel");
const { categoryNameFor } = require("../../signups/availabilityPanel");
const { visualOn, withImages } = require("../../discord/discordImage");
const logger = require("../../../logger").child("raidOverview");

const FIRST_DELAY_MS = 60 * 1000;
const SWEEP_MS = 5 * 60 * 1000;
/** A burst of changes (a setup save writes the event several times) collapses into one redraw. */
const NUDGE_MS = 5 * 1000;
/** How many recent messages of a channel the adoption scan looks through. */
const SCAN_MESSAGES = 50;
/** Pause between two channels of the adoption scan (Discord's rate limits). */
const SCAN_PAUSE_MS = 1500;
/** The command whose messages are overviews, and the button the old ones carry. */
const COMMAND_NAME = "createoverview";
const OLD_BUTTON_ID = "update-events";

const str = (v) => String(v === undefined || v === null ? "" : v).trim();
const isUnknownMessage = (e) => !!(e && (e.code === 10008 || /unknown message/i.test((e && e.message) || "")));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The groups of a server, loaded once per run: `cache` maps guild id to the load.
 * @returns {Promise<{ groups: object[], error: string|null }>}
 */
async function groupsOf(guildId, cache) {
    if (!cache.has(guildId)) {
        cache.set(guildId, loadEventGroups(guildId).catch((e) => ({ groups: [], error: (e && e.message) || "load failed" })));
    }
    return cache.get(guildId);
}

/**
 * What an overview shows now: the payload without the time (what the hash is
 * taken over), the hash and the language - or an `error` while the raids could not be loaded completely.
 * @returns {Promise<{ payload?: object, hash?: string, lang?: string, error?: string }>}
 */
async function currentContent(categoryId, guildId, { config, now = Date.now(), cache = new Map() } = {}) {
    const cfg = config || settingsStore.getConfig();
    const { groups, error } = await groupsOf(guildId, cache);
    // A Raid-Helper outage with nothing cached would list the category without its events: leave the message as it is.
    if (error) return { error };
    const cat = str(categoryId);
    const group = (groups || []).find((g) => str(g.categoryId) === cat);
    // a further raid of a raid group (#811) is no raid of its own for the raiders — its first raid stands for the evening
    const events = visibleRows(((group && group.events) || []).filter((e) => !isRaidSibling(e)), (e) => versionOfEvent(e, { config: cfg }), cfg);
    const lang = categoryLang(cat, cfg);
    const weekStrip = visualOn(cfg, "overviewWeekStrip", guildId);
    const build = (lastChange, { pictures = weekStrip } = {}) => raidOverviewPayload({
        categoryName: (group && group.categoryName) || categoryNameFor(cat, { config: cfg }) || "",
        events,
        now,
        lang,
        attending: attendingCount,
        lastChange,
        weekStrip: pictures,
    });
    const payload = build(0);
    return { payload, hash: payloadHash(payload, lang), lang, build };
}

/**
 * What the overview of a whole server shows now (`/createoverview scope:server`): the raids of every raid
 * category of this server together, by time and raid ID - a raid without a category is no raid category's and
 * stays out, so does one whose server is known to be another, and every raid of a category taken out of it
 * (`config.categoryServerOverview`, inServerOverview). Same filters as a category's overview. Its
 * language: the one all categories of the listed raids share (after the card's limits, raidOverviewPanel.shownRaids),
 * else (mixed or none) the server's.
 * @returns {Promise<{ payload?: object, hash?: string, lang?: string, error?: string }>}
 */
async function currentServerContent(guildId, { config, now = Date.now(), cache = new Map() } = {}) {
    const cfg = config || settingsStore.getConfig();
    const gid = str(guildId);
    const { groups, error } = await groupsOf(gid, cache);
    if (error) return { error };
    const categoryGuilds = storedCategoryGuilds();
    const ofThisServer = (e) => {
        const owner = guildOfEvent(e, { categoryGuilds });
        return !owner || owner === gid;
    };
    const events = [];
    const categoryOf = new Map();
    for (const group of groups || []) {
        const cat = str(group && group.categoryId);
        // a category taken out of the server overview (Einstellungen -> Kategorien) keeps only its own
        if (!cat || !inServerOverview(cfg, cat)) continue;
        const rows = visibleRows(((group.events) || []).filter((e) => !isRaidSibling(e) && ofThisServer(e)), (e) => versionOfEvent(e, { config: cfg }), cfg)
            .map((e) => ({ ...e, categoryName: e.categoryName || group.categoryName || "" }));
        for (const row of rows) categoryOf.set(row, cat);
        events.push(...rows);
    }
    events.sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0));
    // The language comes from the raids the card actually lists (after its limits), which in turn depend a
    // little on the language (text budget): start from the server's, settle on the shown raids' one.
    const fallback = serverLang(cfg, gid);
    const langOf = (lang) => {
        const langs = new Set(shownRaids({ events, now, lang, attending: attendingCount, server: true })
            .map((e) => categoryLang(categoryOf.get(e), cfg, gid)));
        return langs.size === 1 ? [...langs][0] : fallback;
    };
    let lang = langOf(fallback);
    if (lang !== fallback && langOf(lang) !== lang) lang = fallback;
    const weekStrip = visualOn(cfg, "overviewWeekStrip", gid);
    const build = (lastChange, { pictures = weekStrip } = {}) => raidOverviewPayload({
        events,
        now,
        lang,
        attending: attendingCount,
        lastChange,
        weekStrip: pictures,
        server: true,
    });
    const payload = build(0);
    return { payload, hash: payloadHash(payload, lang), lang, build };
}

/** What a remembered overview shows now: a server's (`scope: "server"`) or a category's. */
function contentOf(overview, opts) {
    return store.isServerOverview(overview)
        ? currentServerContent(overview.guildId, opts)
        : currentContent(overview.categoryId, overview.guildId, opts);
}

// Overviews whose picture could not be rendered and were said so once.
const renderWarned = new Set();

/**
 * The payload of an overview for discord.js: its pictures rendered into files (cached per
 * message), or - when that fails - the text form without pictures.
 */
function renderedPayload(content, lastChange, key) {
    const payload = content.build(lastChange);
    try {
        return withImages(payload, { key });
    } catch (e) {
        if (!renderWarned.has(key)) logger.warn(`${key}: picture not rendered, text only: ${(e && e.message) || e}`);
        renderWarned.add(key);
        return withImages(content.build(lastChange, { pictures: false }));
    }
}

/**
 * Post the overview of a category into a channel - or, when that channel already
 * holds one of this category, edit it instead of posting a second. `scope: "server"` posts the overview of
 * every raid category of the server `guildId` instead (one per channel, the channel may sit anywhere).
 * @returns {Promise<{ overview?: object, url?: string, edited?: boolean, error?: string }>}
 */
async function postOverview({ guildId, channelId, categoryId, scope = "", config, now = Date.now() } = {}) {
    const server = str(scope) === "server";
    const cat = server ? "" : str(categoryId);
    const channel = str(channelId);
    const gid = str(guildId);
    if (server && !gid) return { error: "No server." };
    if (!server && !cat) return { error: "No category." };
    if (!channel) return { error: "No channel." };
    const content = server ? await currentServerContent(gid, { config, now }) : await currentContent(cat, gid, { config, now });
    if (content.error) return { error: content.error };
    const lastChange = Math.floor(now / 1000);
    const earlier = server ? store.findServerInChannel(channel) : store.findInChannel(channel, cat);
    if (earlier) {
        try {
            const edited = await discord.editPayload(channel, earlier.messageId, renderedPayload(content, lastChange, `overview:${earlier.messageId}`), { silentMentions: true });
            const overview = store.setOverview({ ...earlier, guildId: gid || earlier.guildId, hash: content.hash, lastChange });
            return { overview, url: edited.url, edited: true };
        } catch (e) {
            if (!isUnknownMessage(e)) return { error: (e && e.message) || String(e) };
            store.removeOverview(earlier.messageId);
        }
    }
    let posted;
    try {
        posted = await discord.postPayload(channel, renderedPayload(content, lastChange, `overview:${channel}:${server ? "server" : cat}`), { silentMentions: true });
    } catch (e) {
        return { error: (e && e.message) || String(e) };
    }
    const overview = store.setOverview({
        guildId: posted.guildId || gid, channelId: posted.channelId, messageId: posted.messageId, categoryId: cat,
        ...(server ? { scope: "server" } : {}), hash: content.hash, lastChange,
    });
    return { overview, url: posted.url, edited: false };
}

/**
 * Register a message that is an overview already (an old one a button was clicked on) and draw it in the new design.
 * @returns {Promise<{ overview?: object, error?: string }>}
 */
async function adoptMessage({ guildId, channelId, messageId, categoryId, config, now = Date.now() } = {}) {
    const known = store.getOverview(messageId);
    const overview = known || store.setOverview({ guildId, channelId, messageId, categoryId, hash: "", lastChange: 0 });
    if (!overview) return { error: "Incomplete message data." };
    const result = await refreshOverviews({ config, onlyStale: false, messageId: overview.messageId, now });
    return result.failed ? { overview, error: "The overview could not be drawn." } : { overview: store.getOverview(overview.messageId) };
}

// Overviews whose redraw failed and were said so once - a channel that is gone
// would otherwise fill the log every five minutes.
const warned = new Set();

/**
 * Redraw the overviews whose content changed (`onlyStale`, the default) or all
 * of them; `messageId` limits it to one. Never throws.
 * @returns {Promise<{ edited: number, removed: number, failed: number, unchanged: number }>}
 */
async function refreshOverviews({ config, onlyStale = true, messageId = "", now = Date.now() } = {}) {
    const cfg = config || settingsStore.getConfig();
    const cache = new Map();
    const out = { edited: 0, removed: 0, failed: 0, unchanged: 0 };
    for (const overview of store.listOverviews()) {
        if (messageId && overview.messageId !== str(messageId)) continue;
        try {
            const content = await contentOf(overview, { config: cfg, now, cache });
            if (content.error) throw new Error(content.error);
            if (onlyStale && overview.hash === content.hash) {
                out.unchanged += 1;
                continue;
            }
            const lastChange = Math.floor(now / 1000);
            await discord.editPayload(overview.channelId, overview.messageId, renderedPayload(content, lastChange, `overview:${overview.messageId}`), { silentMentions: true });
            store.markDrawn(overview.messageId, content.hash, lastChange);
            out.edited += 1;
            warned.delete(overview.messageId);
        } catch (e) {
            if (isUnknownMessage(e)) {
                // deleted in Discord: forgotten, not posted again
                store.removeOverview(overview.messageId);
                out.removed += 1;
                logger.info(`overview ${overview.messageId} in ${overview.channelId} was deleted, forgotten`);
                continue;
            }
            out.failed += 1;
            if (!warned.has(overview.messageId)) logger.warn(`${overview.categoryId || "server"}/${overview.messageId}: ${(e && e.message) || e}`);
            warned.add(overview.messageId);
        }
    }
    return out;
}

/** The command that made a message: its interaction's name (older and newer discord.js shapes). */
function commandOf(message) {
    const legacy = message && message.interaction && message.interaction.commandName;
    const meta = message && message.interactionMetadata && (message.interactionMetadata.name || message.interactionMetadata.commandName);
    return str(legacy || meta).toLowerCase();
}

/** Whether a message carries the old overview's "update-events" button (its rows are API JSON or builders). */
function hasOldButton(message) {
    const walk = (nodes) => (nodes || []).some((n) => {
        const json = n && typeof n.toJSON === "function" ? n.toJSON() : n;
        return !!json && (json.custom_id === OLD_BUTTON_ID || json.customId === OLD_BUTTON_ID || walk(json.components) || walk(json.accessory ? [json.accessory] : []));
    });
    return walk(message && message.components);
}

/** Whether a message of the bot is an overview: made by `/createoverview`, or still with its "update-events" button. */
function isOverviewMessage(message, botId) {
    if (!message || !message.author || message.author.id !== botId) return false;
    return commandOf(message) === COMMAND_NAME || hasOldButton(message);
}

const TEXT_CHANNEL_TYPES = [0, 5];

/**
 * Search the text channels of the servers once for overviews the store does not know yet and register them;
 * the next sweep redraws them. Rate-limit friendly (a pause between channels) and failure tolerant (a channel it cannot read is skipped).
 * A server counts as searched only when every one of its channels was read.
 * @returns {Promise<{ adopted: number, guilds: number, failed: number }>}
 */
async function adoptExisting({ config, pauseMs = SCAN_PAUSE_MS, limit = SCAN_MESSAGES, wait = sleep } = {}) {
    const cfg = config || settingsStore.getConfig();
    const client = discord.getClient();
    const out = { adopted: 0, guilds: 0, failed: 0 };
    if (!client || !client.user || !discord.isOnline()) return out;
    for (const guildId of guildRoles.eventGuildIds(cfg)) {
        if (store.isScanned(guildId)) continue;
        const guild = discord.getGuild(guildId);
        if (!guild || !guild.channels || !guild.channels.cache) continue;
        const channels = [...guild.channels.cache.values()].filter((c) => c && TEXT_CHANNEL_TYPES.includes(c.type) && c.parentId && c.messages);
        let complete = true;
        for (const channel of channels) {
            try {
                const messages = await channel.messages.fetch({ limit });
                for (const message of messages.values()) {
                    if (!isOverviewMessage(message, client.user.id) || store.getOverview(message.id)) continue;
                    store.setOverview({ guildId, channelId: channel.id, messageId: message.id, categoryId: channel.parentId, hash: "", lastChange: 0 });
                    out.adopted += 1;
                    logger.info(`adopted the overview ${message.id} in #${channel.name || channel.id} (category ${channel.parentId})`);
                }
            } catch (e) {
                complete = false;
                out.failed += 1;
                logger.warn(`search of #${channel.name || channel.id} failed: ${(e && e.message) || e}`);
            }
            await wait(pauseMs);
        }
        if (complete) {
            store.markScanned(guildId);
            out.guilds += 1;
        }
    }
    return out;
}

// One redraw at a time: a nudge during a sweep waits for the next round instead of editing the same message twice.
let running = null;
let again = false;

function sweep() {
    if (running) {
        again = true;
        return running;
    }
    running = (async () => {
        const found = await adoptExisting();
        if (found.adopted) logger.info(`${found.adopted} old overview(s) adopted`);
        const r = await refreshOverviews();
        if (r.edited || r.removed) logger.debug(`${r.edited} redrawn, ${r.removed} forgotten, ${r.unchanged} current`);
    })()
        .catch((e) => logger.warn(`refresh: ${(e && e.message) || e}`))
        .finally(() => {
            running = null;
            if (again) {
                again = false;
                scheduleRefresh();
            }
        });
    return running;
}

let nudgeTimer = null;

/** Redraw after a short pause; a burst of changes collapses into one run. Nothing while no overview is remembered. */
function scheduleRefresh({ delayMs = NUDGE_MS } = {}) {
    if (!store.listOverviews().length) return null;
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => {
        nudgeTimer = null;
        sweep();
    }, delayMs);
    if (nudgeTimer.unref) nudgeTimer.unref();
    return nudgeTimer;
}

/**
 * A message was deleted in Discord (services/discord/linkWatch.js): an overview of a category is
 * forgotten at once, not posted again. Returns whether it was one.
 */
function onOverviewMessageDeleted(messageId) {
    const gone = store.removeOverview(messageId);
    if (gone) logger.info(`overview ${gone.messageId} in ${gone.channelId} was deleted, forgotten`);
    return !!gone;
}

let stopFn = null;

/**
 * Keep the overviews current: the sweep `firstDelayMs` after the start (the bot
 * is logged in by then) and every `intervalMs`, plus a nudge on every change of
 * an own event or a signup. Idempotent; the timers never keep the process alive.
 */
function startRaidOverviews({ firstDelayMs = FIRST_DELAY_MS, intervalMs = SWEEP_MS, nudgeMs = NUDGE_MS } = {}) {
    if (stopFn) return stopFn;
    const nudge = () => scheduleRefresh({ delayMs: nudgeMs });
    const offEvents = eventStore.onEventsChanged(nudge);
    const offSignups = signupStore.onSignupsChanged(nudge);
    let interval = null;
    const first = setTimeout(() => {
        sweep();
        interval = setInterval(sweep, intervalMs);
        if (interval.unref) interval.unref();
    }, firstDelayMs);
    if (first.unref) first.unref();
    stopFn = () => {
        offEvents();
        offSignups();
        clearTimeout(first);
        if (interval) clearInterval(interval);
        clearTimeout(nudgeTimer);
        nudgeTimer = null;
        stopFn = null;
    };
    return stopFn;
}

/** Stop what startRaidOverviews() set up (idempotent). */
function stopRaidOverviews() {
    if (stopFn) stopFn();
}

module.exports = {
    currentContent, currentServerContent, postOverview, adoptMessage, refreshOverviews, adoptExisting, isOverviewMessage, scheduleRefresh, sweep, onOverviewMessageDeleted,
    startRaidOverviews, stopRaidOverviews,
    COMMAND_NAME, OLD_BUTTON_ID,
};
