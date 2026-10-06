// Guild bank requests (the "Gildenbank" area of the raider organizer, docs/
// signups.md): a raider asks for mats, potions or enchants, the bot posts the
// request as a card into one orga channel for every category
// (Einstellungen → Verbindungen → Discord-Server, `discordServers.guildBankChannelId`),
// and the orga handles it there — the raider gets a DM in their own language.
// No channel set = no guild bank button.
//
// Two kinds of request:
//   - from the stock (#633): the server has a guild bank (guildBankStockStore,
//     assigned in Einstellungen) with items on "give" and something left. The
//     raider picks an item (utils/signup/guildBankPick.js), the amount is
//     checked against "Verfügbar" and the item's maxPerRequest, the recipient
//     is one of their characters of the bank's version. The orga confirms
//     (the amount is set aside — checked again, someone may have been faster),
//     takes the confirmation back, or marks it handed out; or declines it.
//       open → confirmed → handedOut, open → rejected, confirmed → open
//   - free text (no bank data): what was typed, open → done | rejected.
//
// Stored in stores/guildBankStore.js, cards built by utils/signup/guildBankPost.js;
// commands/signup/availability.js takes the raider's steps,
// commands/signup/guildBank.js the orga's buttons. Errors are German (the
// commands translate them for the raider with serviceText); a Discord failure
// is logged and returned, never thrown.
const store = require("../../stores/guildBankStore");
const stockStore = require("../../stores/guildBankStockStore");
const settingsStore = require("../../stores/settingsStore");
const profiles = require("../../stores/raiderProfileStore");
const discord = require("../discord/discord");
const { eventGuildIds } = require("../discord/guildRoles");
const { langOf } = require("../discord/botLanguage");
const { categoryNameFor } = require("./availabilityPanel");
const { mainVersionFor } = require("../events/mainVersion");
const stockView = require("../guildbank/stockView");
const post = require("../../utils/signup/guildBankPost");
const logger = require("../../logger");

const NOT_SET_UP = "Die Gildenbank ist gerade nicht eingerichtet.";
const NOT_OFFERED = "Diesen Gegenstand gibt es gerade nicht in der Gildenbank.";

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** The orga channel of the guild bank, "" when none is set (then there is no guild bank). */
function guildBankChannelId(config = settingsStore.getConfig()) {
    return post.guildBankChannelId(config);
}

/** The orga card of a request as it should look now (a stock request with the stock's numbers). */
function postFor(request, { config } = {}) {
    let categoryName = "";
    try {
        categoryName = request.categoryId ? categoryNameFor(request.categoryId, { config }) : "";
    } catch {
        // no names while the bot is offline
    }
    const stock = request.itemId && request.bankKey ? stockView.stockItem(request.bankKey, request.itemId) : null;
    return post.orgaPayload(request, { categoryName, stock });
}

/**
 * What a raider may ask for from an organizer: the first of the servers
 * (`guildIds`, the organizer's own first, then the event servers) that has a
 * guild bank — its bank of the category's game version, else its first — with
 * the offerable items in groups. `{ bank: null, groups: [] }` without one:
 * then the free-text form stays.
 * @param {{ guildIds?: string[], categoryId?: string, config?: object }} [o]
 */
function offerFor({ guildIds = [], categoryId = "", config } = {}) {
    const cfg = config || settingsStore.getConfig();
    const versionId = mainVersionFor({ categoryId, config: cfg });
    const ids = [...new Set([...guildIds, ...eventGuildIds(cfg)].map(str).filter(Boolean))];
    for (const guildId of ids) {
        const offer = stockView.offerForServer(guildId, { versionId });
        if (offer.bank) return offer;
    }
    return { bank: null, groups: [] };
}

/** The raider's characters of the bank's game version, in their own order (the first is the default). */
function charactersFor(userId, bank) {
    if (!bank) return [];
    return profiles.charactersOfVersion(profiles.getProfile(userId), bank.gameVersion)
        .map((c) => ({ key: c.key, name: c.name, realm: c.realm || "", className: c.className }));
}

/** Store a checked request and post its card; a post that does not reach the channel is taken back (nobody would see it). */
async function storeAndPost(input, { channelId, config, now }) {
    store.prune({ now });
    const added = store.addRequest(input, { now });
    if (added.error) return added;
    try {
        const posted = await discord.postPayload(channelId, postFor(added.request, { config }));
        return { request: store.setMessage(added.request.id, posted) || added.request };
    } catch (e) {
        store.removeRequest(added.request.id);
        logger.warn(`[guildBank] Anfrage ${added.request.id} nicht in ${channelId} gepostet: ${(e && e.message) || e}`);
        return { error: "Die Anfrage konnte nicht gepostet werden – versuch es später noch einmal." };
    }
}

/**
 * A raider's free-text request: check it, store it, post it into the orga channel.
 * @param {string} userId
 * @param {{ item: string, amount: string|number, purpose?: string }} input as typed in the modal
 * @param {{ userName?: string, categoryId?: string, config?: object, now?: number }} [o]
 * @returns {Promise<{ request: object } | { error: string }>}
 */
async function createRequest(userId, input = {}, { userName = "", categoryId = "", config, now = Date.now() } = {}) {
    const cfg = config || settingsStore.getConfig();
    const channelId = guildBankChannelId(cfg);
    if (!channelId) return { error: NOT_SET_UP };
    return storeAndPost({ ...input, userId, userName, categoryId }, { channelId, config: cfg, now });
}

/**
 * A raider's request from the stock: the item must still be offered, the
 * amount at most what is left and at most the item's maxPerRequest; the
 * recipient is the picked character of the bank's version, else the first
 * (none = no name, the orga sees the raider). Realm: the character's, else
 * the bank's; faction: the bank's (the profile knows none).
 * @param {string} userId
 * @param {{ bankKey: string, itemId: number, amount: string|number, purpose?: string, characterKey?: string }} input
 * @param {{ userName?: string, categoryId?: string, config?: object, now?: number }} [o]
 * @returns {Promise<{ request: object } | { error: string }>}
 */
async function createStockRequest(userId, input = {}, { userName = "", categoryId = "", config, now = Date.now() } = {}) {
    const cfg = config || settingsStore.getConfig();
    const channelId = guildBankChannelId(cfg);
    if (!channelId) return { error: NOT_SET_UP };
    const bank = input.bankKey ? stockStore.getBank(input.bankKey) : null;
    const item = bank ? stockView.stockItem(bank.key, input.itemId) : null;
    if (!item || !stockView.isOfferable(item)) return { error: NOT_OFFERED };
    const amount = store.parseAmount(input.amount);
    if (!amount) return { error: `Die Menge muss eine ganze Zahl von ${store.AMOUNT_MIN} bis ${store.AMOUNT_MAX} sein.` };
    if (item.maxPerRequest > 0 && amount > item.maxPerRequest) return { error: `Höchstens ${item.maxPerRequest} pro Anfrage.` };
    if (amount > item.available) return { error: `Nur noch ${item.available} verfügbar.` };
    const characters = charactersFor(userId, bank);
    const character = characters.find((c) => c.key === str(input.characterKey)) || characters[0] || null;
    return storeAndPost({
        userId, userName, categoryId,
        item: item.name || `Item ${item.itemId}`, amount, purpose: input.purpose,
        bankKey: bank.key, itemId: item.itemId, icon: item.icon, group: item.group,
        characterName: character ? character.name : "",
        realm: (character && character.realm) || bank.realm || "",
        faction: bank.faction || "",
    }, { channelId, config: cfg, now });
}

/** Draw a request's orga card as it should look now (best-effort). Returns whether it was edited. */
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

/** The other open / confirmed cards of the same item: their "Vorgemerkt" and "Verfügbar" moved. Best-effort. */
async function redrawSiblings(request, { config } = {}) {
    if (!request || !request.itemId || !request.bankKey) return;
    const others = store.listRequests()
        .filter((r) => r.id !== request.id && r.bankKey === request.bankKey && r.itemId === request.itemId && store.PENDING_STATUSES.includes(r.status));
    for (const r of others) await redrawPost(r, { config });
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

/** After a store step: refused → redraw the card (stale buttons go); done → redraw it and its siblings, DM the raider. */
async function finish(result, { config, dm = true } = {}) {
    if (result.error) {
        if (result.request) await redrawPost(result.request, { config });
        return result;
    }
    const posted = await redrawPost(result.request, { config });
    await redrawSiblings(result.request, { config });
    const sent = dm ? await notifyRaider(result.request, { config }) : { ok: false };
    return { request: result.request, posted, dm: !!sent.ok };
}

/**
 * The orga handles an open request: done (free text only), or declined with an
 * optional reason. Edits the orga card (status note, no buttons) and DMs the
 * raider. An already handled request is refused — its card is drawn again, so
 * stale buttons disappear.
 * @param {string} id
 * @param {{ by: string, byName: string, status: "done"|"rejected", reason?: string }} decision
 * @returns {Promise<{ request: object, posted: boolean, dm: boolean } | { error: string, request?: object }>}
 */
async function resolveRequest(id, { by = "", byName = "", status, reason = "" } = {}, { config, now = Date.now() } = {}) {
    const cfg = config || settingsStore.getConfig();
    return finish(store.resolveRequest(id, { status, by, byName, reason }, { now }), { config: cfg });
}

/**
 * The orga confirms an open request from the stock: the amount is set aside.
 * Checked against "Verfügbar" again — another confirmation may have taken it
 * meanwhile; then `{ error, request, available }` and nothing changes.
 * @returns {Promise<{ request: object, posted: boolean, dm: boolean } | { error: string, request?: object, available?: number }>}
 */
async function confirmRequest(id, { by = "", byName = "" } = {}, { config, now = Date.now() } = {}) {
    const cfg = config || settingsStore.getConfig();
    const request = store.getRequest(id);
    if (request && request.status === "open" && request.itemId) {
        const item = stockView.stockItem(request.bankKey, request.itemId);
        const available = item ? item.available : 0;
        if (available < request.amount) {
            await redrawPost(request, { config: cfg });
            return { error: `Nicht genug verfügbar: noch ${available}, angefragt ${request.amount}.`, request, available };
        }
    }
    return finish(store.confirmRequest(id, { by, byName }, { now }), { config: cfg });
}

/** The orga takes a confirmation back: open again, nothing set aside. No DM. */
async function releaseRequest(id, { config } = {}) {
    const cfg = config || settingsStore.getConfig();
    return finish(store.releaseRequest(id), { config: cfg, dm: false });
}

/**
 * A confirmed request was handed out: the orga's "Ausgegeben" (`via:
 * "discord"`), or the addon's hand-out list (#634, "manual" | "mail"). Edits
 * the card ("ausgegeben von X") and DMs the raider. A request handed out
 * before is refused with the request (idempotent for the addon).
 */
async function handOutRequest(id, { by = "", byName = "", via = "discord" } = {}, { config, now = Date.now() } = {}) {
    const cfg = config || settingsStore.getConfig();
    return finish(store.handOutRequest(id, { by, byName, via }, { now }), { config: cfg });
}

/** The open and confirmed requests from one bank's stock (the web page's "Anfragen"): open first, each oldest first. */
function pendingForBank(bankKey) {
    const key = str(bankKey);
    if (!key) return [];
    return store.listRequests().filter((r) => r.bankKey === key && r.itemId && store.PENDING_STATUSES.includes(r.status));
}

module.exports = {
    NOT_SET_UP, NOT_OFFERED, guildBankChannelId, postFor, offerFor, charactersFor, createRequest, createStockRequest,
    resolveRequest, confirmRequest, releaseRequest, handOutRequest, redrawPost, pendingForBank,
};
