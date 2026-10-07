// The raider organizer of a raid category (utils/signup/organizerPanel.js builds
// it; it grew out of the panel of absences and attendances): one per raid
// category, posted by the orga into a channel of its choice. Its buttons open
// the entries for that category's raids, the reader's next raid and their
// newest evaluation; its link buttons are the category's links. Posting again —
// into the same or another channel — replaces the category's earlier panel, so
// there is never a second one with stale buttons. The panel speaks the server
// language (services/discord/botLanguage.js); refreshPanels() redraws every
// posted one in place when it changes.
//
// Each panel remembers a fingerprint of what it shows (`hash`). The panel shows
// live things — the next raid and how many signed up — and a deploy may change
// its text, so startPanelRefresh() redraws, a minute after the start and then
// every five minutes, each panel whose fingerprint no longer matches (#586 left
// the panels posted before it in English until somebody changed the
// language). "in 3 days" needs no redraw: Discord counts a <t:…:R> down itself.
const crypto = require("crypto");
const store = require("../../stores/availabilityStore");
const discord = require("../discord/discord");
const { eventGuildIds } = require("../discord/guildRoles");
const settingsStore = require("../../stores/settingsStore");
const { categoryLang } = require("../discord/botLanguage");
const { organizerPayload } = require("../../utils/signup/organizerPanel");
const { guildBankChannelId } = require("../../utils/signup/guildBankPost");
const { nextRaidSummary } = require("./organizer");
const { appEmojiMap } = require("../discord/appEmojis");
const logger = require("../../logger");

const FIRST_DELAY_MS = 60 * 1000;
const SWEEP_MS = 5 * 60 * 1000;

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** The Discord name of a raid category (on any event server), "" when unknown. */
function categoryNameFor(categoryId, { config } = {}) {
    const cfg = config || settingsStore.getConfig();
    for (const guildId of eventGuildIds(cfg)) {
        try {
            const hit = (discord.listCategories(guildId) || []).find((c) => c.id === str(categoryId));
            if (hit) return hit.name;
        } catch {
            // the bot is offline or not on that server: try the next one
        }
    }
    return "";
}

/** The fingerprint of a panel payload: embeds and components as Discord gets them. */
function payloadHash(payload) {
    return crypto.createHash("sha1").update(JSON.stringify({ embeds: payload.embeds, components: payload.components })).digest("hex").slice(0, 16);
}

/** The payload of a category's panel as it should look now. */
function currentPayload(categoryId, cfg, { now = Date.now() } = {}) {
    return organizerPayload({
        categoryId,
        categoryName: categoryNameFor(categoryId, { config: cfg }),
        lang: categoryLang(categoryId, cfg),
        nextRaid: nextRaidSummary(categoryId, { now }),
        links: store.getLinks(categoryId),
        emojis: appEmojiMap(),
        // the guild bank area shows while its orga channel is set (services/signups/guildBank.js)
        guildBank: !!guildBankChannelId(cfg),
    });
}

/**
 * Post the panel of a category into a channel and drop its earlier one.
 * @returns {Promise<{ panel?: object, url?: string, error?: string }>}
 */
async function postPanel({ categoryId, channelId, by = "", config } = {}) {
    const cat = str(categoryId);
    const channel = str(channelId);
    if (!cat) return { error: "Keine Kategorie gewählt." };
    if (!channel) return { error: "Kein Kanal gewählt." };
    const payload = currentPayload(cat, config || settingsStore.getConfig());
    let posted;
    try {
        posted = await discord.postPayload(channel, payload);
    } catch (e) {
        return { error: `Das Panel konnte nicht gepostet werden: ${(e && e.message) || e}` };
    }
    const earlier = store.getPanel(cat);
    if (earlier && earlier.messageId !== posted.messageId) await discord.deleteMessage(earlier.channelId, earlier.messageId);
    const panel = store.setPanel({ categoryId: cat, guildId: posted.guildId, channelId: posted.channelId, messageId: posted.messageId, postedBy: by, hash: payloadHash(payload) });
    return { panel, url: posted.url };
}

/** Take a category's panel down (the message too, best-effort). Returns the removed panel or null. */
async function removePanel(categoryId) {
    const panel = store.removePanel(categoryId);
    if (panel) await discord.deleteMessage(panel.channelId, panel.messageId);
    return panel;
}

// Panels whose edit failed and were said so once — a deleted message would
// otherwise fill the log every five minutes.
const warned = new Set();

/**
 * Redraw the posted panels in place: all of them (the server language
 * changed), or with `onlyStale` only those whose fingerprint differs from
 * what they should show now. `categoryId` limits it to that category's panel
 * (its links changed). A panel whose message is gone or cannot be edited is
 * logged once and left; never throws.
 * @returns {Promise<{ edited: number, failed: number, unchanged: number }>}
 */
async function refreshPanels({ config, onlyStale = false, categoryId = "", now = Date.now() } = {}) {
    const cfg = config || settingsStore.getConfig();
    const out = { edited: 0, failed: 0, unchanged: 0 };
    for (const panel of store.listPanels()) {
        if (categoryId && panel.categoryId !== str(categoryId)) continue;
        try {
            const payload = currentPayload(panel.categoryId, cfg, { now });
            const hash = payloadHash(payload);
            if (onlyStale && panel.hash === hash) {
                out.unchanged += 1;
                continue;
            }
            await discord.editPayload(panel.channelId, panel.messageId, payload);
            store.markPanelDrawn(panel.categoryId, hash);
            warned.delete(panel.categoryId);
            out.edited += 1;
        } catch (e) {
            out.failed += 1;
            if (!warned.has(panel.categoryId)) logger.warn(`[availability] panel ${panel.categoryId}: ${(e && e.message) || e}`);
            warned.add(panel.categoryId);
        }
    }
    return out;
}

let firstTimer = null;
let sweepTimer = null;

function sweep() {
    return refreshPanels({ onlyStale: true })
        .then((r) => {
            if (r.edited) logger.debug(`[availability] Panels: ${r.edited} neu gezeichnet, ${r.unchanged} aktuell`);
        })
        .catch((e) => logger.warn(`[availability] panel refresh: ${(e && e.message) || e}`));
}

/**
 * Redraw every panel whose content changed: `firstDelayMs` after the start
 * (the bot is logged in by then), then every `intervalMs`. Idempotent; the
 * timers never keep the process alive.
 */
function startPanelRefresh({ firstDelayMs = FIRST_DELAY_MS, intervalMs = SWEEP_MS } = {}) {
    if (firstTimer || sweepTimer) return firstTimer;
    firstTimer = setTimeout(() => {
        firstTimer = null;
        sweep();
        sweepTimer = setInterval(sweep, intervalMs);
        if (sweepTimer.unref) sweepTimer.unref();
    }, firstDelayMs);
    if (firstTimer.unref) firstTimer.unref();
    return firstTimer;
}

/** Stop the redraws (idempotent). */
function stopPanelRefresh() {
    if (firstTimer) clearTimeout(firstTimer);
    if (sweepTimer) clearInterval(sweepTimer);
    firstTimer = null;
    sweepTimer = null;
}

module.exports = { postPanel, removePanel, refreshPanels, startPanelRefresh, stopPanelRefresh, categoryNameFor, payloadHash };
