// The panel message of absences and attendances (utils/signup/availabilityDialog.js
// builds it): one per raid category, posted by the orga into a channel of its
// choice. Its buttons open the entries for that category's raids only. Posting
// again — into the same or another channel — replaces the category's earlier
// panel, so there is never a second one with stale buttons.
const store = require("../../stores/availabilityStore");
const discord = require("../discord/discord");
const { eventGuildIds } = require("../discord/guildRoles");
const settingsStore = require("../../stores/settingsStore");
const { panelPayload } = require("../../utils/signup/availabilityDialog");

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

/**
 * Post the panel of a category into a channel and drop its earlier one.
 * @returns {Promise<{ panel?: object, url?: string, error?: string }>}
 */
async function postPanel({ categoryId, channelId, by = "", config } = {}) {
    const cat = str(categoryId);
    const channel = str(channelId);
    if (!cat) return { error: "Keine Kategorie gewählt." };
    if (!channel) return { error: "Kein Kanal gewählt." };
    const categoryName = categoryNameFor(cat, { config });
    let posted;
    try {
        posted = await discord.postPayload(channel, panelPayload({ categoryId: cat, categoryName }));
    } catch (e) {
        return { error: `Das Panel konnte nicht gepostet werden: ${(e && e.message) || e}` };
    }
    const earlier = store.getPanel(cat);
    if (earlier && earlier.messageId !== posted.messageId) await discord.deleteMessage(earlier.channelId, earlier.messageId);
    const panel = store.setPanel({ categoryId: cat, guildId: posted.guildId, channelId: posted.channelId, messageId: posted.messageId, postedBy: by });
    return { panel, url: posted.url };
}

/** Take a category's panel down (the message too, best-effort). Returns the removed panel or null. */
async function removePanel(categoryId) {
    const panel = store.removePanel(categoryId);
    if (panel) await discord.deleteMessage(panel.channelId, panel.messageId);
    return panel;
}

module.exports = { postPanel, removePanel, categoryNameFor };
