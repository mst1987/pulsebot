// Guild bank requests (the "Gildenbank" area of the raider organizer, docs/
// signups.md): a raider asks for mats, potions or enchants through a modal, the
// bot posts the request into one orga channel for every category
// (Einstellungen → Verbindungen → Discord-Server, `discordServers.guildBankChannelId`),
// and the orga marks it done or declines it there — the raider gets a DM in
// their own language either way. No channel set = no guild bank button.
//
// Stored in stores/guildBankStore.js, built by utils/signup/guildBankPost.js;
// commands/signup/availability.js takes the raider's modal,
// commands/signup/guildBank.js the orga's buttons. Errors are German (the
// commands translate them for the raider with serviceText); a Discord failure
// is logged and returned, never thrown.
const store = require("../../stores/guildBankStore");
const settingsStore = require("../../stores/settingsStore");
const discord = require("../discord/discord");
const { langOf } = require("../discord/botLanguage");
const { categoryNameFor } = require("./availabilityPanel");
const post = require("../../utils/signup/guildBankPost");
const logger = require("../../logger");

const NOT_SET_UP = "Die Gildenbank ist gerade nicht eingerichtet.";

/** The orga channel of the guild bank, "" when none is set (then there is no guild bank). */
function guildBankChannelId(config = settingsStore.getConfig()) {
    return post.guildBankChannelId(config);
}

/** The orga post of a request as it should look now. */
function postFor(request, { config } = {}) {
    let categoryName = "";
    try {
        categoryName = request.categoryId ? categoryNameFor(request.categoryId, { config }) : "";
    } catch {
        // no names while the bot is offline
    }
    return post.orgaPayload(request, { categoryName });
}

/**
 * A raider's request: check it, store it, post it into the orga channel.
 * A post that does not reach the channel is taken back (nobody would see it).
 * @param {string} userId
 * @param {{ item: string, amount: string|number, purpose?: string }} input as typed in the modal
 * @param {{ userName?: string, categoryId?: string, config?: object, now?: number }} [o]
 * @returns {Promise<{ request: object } | { error: string }>}
 */
async function createRequest(userId, input = {}, { userName = "", categoryId = "", config, now = Date.now() } = {}) {
    const cfg = config || settingsStore.getConfig();
    const channelId = guildBankChannelId(cfg);
    if (!channelId) return { error: NOT_SET_UP };
    store.prune({ now });
    const added = store.addRequest({ ...input, userId, userName, categoryId }, { now });
    if (added.error) return added;
    try {
        const posted = await discord.postPayload(channelId, postFor(added.request, { config: cfg }));
        return { request: store.setMessage(added.request.id, posted) || added.request };
    } catch (e) {
        store.removeRequest(added.request.id);
        logger.warn(`[guildBank] Anfrage ${added.request.id} nicht in ${channelId} gepostet: ${(e && e.message) || e}`);
        return { error: "Die Anfrage konnte nicht gepostet werden – versuch es später noch einmal." };
    }
}

/** Draw a request's orga post as it should look now (best-effort). Returns whether it was edited. */
async function redrawPost(request, { config } = {}) {
    if (!request || !request.channelId || !request.messageId) return false;
    try {
        await discord.editPayload(request.channelId, request.messageId, postFor(request, { config }));
        return true;
    } catch (e) {
        logger.warn(`[guildBank] Post der Anfrage ${request.id} nicht aktualisiert: ${(e && e.message) || e}`);
        return false;
    }
}

/** Tell the raider in their language. `{ ok }` or `{ ok: false, error }`, never throws. */
async function notifyRaider(request, { config } = {}) {
    try {
        const lang = langOf(request.userId, { config });
        const sent = await discord.sendDirectMessage(request.userId, post.decisionCard(request, lang));
        if (!sent.ok) logger.warn(`[guildBank] DM an ${request.userId} nicht zugestellt: ${sent.error}`);
        return sent;
    } catch (e) {
        logger.warn(`[guildBank] DM an ${request.userId} nicht zugestellt: ${(e && e.message) || e}`);
        return { ok: false, error: (e && e.message) || String(e) };
    }
}

/**
 * The orga handles an open request: done, or declined with an optional
 * reason. Edits the orga post (status line, no buttons) and DMs the raider.
 * An already handled request is refused — its post is drawn again, so stale
 * buttons disappear.
 * @param {string} id
 * @param {{ by: string, byName: string, status: "done"|"rejected", reason?: string }} decision
 * @returns {Promise<{ request: object, posted: boolean, dm: boolean } | { error: string, request?: object }>}
 */
async function resolveRequest(id, { by = "", byName = "", status, reason = "" } = {}, { config, now = Date.now() } = {}) {
    const cfg = config || settingsStore.getConfig();
    const result = store.resolveRequest(id, { status, by, byName, reason }, { now });
    if (result.error) {
        if (result.request) await redrawPost(result.request, { config: cfg });
        return result;
    }
    const posted = await redrawPost(result.request, { config: cfg });
    const sent = await notifyRaider(result.request, { config: cfg });
    return { request: result.request, posted, dm: !!sent.ok };
}

module.exports = { NOT_SET_UP, guildBankChannelId, createRequest, resolveRequest, redrawPost, postFor };
