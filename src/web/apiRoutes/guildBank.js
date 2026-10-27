// The guild bank stock: the page "Gildenbank" (#632) and the assignment of a
// bank to a Discord server (Einstellungen). A bank scanned for the first time
// goes to the one server, or waits for an assignment when there are
// several; until then nobody can request from it.
//
//   GET  /api/guildbank                     the active server's banks of the content switch's
//                                           version (?version=, #741) and the one shown (?key=
//                                           one of them, else the first) with its items; never a
//                                           bank of another version — `bank: null` and
//                                           `otherVersions` (short names) when this one has none
//   POST /api/guildbank/item                { key, itemId, status?, reserve?, maxPerRequest?, portion?, category? }
//                                           (portion: the waiting list's share per turn, 1–99, 0 = default 2)
//   POST /api/guildbank/item/add            { key, query | itemId } — create an item by hand: id, Wowhead link
//                                           or name; stock 0, status "give"; { item, created }, or 400 "ambiguous"
//                                           when a name fits several items (the dialog picks from /item/search)
//   GET  /api/guildbank/item/search?key=&q= Wowhead's items for a name on the bank's version, { items }
//   POST /api/guildbank/tab                 { key, index, hidden } — hide or show a whole bank tab
//   GET  /api/guildbank/requests?key=       the bank's open and confirmed requests (the "Anfragen" tab, the item list's "Vorgemerkt" popover)
//   GET  /api/guildbank/handedout?key=      the bank's handed-out requests, newest first (the "Ausgegeben" tab)
//   GET  /api/guildbank/characters?key=&q=  the raider profiles' characters to link a request to (+ `names`: known names
//                                        without a profile, #809, knownNames.js), each character with its
//                                           evidence (`verified`, `evidence`: log | loot | armory | orga) (write)
//   POST /api/guildbank/characters/armory   { key, userId, characterKey } — "Im Arsenal prüfen": the armory of the
//                                           character's version; an answer is stored on the profile character
//                                           (confirmed) — { found, choice }
//   POST /api/guildbank/characters/verify   { key, userId, characterKey } — "Im Spiel geprüft": the orga confirms
//                                           the character (verifiedBy/At) — { choice }
//   POST /api/guildbank/request/link        { key, id, userId, characterKey } — a pending request's recipient
//                                           becomes that confirmed profile character (linked, card redrawn)
//   POST /api/guildbank/request/verify      { key, id } — "Im Spiel geprüft" for a pending request's own recipient
//                                           name (#806): the orga vouches for it, linked without a profile
//                                           (a raider without a Discord account), card redrawn
//   POST /api/guildbank/request/recipient   { key, id, characterName, realm?, checked?, addToProfile?, className? } —
//                                           #809: the request goes to that name (a known one, or checked in game),
//                                           the raider stays; optionally into the raider's profile
//   GET  /api/guildbank/waitlist?key=       the bank's waiting list (#775, the "Warteliste" dialog)
//   POST /api/guildbank/waitlist/add        { key, name, itemId, amount } — an entry at the end of the item's list
//   POST /api/guildbank/waitlist/move       { key, id, direction: "up" | "down" }
//   POST /api/guildbank/waitlist/remove     { key, id }
//   POST /api/guildbank/waitlist/preview    { key, text } — the import's rows (nothing stored)
//   POST /api/guildbank/waitlist/import     { key, text } — pasted lines "Name<Tab>Item<Tab>Anzahl" (also ; or ,)
//   GET  /api/settings/guild-banks          every bank (summary) + the servers to pick from
//   POST /api/settings/guild-banks/assign   { key, guildId } — "" takes the assignment back
//   POST /api/settings/guild-banks/delete   { key } — forget a bank with its settings
//
// The page's routes only ever touch a bank of the active server: another
// server's bank answers 404 like an unknown one, a write to a bank of a hidden
// version (#563) 409 "version_hidden" (read only), and a character of another
// version than the bank's — or one nobody has confirmed (services/characters/
// characterEvidence.js) — is never linked (#741, 400). Requests and waiting
// entries carry `linked` and `linkProblem` ("none" = no profile character,
// "unverified" = a profile character without evidence). A changed item status (and a
// forgotten bank) queues the item emojis' sync (services/guildbank/itemEmojis.js)
// in the background — the answer never waits for Discord. So does the waiting
// list's move-up (services/signups/guildBank.advanceWaitlist): every change to
// an item, a tab or the list moves it up at once and posts the orga cards and
// DMs afterwards; the answer already shows the list after the move.
const { ok } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { sendFailure, HTTP_BY_CODE } = require("../http/apiResult");
const { q } = require("../http/apiParams");
const { activeGuildFor } = require("../http/activeGuild");
const { resolveVersionQuery, isVersionVisible } = require("../../services/events/mainVersion");
const { getConfig } = require("../../stores/settingsStore");
const stockStore = require("../../stores/guildBankStockStore");
const stock = require("../../services/guildbank/guildBankStock");
const view = require("../../services/guildbank/stockView");
const { queueLookups } = require("../../services/guildbank/itemMeta");
const { queueItemEmojiSync } = require("../../services/guildbank/itemEmojis");
const { pendingForBank, handedOutForBank, linkRequest, checkRequestRecipient, reassignRequest, advanceWaitlist } = require("../../services/signups/guildBank");
const { knownNames } = require("../../services/guildbank/knownNames");
const linking = require("../../services/guildbank/linking");
const waitlist = require("../../services/guildbank/waitlist");
const addItem = require("../../services/guildbank/addItem");
const requestStore = require("../../stores/guildBankStore");
const { iconUrl } = require("../../utils/loot/wowhead");
const profiles = require("../../stores/raiderProfileStore");
const { lookupArmory } = require("../characters/profileView");

const NOT_FOUND = { code: "not_found", error: "Gildenbank nicht gefunden." };
const VERSION_HIDDEN = {
    code: "version_hidden",
    error: "Diese Gildenbank gehört zu einer ausgeblendeten Spielversion und ist nur noch lesbar.",
};

/** A bank failure with its status: a hidden version's bank is a conflict (409), the rest as usual. */
function sendBankFailure(res, failure) {
    return sendFailure(res, failure, { ...HTTP_BY_CODE, version_hidden: 409 });
}

/**
 * The bank `key` of the active server a write may change: `{ bank }`, or
 * `{ failure }` — another server's (or no) bank is NOT_FOUND, a bank of a
 * hidden version (#563, "Andere Versionen ausblenden") VERSION_HIDDEN: read
 * only, like an archived raid.
 */
function writableBank(key, req) {
    const bank = view.bankOfServer(key, activeGuildFor(req));
    if (!bank) return { failure: NOT_FOUND };
    return isVersionVisible(bank.gameVersion, getConfig()) ? { bank } : { failure: VERSION_HIDDEN };
}

/**
 * GET /api/guildbank — the page's version decides (#741): only the banks of
 * that version, `bank: null` when it has none (`otherVersions` names the
 * versions that do, for the page's hint).
 */
const getGuildBank = withUser(async ({ req, res, query }) => {
    const guildId = activeGuildFor(req);
    const config = getConfig();
    const { versionId } = resolveVersionQuery(query.get("version"), { config });
    const { banks, bank, otherVersions } = view.stockForServer(guildId, { key: q.str(query, "key", { max: 200 }), versionId, config });
    // Items still without a current Wowhead answer (a lookup failed, the bot
    // restarted, German names stored before) are asked again in the
    // background — at most once per item within itemMeta's retry pause.
    if (bank) queueLookups(bank.gameVersion, stockStore.itemsWithoutWowheadMeta(bank.key));
    ok(res, { banks, bank, otherVersions });
});

/** POST /api/guildbank/item — what the orga decided for one item. */
const postGuildBankItem = withUser({ write: "raids", csrf: true, body: true }, async ({ req, body, res }) => {
    const key = q.str(body, "key", { max: 200 });
    const { failure } = writableBank(key, req);
    if (failure) return sendBankFailure(res, failure);
    const patch = {};
    for (const field of ["status", "reserve", "maxPerRequest", "portion", "category"]) {
        if (body[field] !== undefined) patch[field] = field === "status" || field === "category" ? q.str(body, field) : body[field];
    }
    if (!Object.keys(patch).length) return sendFailure(res, { code: "invalid", error: "Nichts zu ändern." });
    const result = stockStore.setItemSettings(key, q.int(body, "itemId", { fallback: 0 }), patch);
    if (result.error) return sendFailure(res, { code: "invalid", error: result.error });
    if (patch.status !== undefined) queueItemEmojiSync();
    // a new status or reserve may free stock for the waiting list (a new portion shares it differently)
    moveUp(key, q.int(body, "itemId", { fallback: 0 }));
    ok(res, { item: view.itemForPage(key, result.item) });
});

/** POST /api/guildbank/item/add — an item the bank does not hold (yet), created by hand and offered at once. */
const addGuildBankItem = withUser({ write: "raids", csrf: true, body: true }, async ({ req, body, res }) => {
    const key = q.str(body, "key", { max: 200 });
    const { failure } = writableBank(key, req);
    if (failure) return sendBankFailure(res, failure);
    const result = await addItem.addByHand(key, { itemId: q.int(body, "itemId", { fallback: 0 }), query: q.str(body, "query", { max: 300 }) });
    if (result.error) return sendFailure(res, { code: result.choices ? "ambiguous" : "invalid", error: result.error });
    queueItemEmojiSync();
    // on "give" with nothing in stock: raiders may ask for it, their requests wait
    moveUp(key, result.item.itemId);
    ok(res, { item: result.item, created: result.created });
});

/** GET /api/guildbank/item/search?key=&q= — Wowhead's items for a name, to pick one to add. */
const searchGuildBankItems = withUser({}, async ({ req, res, query }) => {
    const bank = view.bankOfServer(q.str(query, "key", { max: 200 }), activeGuildFor(req));
    if (!bank) return sendFailure(res, NOT_FOUND);
    ok(res, { items: await addItem.search(bank.gameVersion, q.str(query, "q", { max: 80 })) });
});

/** `linked` and `linkProblem` of a request — what the service added, else read now (linking.linkState). */
function linkOf(r) {
    if (r.linked !== undefined) return { linked: !!r.linked, linkProblem: r.linked ? "" : r.linkProblem || "none" };
    const state = linking.linkState(r);
    return { linked: state.linked, linkProblem: state.linkProblem };
}

/** One request as the page's "Anfragen" tab lists it. */
function requestRow(r, items) {
    const item = items.get(r.itemId);
    const icon = (item && item.icon) || r.icon;
    return {
        id: r.id, itemId: r.itemId, item: (item && item.name) || r.item, iconUrl: iconUrl(icon), amount: r.amount,
        userId: r.userId, userName: r.userName, characterName: r.characterName, realm: r.realm, purpose: r.purpose,
        status: r.status, createdAt: r.createdAt, handledByName: r.handledByName, handledAt: r.handledAt, fromWaitlist: r.fromWaitlist === true,
        ...linkOf(r),
    };
}

/** GET /api/guildbank/requests?key= — the bank's open and confirmed requests. */
const getGuildBankRequests = withUser(async ({ req, res, query }) => {
    const key = q.str(query, "key", { max: 200 });
    const bank = view.bankOfServer(key, activeGuildFor(req));
    if (!bank) return sendFailure(res, NOT_FOUND);
    const items = new Map(bank.items.map((it) => [it.itemId, it]));
    ok(res, { requests: pendingForBank(key).map((r) => requestRow(r, items)) });
});

/** One handed-out request as the "Ausgegeben" tab lists it: what, to whom, when, by whom, how. */
function handedOutRow(r, items) {
    const item = items.get(r.itemId);
    return {
        id: r.id, itemId: r.itemId, item: (item && item.name) || r.item, iconUrl: iconUrl((item && item.icon) || r.icon), amount: r.amount,
        userId: r.userId, userName: r.userName, characterName: r.characterName, realm: r.realm, purpose: r.purpose,
        createdAt: r.createdAt, confirmedByName: r.handledByName,
        handedOutAt: r.handedOutAt, handedOutByName: r.handedOutByName, handoutVia: r.handoutVia, fromWaitlist: r.fromWaitlist,
    };
}

/** GET /api/guildbank/handedout?key= — the bank's handed-out requests (kept 90 days), newest first. */
const getGuildBankHandedOut = withUser(async ({ req, res, query }) => {
    const bank = view.bankOfServer(q.str(query, "key", { max: 200 }), activeGuildFor(req));
    if (!bank) return sendFailure(res, NOT_FOUND);
    const items = new Map(bank.items.map((it) => [it.itemId, it]));
    ok(res, { requests: handedOutForBank(bank.key).map((r) => handedOutRow(r, items)) });
});

/** GET /api/guildbank/characters?key=&q= — the profile characters of the bank's version to link a request to. */
const searchGuildBankCharacters = withUser({ write: "raids" }, async ({ req, res, query }) => {
    const bank = view.bankOfServer(q.str(query, "key", { max: 200 }), activeGuildFor(req));
    if (!bank) return sendFailure(res, NOT_FOUND);
    const text = q.str(query, "q", { max: 60 });
    ok(res, {
        characters: linking.characterChoices({ query: text, gameVersion: bank.gameVersion }),
        // #809: names the bank knows without a profile (earlier hand-outs, logs, loot)
        names: knownNames(bank.key, { query: text, gameVersion: bank.gameVersion }),
    });
});

const NO_CHARACTER = { code: "not_found", error: "Diesen Charakter gibt es im Profil nicht." };

/**
 * The profile character a body names, for a check of the bank `key` of the
 * active server: `{ bank, character, userId, characterKey }`, or `{ failure }`
 * — another server's bank and an unknown character 404, a character of another
 * version than the bank's 400 (#741).
 */
function characterToCheck(body, req) {
    const { bank, failure } = writableBank(q.str(body, "key", { max: 200 }), req);
    if (failure) return { failure };
    const userId = q.str(body, "userId", { max: 40 });
    const characterKey = q.str(body, "characterKey", { max: 80 });
    const profile = userId ? profiles.getProfile(userId) : null;
    const character = profile && profile.characters.find((c) => c.key === characterKey);
    if (!character) return { failure: NO_CHARACTER };
    const versionError = linking.versionError(userId, characterKey, bank.gameVersion);
    if (versionError) return { failure: { code: "invalid", error: versionError } };
    return { bank, character, userId, characterKey };
}

/**
 * POST /api/guildbank/characters/armory — body: { key, userId, characterKey };
 * "Im Arsenal prüfen": asks the armory of the character's version (realm: the
 * character's, else the bank's). An answer with a level is stored on the
 * profile character, which is confirmed from then on. `{ found, choice }` —
 * `found: false` when the armory does not know it or is not reachable.
 */
const checkGuildBankCharacterArmory = withUser({ write: "raids", csrf: true, body: true }, async ({ req, body, res }) => {
    const target = characterToCheck(body, req);
    if (target.failure) return sendBankFailure(res, target.failure);
    const { bank, character, userId, characterKey } = target;
    const answer = await lookupArmory(character.name, character.realm || bank.realm || "", character.versionId, { guildId: activeGuildFor(req) });
    const found = !!(answer.fetched && answer.level);
    if (found) profiles.setCharacterArmory(userId, characterKey, { level: answer.level, guild: answer.guild });
    ok(res, { found, choice: linking.choiceFor(userId, characterKey, bank.gameVersion) });
});

/**
 * POST /api/guildbank/characters/verify — body: { key, userId, characterKey };
 * "Im Spiel geprüft": the orga found the character in game (e.g. per /who) —
 * stored with who and when, the character is confirmed. `{ choice }`.
 */
const verifyGuildBankCharacter = withUser({ write: "raids", csrf: true, body: true }, async ({ req, body, res, user }) => {
    const target = characterToCheck(body, req);
    if (target.failure) return sendBankFailure(res, target.failure);
    const { bank, userId, characterKey } = target;
    profiles.verifyCharacter(userId, characterKey, { by: String(user.id || ""), byName: String(user.name || user.username || "") });
    ok(res, { choice: linking.choiceFor(userId, characterKey, bank.gameVersion) });
});

/** POST /api/guildbank/request/link — body: { key, id, userId, characterKey }; a pending request of this bank gets that recipient. */
const linkGuildBankRequest = withUser({ write: "raids", csrf: true, body: true }, async ({ req, body, res }) => {
    const key = q.str(body, "key", { max: 200 });
    const { bank, failure } = writableBank(key, req);
    if (failure) return sendBankFailure(res, failure);
    const userId = q.str(body, "userId", { max: 40 });
    const characterKey = q.str(body, "characterKey", { max: 80 });
    // only a confirmed character of the bank's version (#741): Forever bank = Forever characters
    const refused = linking.pickError(userId, characterKey, bank.gameVersion);
    if (refused) return sendFailure(res, { code: "invalid", error: refused });
    const result = await linkRequest(q.str(body, "id", { max: 40 }), { bankKey: bank.key, userId, characterKey });
    if (result.error) return sendFailure(res, { code: result.code || "invalid", error: result.error });
    const items = new Map(bank.items.map((it) => [it.itemId, it]));
    ok(res, { request: requestRow(result.request, items) });
});

/**
 * POST /api/guildbank/request/verify — body: { key, id }; "Im Spiel geprüft" for
 * the request's own recipient (#806): the orga found the name in game, the
 * request counts as linked without a raider profile. `{ request }`.
 */
const verifyGuildBankRequest = withUser({ write: "raids", csrf: true, body: true }, async ({ req, body, res, user }) => {
    const { bank, failure } = writableBank(q.str(body, "key", { max: 200 }), req);
    if (failure) return sendBankFailure(res, failure);
    const result = await checkRequestRecipient(q.str(body, "id", { max: 40 }), {
        bankKey: bank.key, by: String(user.id || ""), byName: String(user.name || user.username || ""),
    });
    if (result.error) return sendFailure(res, { code: result.code || "invalid", error: result.error });
    const items = new Map(bank.items.map((it) => [it.itemId, it]));
    ok(res, { request: requestRow(result.request, items) });
});

/**
 * POST /api/guildbank/request/recipient — body: { key, id, characterName, realm?,
 * checked?, addToProfile?, className? } (#809): a pending request goes to that
 * character name — a known name (`names` of /characters) or any name the orga
 * checked in game (`checked`); the raider stays. `addToProfile` also puts it
 * into the raider's profile. `{ request, profile }`.
 */
const reassignGuildBankRequest = withUser({ write: "raids", csrf: true, body: true }, async ({ req, body, res, user }) => {
    const { bank, failure } = writableBank(q.str(body, "key", { max: 200 }), req);
    if (failure) return sendBankFailure(res, failure);
    const result = await reassignRequest(q.str(body, "id", { max: 40 }), {
        bankKey: bank.key,
        characterName: q.str(body, "characterName", { max: 40 }),
        realm: q.str(body, "realm", { max: 60 }),
        checked: body.checked === true,
        addToProfile: body.addToProfile === true,
        className: q.str(body, "className", { max: 20 }),
        by: String(user.id || ""),
        byName: String(user.name || user.username || ""),
    });
    if (result.error) return sendFailure(res, { code: result.code || "invalid", error: result.error });
    const items = new Map(bank.items.map((it) => [it.itemId, it]));
    ok(res, { request: requestRow(result.request, items), profile: result.profile || "" });
});

/** Move the waiting list up now; the cards and DMs follow in the background (never awaited, never throws). */function moveUp(bankKey, itemId = 0) {
    advanceWaitlist({ bankKey, itemId }).catch(() => {});
}

/** One waiting-list entry as the "Warteliste" dialog lists it. */
function waitingRow(r, items) {
    const item = items.get(r.itemId);
    return {
        id: r.id, itemId: r.itemId, item: (item && item.name) || r.item, iconUrl: iconUrl((item && item.icon) || r.icon), amount: r.amount,
        userId: r.userId, userName: r.userName, characterName: r.characterName, realm: r.realm, purpose: r.purpose,
        createdAt: r.createdAt, position: r.position, addedByName: r.addedByName, ...linkOf(r),
    };
}

/** The bank's waiting list, each item's queue in order. */
function waitlistOf(bank) {
    const items = new Map(bank.items.map((it) => [it.itemId, it]));
    return waitlist.listForBank(bank.key).map((r) => waitingRow(r, items));
}

/** GET /api/guildbank/waitlist?key= — the bank's waiting list. */
const getGuildBankWaitlist = withUser(async ({ req, res, query }) => {
    const bank = view.bankOfServer(q.str(query, "key", { max: 200 }), activeGuildFor(req));
    if (!bank) return sendFailure(res, NOT_FOUND);
    ok(res, { entries: waitlistOf(bank) });
});

/** A write route of the waiting list: the bank of the active server, then `fn`; answers the list after the move-up. */
function waitlistWrite(fn) {
    return withUser({ write: "raids", csrf: true, body: true }, async ({ req, body, res, user }) => {
        const key = q.str(body, "key", { max: 200 });
        const { bank, failure } = writableBank(key, req);
        if (failure) return sendBankFailure(res, failure);
        const result = fn({ bank, body, by: String(user.id || ""), byName: String(user.name || user.username || "") });
        if (result && result.error) return sendFailure(res, { code: result.code || "invalid", error: result.error });
        moveUp(bank.key);
        ok(res, { ...(result || {}), entries: waitlistOf(view.bankOfServer(key, activeGuildFor(req))) });
    });
}

/** The waiting entry `id` of this bank, or an error. */
function entryOf(bank, id) {
    const entry = requestStore.getRequest(id);
    return entry && entry.status === "waiting" && entry.bankKey === bank.key ? entry : null;
}

const GONE = { code: "not_found", error: "Dieser Eintrag wartet nicht mehr." };

/** POST /api/guildbank/waitlist/add — body: { key, name, itemId, amount }. */
const addGuildBankWaiting = waitlistWrite(({ bank, body, by, byName }) => {
    const result = waitlist.addEntry(bank.key, {
        name: q.str(body, "name", { max: 40 }), userId: q.str(body, "userId", { max: 40 }), characterKey: q.str(body, "characterKey", { max: 80 }),
        itemId: q.int(body, "itemId", { fallback: 0 }), amount: body.amount, by, byName,
    });
    return result.error ? result : { added: 1 };
});

/** POST /api/guildbank/waitlist/move — body: { key, id, direction }. */
const moveGuildBankWaiting = waitlistWrite(({ bank, body }) => {
    const entry = entryOf(bank, q.str(body, "id", { max: 40 }));
    if (!entry) return GONE;
    const result = requestStore.moveWaiting(entry.id, q.str(body, "direction", { max: 10 }));
    return result.error ? result : {};
});

/** POST /api/guildbank/waitlist/remove — body: { key, id }. */
const removeGuildBankWaiting = waitlistWrite(({ bank, body }) => {
    const entry = entryOf(bank, q.str(body, "id", { max: 40 }));
    if (!entry) return GONE;
    requestStore.removeWaiting(entry.id);
    return {};
});

/** The longest text an import takes (200 lines of a sheet). */
const IMPORT_TEXT_MAX = 20000;

/** The import's picks: `{ [line]: { userId, characterKey } }` (at most one per line of the text), anything else ignored. */
function linksOf(body) {
    const raw = body && body.links;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const out = {};
    for (const [line, pick] of Object.entries(raw).slice(0, waitlist.IMPORT_MAX_LINES)) {
        if (!/^\d{1,3}$/.test(line) || !pick || typeof pick !== "object") continue;
        out[line] = { userId: q.str(pick, "userId", { max: 40 }), characterKey: q.str(pick, "characterKey", { max: 80 }) };
    }
    return out;
}

/** POST /api/guildbank/waitlist/preview — body: { key, text, links? }; stores nothing. */
const previewGuildBankWaitlist = withUser({ write: "raids", csrf: true, body: true }, async ({ req, body, res }) => {
    const key = q.str(body, "key", { max: 200 });
    const { failure } = writableBank(key, req);
    if (failure) return sendBankFailure(res, failure);
    const preview = waitlist.previewImport(key, q.str(body, "text", { max: IMPORT_TEXT_MAX }), { links: linksOf(body) });
    if (preview.error) return sendFailure(res, { code: "invalid", error: preview.error });
    ok(res, preview);
});

/** POST /api/guildbank/waitlist/import — body: { key, text, links? }; the lines the preview marks ok, at the end of their lists. */
const importGuildBankWaitlist = waitlistWrite(({ bank, body, by, byName }) => {
    const result = waitlist.importLines(bank.key, q.str(body, "text", { max: IMPORT_TEXT_MAX }), { by, byName, links: linksOf(body) });
    return result.error ? result : { added: result.added.length, skipped: result.skipped, unlinked: result.unlinked };
});

/** POST /api/guildbank/tab — hide or show a whole bank tab. */
const postGuildBankTab = withUser({ write: "raids", csrf: true, body: true }, async ({ req, body, res }) => {
    const key = q.str(body, "key", { max: 200 });
    const { failure } = writableBank(key, req);
    if (failure) return sendBankFailure(res, failure);
    const result = stockStore.setTabHidden(key, q.int(body, "index", { fallback: 0 }), q.bool(body, "hidden"));
    if (result.error) return sendFailure(res, { code: "invalid", error: result.error });
    moveUp(key);
    ok(res, { tabs: result.bank.tabs });
});

/** GET /api/settings/guild-banks */
const getGuildBanks = withUser(async ({ res }) => {
    const servers = stock.bankServers();
    const names = new Map(servers.map((s) => [s.guildId, s.label || s.name]));
    const banks = stockStore.listBanks().map((b) => ({ ...b, serverName: b.guildId ? names.get(b.guildId) || "" : "" }));
    ok(res, { banks, servers, pending: banks.filter((b) => b.pending).length });
});

/** POST /api/settings/guild-banks/assign — body: { key, guildId }. */
const assignGuildBank = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const result = stock.assignBank(body.key, body.guildId);
    if (result.error) return sendFailure(res, result);
    ok(res, { bank: result.bank });
});

/** POST /api/settings/guild-banks/delete — body: { key }. */
const deleteGuildBank = withUser({ csrf: true, body: true }, async ({ body, res }) => {
    const result = stock.removeBank(body.key);
    if (result.error) return sendFailure(res, result);
    queueItemEmojiSync();
    ok(res, { key: String(body.key || "") });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/guildbank", handler: getGuildBank, area: "raids" },
    { method: "POST", path: "/api/guildbank/item", handler: postGuildBankItem, area: "raids" },
    { method: "POST", path: "/api/guildbank/item/add", handler: addGuildBankItem, area: "raids" },
    { method: "GET", path: "/api/guildbank/item/search", handler: searchGuildBankItems, area: "raids" },
    { method: "POST", path: "/api/guildbank/tab", handler: postGuildBankTab, area: "raids" },
    { method: "GET", path: "/api/guildbank/requests", handler: getGuildBankRequests, area: "raids" },
    { method: "GET", path: "/api/guildbank/handedout", handler: getGuildBankHandedOut, area: "raids" },
    { method: "GET", path: "/api/guildbank/characters", handler: searchGuildBankCharacters, area: "raids" },
    { method: "POST", path: "/api/guildbank/characters/armory", handler: checkGuildBankCharacterArmory, area: "raids" },
    { method: "POST", path: "/api/guildbank/characters/verify", handler: verifyGuildBankCharacter, area: "raids" },
    { method: "POST", path: "/api/guildbank/request/link", handler: linkGuildBankRequest, area: "raids" },
    { method: "POST", path: "/api/guildbank/request/verify", handler: verifyGuildBankRequest, area: "raids" },
    { method: "POST", path: "/api/guildbank/request/recipient", handler: reassignGuildBankRequest, area: "raids" },
    { method: "GET", path: "/api/guildbank/waitlist", handler: getGuildBankWaitlist, area: "raids" },
    { method: "POST", path: "/api/guildbank/waitlist/add", handler: addGuildBankWaiting, area: "raids" },
    { method: "POST", path: "/api/guildbank/waitlist/move", handler: moveGuildBankWaiting, area: "raids" },
    { method: "POST", path: "/api/guildbank/waitlist/remove", handler: removeGuildBankWaiting, area: "raids" },
    { method: "POST", path: "/api/guildbank/waitlist/preview", handler: previewGuildBankWaitlist, area: "raids" },
    { method: "POST", path: "/api/guildbank/waitlist/import", handler: importGuildBankWaitlist, area: "raids" },
    { method: "GET", path: "/api/settings/guild-banks", handler: getGuildBanks, area: "settings" },
    { method: "POST", path: "/api/settings/guild-banks/assign", handler: assignGuildBank, area: "settings" },
    { method: "POST", path: "/api/settings/guild-banks/delete", handler: deleteGuildBank, area: "settings" },
];

module.exports = {
    getGuildBank, postGuildBankItem, addGuildBankItem, searchGuildBankItems, postGuildBankTab, getGuildBankRequests, getGuildBanks, assignGuildBank, deleteGuildBank,
    getGuildBankHandedOut, searchGuildBankCharacters, checkGuildBankCharacterArmory, verifyGuildBankCharacter, linkGuildBankRequest,
    verifyGuildBankRequest, reassignGuildBankRequest, getGuildBankWaitlist, addGuildBankWaiting, moveGuildBankWaiting, removeGuildBankWaiting, previewGuildBankWaitlist, importGuildBankWaitlist,
    routes,
};
