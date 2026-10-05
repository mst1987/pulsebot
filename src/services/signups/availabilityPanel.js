// The panel message of absences and attendances (utils/signup/availabilityDialog.js
// builds it): one per raid category, posted by the orga into a channel of its
// choice. Its buttons open the entries for that category's raids only. Posting
// again — into the same or another channel — replaces the category's earlier
// panel, so there is never a second one with stale buttons. The panel speaks the
// server language (services/discord/botLanguage.js); refreshPanels() redraws
// every posted one in place when it changes.
//
// Each panel remembers a fingerprint of what it shows (`hash`). A deploy that
// changes the panel's text or buttons — a new translation, say — leaves the
// posted messages as they were; startPanelRefresh() redraws, once after the
// start, every panel whose fingerprint no longer matches (#586 left the
// panels posted before it in English until somebody changed the language).
const crypto = require("crypto");
const store = require("../../stores/availabilityStore");
const discord = require("../discord/discord");
const { eventGuildIds } = require("../discord/guildRoles");
const settingsStore = require("../../stores/settingsStore");
const { serverLang } = require("../discord/botLanguage");
const { panelPayload } = require("../../utils/signup/availabilityDialog");
const logger = require("../../logger");

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

/** The fingerprint of a panel payload: embeds and buttons as Discord gets them. */
function payloadHash(payload) {
    return crypto.createHash("sha1").update(JSON.stringify({ embeds: payload.embeds, components: payload.components })).digest("hex").slice(0, 16);
}

/** The payload of a category's panel as it should look now. */
function currentPayload(categoryId, cfg) {
    return panelPayload({ categoryId, categoryName: categoryNameFor(categoryId, { config: cfg }), lang: serverLang(cfg) });
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

/**
 * Redraw the posted panels in place: all of them (the server language
 * changed), or with `onlyStale` only those whose fingerprint differs from
 * what they should show now (after a deploy). A panel whose message is gone
 * or cannot be edited is logged and left; never throws.
 * @returns {Promise<{ edited: number, failed: number, unchanged: number }>}
 */
async function refreshPanels({ config, onlyStale = false } = {}) {
    const cfg = config || settingsStore.getConfig();
    const out = { edited: 0, failed: 0, unchanged: 0 };
    for (const panel of store.listPanels()) {
        try {
            const payload = currentPayload(panel.categoryId, cfg);
            const hash = payloadHash(payload);
            if (onlyStale && panel.hash === hash) {
                out.unchanged += 1;
                continue;
            }
            await discord.editPayload(panel.channelId, panel.messageId, payload);
            store.markPanelDrawn(panel.categoryId, hash);
            out.edited += 1;
        } catch (e) {
            out.failed += 1;
            logger.warn(`[availability] panel ${panel.categoryId}: ${(e && e.message) || e}`);
        }
    }
    return out;
}

let timer = null;

/**
 * Once, `firstDelayMs` after the start (the bot is logged in by then), redraw
 * every panel whose content changed since it was drawn. Idempotent; the timer
 * never keeps the process alive.
 */
function startPanelRefresh({ firstDelayMs = 60 * 1000 } = {}) {
    if (timer) return timer;
    timer = setTimeout(() => {
        refreshPanels({ onlyStale: true })
            .then((r) => {
                if (r.edited || r.failed) logger.info(`[availability] Panels nach dem Start: ${r.edited} neu gezeichnet, ${r.failed} fehlgeschlagen, ${r.unchanged} aktuell`);
            })
            .catch((e) => logger.warn(`[availability] panel refresh: ${(e && e.message) || e}`));
    }, firstDelayMs);
    if (timer.unref) timer.unref();
    return timer;
}

/** Cancel a pending start-up refresh (idempotent). */
function stopPanelRefresh() {
    if (timer) clearTimeout(timer);
    timer = null;
}

module.exports = { postPanel, removePanel, refreshPanels, startPanelRefresh, stopPanelRefresh, categoryNameFor, payloadHash };
