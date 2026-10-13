// Guild bank requests (the "Gildenbank" area of the raider organizer, docs/
// signups.md): a raider asks for mats, potions or enchants, the bot posts the
// request as a card into one orga channel for every category
// (Einstellungen → Verbindungen → Discord-Server, `discordServers.guildBankChannelId`),
// and the orga handles it there — the raider gets a DM in their own language.
// No channel set = no guild bank button.
//
// Two kinds of request:
//   - from the stock (#633): the server has a guild bank (guildBankStockStore,
//     assigned in Einstellungen) with items on "give". The raider picks an
//     item (utils/signup/guildBankPick.js), the amount is checked against the
//     item's maxPerRequest, the recipient is one of their characters of the
//     bank's version. What is free (Verfügbar minus the open requests) becomes
//     an open request, the rest goes on the item's waiting list (#775,
//     services/guildbank/waitlist.js) — all of it while somebody waits already.
//     The orga confirms (the amount is set aside — checked again, someone may
//     have been faster), takes the confirmation back, or marks it handed out;
//     or declines it. When stock comes free (advanceWaitlist: a scan, a
//     decline, a released confirmation, the orga's changes), the list moves up
//     in turns — at most the item's portion each, a rest goes to the end of
//     the list — to open requests: a card "aus der Warteliste" and a DM.
//       waiting → open → confirmed → handedOut, open → rejected, confirmed → open
//     Confirming needs a **linked** character (services/guildbank/linking.js):
//     the request's raider and a **confirmed** character of their profile (seen
//     in a log or the loot, answered by the armory, or checked in game by the
//     orga) — the addon mails to that name. The recipient's own evidence
//     counts too (#806, linking.recipientEvidence): a name seen in a log or
//     the loot, or one the orga vouched for — a raider without a Discord
//     account has no profile at all. An unlinked card shows a warning
//     ("Kein verknüpfter Charakter" / "Charakter nicht bestätigt") and, with
//     a character name, "Geprüft & bestätigen" (checkAndConfirm: the orga
//     checked the name in game) instead of "Bestätigen"; the orga can also
//     link it in the web (linkRequest) or vouch for the name there
//     (checkRequestRecipient), which redraws it. A confirmation is the orga's
//     word for the recipient: it stays when the confirmation is released.
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
const waitlist = require("../guildbank/waitlist");
const linking = require("../guildbank/linking");
const { seenIndex, characterEvidence } = require("../characters/characterEvidence");
const characterStore = require("../../stores/characterStore");
const { validateCharacterName } = require("../../utils/signup/characterNames");
const post = require("../../utils/signup/guildBankPost");
const logger = require("../../logger");

const NOT_SET_UP = "Die Gildenbank ist gerade nicht eingerichtet.";
const NOT_OFFERED = "Diesen Gegenstand gibt es gerade nicht in der Gildenbank.";
const NOT_LINKED = "Erst einen Charakter verknüpfen – im Web unter Gildenbank, oder den Namen im Spiel prüfen und „Geprüft & bestätigen“ drücken.";
const NOT_VERIFIED = "Der Charakter ist nicht bestätigt – im Spiel prüfen und „Geprüft & bestätigen“ drücken, oder im Web unter Gildenbank prüfen (Arsenal) bzw. anders verknüpfen.";
// the web's link step (orga only, never shown to a raider in Discord)
const LINK_GONE = "Diese Anfrage wartet nicht mehr.";
const LINK_NO_CHARACTER = "Diesen Charakter gibt es im Profil nicht.";

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** The orga channel of the guild bank, "" when none is set (then there is no guild bank). */
function guildBankChannelId(config = settingsStore.getConfig()) {
    return post.guildBankChannelId(config);
}

/**
 * What the recipient of a request that moved up still waits for of the same
 * item (the rest that went to the end of the list): `{ amount, position }` —
 * the same raider (or, without a Discord account, the same character name);
 * `position` = the first such entry's place (1 = next). Null when nothing waits.
 */
function restWaiting(request) {
    if (!request || !request.fromWaitlist || !request.itemId || !store.PENDING_STATUSES.includes(request.status)) return null;
    const same = (r) => (request.userId ? r.userId === request.userId : !r.userId && str(r.characterName).toLowerCase() === str(request.characterName).toLowerCase());
    const queue = store.waitingQueue(request.bankKey, request.itemId);
    const mine = queue.filter(same);
    if (!mine.length) return null;
    return { amount: mine.reduce((sum, r) => sum + r.amount, 0), position: queue.indexOf(mine[0]) + 1 };
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
    // only a request from the stock goes to a character in game (the addon's mail)
    const state = request.itemId ? linking.linkState(request) : { linked: true, linkProblem: "" };
    return post.orgaPayload(request, { categoryName, stock, linked: state.linked, linkProblem: state.linkProblem, rest: restWaiting(request) });
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
 * How a request from the stock splits (#775): while somebody waits for the
 * item, everything waits behind them (strict order); else what is free (stock
 * view `free` = Verfügbar minus the open requests) goes out now and the rest
 * waits.
 * @returns {{ now: number, wait: number }}
 */
function splitAmount(item, amount) {
    if (item.waiting > 0) return { now: 0, wait: amount };
    const now = Math.min(amount, Math.max(0, Number(item.free) || 0));
    return { now, wait: amount - now };
}

/**
 * The checks of a request from the stock, before anything is stored: the item
 * offered, the amount, maxPerRequest and the limit of the part it lands in.
 * `{ bank, item, amount, split }` or `{ error }` (German).
 */
function checkStockRequest(userId, input) {
    const bank = input.bankKey ? stockStore.getBank(input.bankKey) : null;
    const item = bank ? stockView.stockItem(bank.key, input.itemId) : null;
    if (!item || !stockView.isRequestable(item)) return { error: NOT_OFFERED };
    const amount = store.parseAmount(input.amount);
    if (!amount) return { error: `Die Menge muss eine ganze Zahl von ${store.AMOUNT_MIN} bis ${store.AMOUNT_MAX} sein.` };
    if (item.maxPerRequest > 0 && amount > item.maxPerRequest) return { error: `Höchstens ${item.maxPerRequest} pro Anfrage.` };
    const split = splitAmount(item, amount);
    if (split.now && store.openCount(userId) >= store.MAX_OPEN) return { error: `Höchstens ${store.MAX_OPEN} offene Anfragen – warte, bis die Orga eine erledigt hat.` };
    if (split.wait && store.waitingCount(userId) >= store.MAX_WAITING) {
        return { error: `Höchstens ${store.MAX_WAITING} Einträge auf der Warteliste – warte, bis einer drankommt.` };
    }
    return { bank, item, amount, split };
}

/** The fields a request from the stock shares in both parts: item, raider, recipient. */
function stockRequestBase(userId, input, { bank, item }, { userName, categoryId }) {
    const characters = charactersFor(userId, bank);
    const character = characters.find((c) => c.key === str(input.characterKey)) || characters[0] || null;
    return {
        userId, userName, categoryId, purpose: input.purpose,
        item: item.name || `Item ${item.itemId}`,
        bankKey: bank.key, itemId: item.itemId, icon: item.icon, group: item.group,
        characterName: character ? character.name : "",
        realm: (character && character.realm) || bank.realm || "",
        faction: bank.faction || "",
    };
}

/**
 * A raider's request from the stock: the item must still be offered
 * (requestable — nothing left is fine) and the amount at most the item's
 * maxPerRequest. What is free becomes an open request (posted to the orga),
 * the rest goes on the item's waiting list (splitAmount); both limits are
 * checked before anything is stored (MAX_OPEN for the open part, MAX_WAITING
 * for the waiting one). The recipient is the picked character of the bank's
 * version, else the first (none = no name, the orga sees the raider). Realm:
 * the character's, else the bank's; faction: the bank's (the profile knows none).
 * @param {string} userId
 * @param {{ bankKey: string, itemId: number, amount: string|number, purpose?: string, characterKey?: string }} input
 * @param {{ userName?: string, categoryId?: string, config?: object, now?: number }} [o]
 * @returns {Promise<{ request: object|null, waiting: object|null, position: number, portion: number } | { error: string }>}
 *   `request` the open part, `waiting` the waiting part with its `position` (1 = next),
 *   `portion` the item's share per turn on the waiting list (the raider's answer names it)
 */
async function createStockRequest(userId, input = {}, { userName = "", categoryId = "", config, now = Date.now() } = {}) {
    const cfg = config || settingsStore.getConfig();
    const channelId = guildBankChannelId(cfg);
    if (!channelId) return { error: NOT_SET_UP };
    const checked = checkStockRequest(userId, input);
    if (checked.error) return checked;
    const { bank, item, split } = checked;
    const base = stockRequestBase(userId, input, checked, { userName, categoryId });
    let request = null;
    if (split.now) {
        const posted = await storeAndPost({ ...base, amount: split.now }, { channelId, config: cfg, now });
        if (posted.error) return posted;
        request = posted.request;
    }
    let waiting = null;
    if (split.wait) {
        const added = store.addWaiting({ ...base, amount: split.wait }, { now });
        // the limit was checked above; only a race of two clicks lands here
        if (added.error) logger.warn(`[guildBank] Wartelisten-Eintrag von ${userId} nicht gespeichert: ${added.error}`);
        else waiting = added.request;
    }
    const portion = stockStore.portionOf(item);
    if (!waiting) return { request, waiting: null, position: 0, portion };
    // strict order: if anything is free while people wait, the list goes first
    await advanceWaitlist({ bankKey: bank.key, itemId: item.itemId, config: cfg, now });
    const still = store.getRequest(waiting.id);
    const stillWaiting = !!still && still.status === "waiting";
    return {
        // moved up at once (stock was free while others waited): it went out with a card and a DM
        request: request || (still && still.status === "open" ? still : null),
        waiting: stillWaiting ? still : null,
        position: stillWaiting ? waitlist.positionOf(still) : 0,
        portion,
    };
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

/**
 * Tell the raider in their language (`build(request, lang)`, the decision card
 * by default). An entry the orga imported without a Discord account gets
 * none. `{ ok }` or `{ ok: false, error }`, never throws.
 */
async function notifyRaider(request, { config, build = post.decisionCard } = {}) {
    if (!request.userId) return { ok: false, error: "kein Discord-Konto" };
    try {
        const lang = langOf(request.userId, { config });
        const sent = await discord.sendDirectMessage(request.userId, build(request, lang));
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
    const result = await finish(store.resolveRequest(id, { status, by, byName, reason }, { now }), { config: cfg });
    // a declined request from the stock frees what it had promised: the waiting list moves up
    if (!result.error && result.request.itemId) await advanceWaitlist({ bankKey: result.request.bankKey, itemId: result.request.itemId, config: cfg, now });
    return result;
}

/**
 * The orga confirms an open request from the stock: the amount is set aside.
 * Only a request with a linked character (linking.linkState) — else
 * `{ error: NOT_LINKED | NOT_VERIFIED, request, notLinked: true, linkProblem }`,
 * the card is redrawn and nothing changes. Checked against "Verfügbar" again — another confirmation
 * may have taken it meanwhile; then `{ error, request, available }`.
 * @returns {Promise<{ request: object, posted: boolean, dm: boolean } | { error: string, request?: object, available?: number, notLinked?: boolean }>}
 */
async function confirmRequest(id, { by = "", byName = "" } = {}, { config, now = Date.now() } = {}) {
    const cfg = config || settingsStore.getConfig();
    const request = store.getRequest(id);
    const state = request && request.status === "open" && request.itemId ? linking.linkState(request) : null;
    if (state && !state.linked) {
        await redrawPost(request, { config: cfg });
        return { error: state.linkProblem === "unverified" ? NOT_VERIFIED : NOT_LINKED, request, notLinked: true, linkProblem: state.linkProblem };
    }
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

/**
 * "Geprüft & bestätigen" on the orga card (#806): the clicking member vouches
 * for the request's recipient (it exists in game — guildBankStore.checkRecipient)
 * and confirms it, for a request that is not linked otherwise (a raider without
 * a Discord account, a profile character nobody confirmed). A request without
 * a character name has nothing to vouch for and is refused like confirmRequest.
 */
async function checkAndConfirm(id, { by = "", byName = "" } = {}, { config, now = Date.now() } = {}) {
    const request = store.getRequest(id);
    if (request && request.status === "open" && request.itemId && str(request.characterName) && !(request.recipientCheckedAt > 0)) {
        store.checkRecipient(id, { by, byName }, { now });
    }
    return confirmRequest(id, { by, byName }, { config, now });
}

/**
 * The orga vouches in the web for a pending request's recipient (#806, "Im
 * Spiel geprüft" for the request's own name): the addon may mail to it without
 * a raider profile behind it. The card is redrawn — "Bestätigen" works now.
 * Returns `{ request }` (with `linked`) or `{ error, code }` ("not_found" | "invalid").
 */
async function checkRequestRecipient(id, { bankKey = "", by = "", byName = "" } = {}, { config, now = Date.now() } = {}) {
    const request = store.getRequest(id);
    if (!request || request.bankKey !== str(bankKey) || !store.PENDING_STATUSES.includes(request.status)) {
        return { error: LINK_GONE, code: "not_found" };
    }
    const result = store.checkRecipient(id, { by, byName }, { now });
    if (result.error) return { error: result.error, code: "invalid" };
    await redrawPost(result.request, { config: config || settingsStore.getConfig() });
    return { request: linking.withLinked(result.request) };
}

/**
 * Put a character the orga named into the raider's profile (#809, "ins Profil
 * übernehmen"): class from the class cache (logs, loot) or the caller, the
 * orga's check as its evidence. It goes first among the raider's characters of
 * the version only when the first one there now is an unconfirmed typed name
 * (the "Gentle" a raider typed at a signup) — never past a real main.
 * Returns "added" | "noClass" | "noProfile" or a German error.
 */
function addToProfile(userId, { name, realm, versionId, className = "", by = "", byName = "", checked = false }) {
    if (!profiles.getProfile(userId)) return "noProfile";
    const known = characterStore.getCharacter(name);
    const cls = str(className) || str(known && known.className);
    if (!cls) return "noClass";
    const added = profiles.addCharacter(userId, { name, realm, className: cls, source: "manual" }, { versionId });
    if (added.error) return added.error;
    const key = added.character.key;
    if (checked) profiles.verifyCharacter(userId, key, { by, byName });
    const first = profiles.charactersOfVersion(profiles.getProfile(userId), versionId)[0];
    if (first && first.key !== key && !characterEvidence(first, { gameVersion: versionId }).verified) profiles.moveCharacterFirst(userId, key);
    return "added";
}

/**
 * The orga gives a pending request from the stock another character name
 * (#809): "Charakter ändern …" on the card (`checked` — the orga vouches with
 * the modal) or a free / suggested name in the web. The name follows the
 * game's rule of the bank's version (utils/signup/characterNames.js), the
 * realm defaults to the bank's. A name without evidence (no profile
 * character, no log, loot or earlier hand-out of this bank) needs `checked`.
 * The raider and the DMs stay; `addToProfile` also puts the name into the
 * raider's profile (addToProfile). The card is redrawn at once.
 * Returns `{ request, profile }` (`request` with `linked`; `profile` "" |
 * "added" | "noClass" | "noProfile" | an error) or `{ error, code }`.
 */
async function reassignRequest(id, {
    bankKey = "", characterName = "", realm = "", by = "", byName = "", checked = false, addToProfile: toProfile = false, className = "",
} = {}, { config, now = Date.now() } = {}) {
    const request = store.getRequest(id);
    if (!request || !request.itemId || (bankKey && request.bankKey !== str(bankKey)) || !store.PENDING_STATUSES.includes(request.status)) {
        return { error: LINK_GONE, code: "not_found" };
    }
    const bank = stockStore.getBank(request.bankKey);
    const versionId = bank ? str(bank.gameVersion) : "";
    const valid = validateCharacterName(characterName, { versionId });
    if (valid.error) return { error: valid.error, code: "invalid" };
    const target = { ...request, characterName: valid.name, realm: str(realm) || (bank && bank.realm) || request.realm || "", recipientCheckedAt: 0 };
    if (!checked && !linking.linkState(target, { gameVersion: versionId }).linked) {
        return { error: `${valid.name} ist nirgends belegt – erst im Spiel prüfen („Im Spiel geprüft“).`, code: "invalid" };
    }
    const result = store.setRecipientName(request.id, { characterName: valid.name, realm: target.realm, by, byName, checked }, { now });
    if (result.error) return { error: result.error, code: "invalid" };
    let profile = "";
    if (toProfile && request.userId) {
        profile = addToProfile(request.userId, { name: valid.name, realm: target.realm, versionId, className, by, byName, checked });
    }
    const cfg = config || settingsStore.getConfig();
    await redrawPost(result.request, { config: cfg });
    return { request: linking.withLinked(result.request), profile };
}

/**
 * Draw every posted card of a waiting-for-the-orga request from the stock
 * (open, confirmed) again — at start, so a card drawn by an older version of
 * the bot (a disabled "Bestätigen" from before #806/#809) shows today's
 * buttons. One after another, best-effort. Returns how many were edited.
 */
async function redrawPendingCards({ config } = {}) {
    let edited = 0;
    try {
        const cfg = config || settingsStore.getConfig();
        const pending = store.listRequests().filter((r) => r.itemId && (r.status === "open" || r.status === "confirmed") && r.messageId);
        for (const r of pending) if (await redrawPost(r, { config: cfg })) edited += 1;
    } catch (e) {
        logger.warn(`[guildBank] Karten nicht neu gezeichnet: ${(e && e.message) || e}`);
    }
    return edited;
}

/** The orga takes a confirmation back: open again, nothing set aside. No DM. */
async function releaseRequest(id, { config } = {}) {
    const cfg = config || settingsStore.getConfig();
    const result = await finish(store.releaseRequest(id), { config: cfg, dm: false });
    if (!result.error) await advanceWaitlist({ bankKey: result.request.bankKey, itemId: result.request.itemId, config: cfg });
    return result;
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

/**
 * The open and confirmed requests from one bank's stock (the web page's
 * "Anfragen"): open first, each oldest first, each with `linked`. The waiting
 * list has its own tab.
 */
function pendingForBank(bankKey) {
    const key = str(bankKey);
    if (!key) return [];
    const bank = stockStore.getBank(key);
    const o = { gameVersion: bank ? bank.gameVersion || "" : "", index: seenIndex() };
    return store.listRequests()
        .filter((r) => r.bankKey === key && r.itemId && (r.status === "open" || r.status === "confirmed"))
        .map((r) => linking.withLinked(r, o));
}

/** The handed-out requests from one bank's stock (the web page's "Ausgegeben"), newest hand-out first — kept 90 days (store.prune). */
function handedOutForBank(bankKey) {
    const key = str(bankKey);
    if (!key) return [];
    return store.listRequests({ status: "handedOut" })
        .filter((r) => r.bankKey === key && r.itemId)
        .sort((a, b) => (b.handedOutAt || b.handledAt) - (a.handedOutAt || a.handledAt));
}

/**
 * The orga links a pending request (waiting, open, confirmed) of a bank to a
 * profile character in the web: `userId` + `characterKey` (linking.resolveChoice)
 * become the request's raider and recipient (realm: the character's, else the
 * bank's). Only a confirmed character of the bank's version (linking.pickError).
 * A posted card is redrawn — "Bestätigen" works now. Returns `{ request }`
 * (with `linked`) or `{ error, code }` ("not_found" | "invalid").
 */
async function linkRequest(id, { bankKey = "", userId = "", characterKey = "" } = {}, { config } = {}) {
    const request = store.getRequest(id);
    if (!request || request.bankKey !== str(bankKey) || !store.PENDING_STATUSES.includes(request.status)) {
        return { error: LINK_GONE, code: "not_found" };
    }
    const choice = linking.resolveChoice(userId, characterKey);
    if (!choice) return { error: LINK_NO_CHARACTER, code: "invalid" };
    const bank = stockStore.getBank(request.bankKey);
    const refused = linking.pickError(userId, characterKey, bank ? bank.gameVersion : "");
    if (refused) return { error: refused, code: "invalid" };
    const result = store.setRecipient(request.id, { ...choice, realm: choice.realm || (bank && bank.realm) || "" });
    if (result.error) return { error: result.error, code: "invalid" };
    await redrawPost(result.request, { config: config || settingsStore.getConfig() });
    return { request: linking.withLinked(result.request) };
}

/** Post the orga card of a request that moved up from the waiting list. Returns whether it reached the channel. */
async function postMovedUp(request, { channelId, config }) {
    try {
        const posted = await discord.postPayload(channelId, postFor(request, { config }));
        store.setMessage(request.id, posted);
        return true;
    } catch (e) {
        logger.warn(`[guildBank] Nachgerückte Anfrage ${request.id} nicht in ${channelId} gepostet: ${(e && e.message) || e}`);
        return false;
    }
}

let posting = Promise.resolve();

/**
 * Stock came free (or the list changed): move the first of the waiting list up
 * (services/guildbank/waitlist.js) — of one item, else of every item of the
 * bank, else of every bank — then post their orga cards ("aus der Warteliste")
 * and DM the raiders ("Du bist dran"). The moving up happens at once (before
 * the first await), so the caller reads the new state right after the call;
 * the posts run one after another across calls. A card that did not reach
 * the channel (bot offline) is posted again on the next run. Never throws.
 * @param {{ bankKey?: string, itemId?: number, config?: object, now?: number }} [o]
 * @returns {Promise<{ moved: object[], posted: number }>}
 */
function advanceWaitlist({ bankKey = "", itemId = 0, config, now = Date.now() } = {}) {
    let moved = [];
    let keys = [];
    try {
        keys = bankKey ? [str(bankKey)] : stockStore.listBanks().map((b) => b.key);
        moved = keys.flatMap((key) => waitlist.promoteBank(key, { itemId, now }));
    } catch (e) {
        logger.warn(`[guildBank] Warteliste nicht nachgerückt: ${(e && e.message) || e}`);
    }
    const run = posting.then(async () => {
        const cfg = config || settingsStore.getConfig();
        const channelId = guildBankChannelId(cfg);
        if (!channelId) return { moved, posted: 0 };
        let posted = 0;
        const unposted = store.listRequests({ status: "open" })
            .filter((r) => r.fromWaitlist && !r.messageId && keys.includes(r.bankKey));
        for (const request of unposted) {
            if (await postMovedUp(request, { channelId, config: cfg })) posted += 1;
        }
        for (const { request, rest, restPosition } of moved) {
            const more = { rest: rest ? rest.amount : 0, position: restPosition || 0 };
            await notifyRaider(request, { config: cfg, build: (r, lang) => post.movedUpCard(r, lang, more) });
        }
        return { moved, posted };
    }).catch((e) => {
        logger.warn(`[guildBank] Nachgerückte Anfragen nicht gepostet: ${(e && e.message) || e}`);
        return { moved, posted: 0 };
    });
    posting = run;
    return run;
}

module.exports = {
    NOT_SET_UP, NOT_OFFERED, NOT_LINKED, NOT_VERIFIED, guildBankChannelId, postFor, restWaiting, offerFor, charactersFor, createRequest, createStockRequest, splitAmount,
    resolveRequest, confirmRequest, checkAndConfirm, checkRequestRecipient, reassignRequest, redrawPendingCards, releaseRequest, handOutRequest, redrawPost, pendingForBank, handedOutForBank,
    linkRequest, advanceWaitlist,
};
