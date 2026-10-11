// The guild bank stock: the page "Gildenbank" (#632) and the assignment of a
// bank to a Discord server (Einstellungen). A bank scanned for the first time
// goes to the one event server, or waits for an assignment when there are
// several; until then nobody can request from it.
//
//   GET  /api/guildbank                     the banks of the active server and the one shown
//                                           (?key= one of them, else ?version= the content
//                                           switch's, else the first) with its items
//   POST /api/guildbank/item                { key, itemId, status?, reserve?, maxPerRequest?, category? }
//   POST /api/guildbank/tab                 { key, index, hidden } — hide or show a whole bank tab
//   GET  /api/guildbank/requests?key=       the bank's open and confirmed requests (the "Anfragen" dialog)
//   GET  /api/guildbank/waitlist?key=       the bank's waiting list (#775, the "Warteliste" dialog)
//   POST /api/guildbank/waitlist/add        { key, name, itemId, amount } — an entry at the end of the item's list
//   POST /api/guildbank/waitlist/move       { key, id, direction: "up" | "down" }
//   POST /api/guildbank/waitlist/remove     { key, id }
//   POST /api/guildbank/waitlist/preview    { key, text } — the import's rows (nothing stored)
//   POST /api/guildbank/waitlist/import     { key, text } — pasted lines "Name<Tab>Item<Tab>Anzahl" (also ; or ,)
//   GET  /api/settings/guild-banks          every bank (summary) + the event servers to pick from
//   POST /api/settings/guild-banks/assign   { key, guildId } — "" takes the assignment back
//   POST /api/settings/guild-banks/delete   { key } — forget a bank with its settings
//
// The page's routes only ever touch a bank of the active server: another
// server's bank answers 404 like an unknown one. A changed item status (and a
// forgotten bank) queues the item emojis' sync (services/guildbank/itemEmojis.js)
// in the background — the answer never waits for Discord. So does the waiting
// list's move-up (services/signups/guildBank.advanceWaitlist): every change to
// an item, a tab or the list moves it up at once and posts the orga cards and
// DMs afterwards; the answer already shows the list after the move.
const { ok } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { sendFailure } = require("../http/apiResult");
const { q } = require("../http/apiParams");
const { activeGuildFor } = require("../http/activeGuild");
const { resolveVersionQuery } = require("../../services/events/mainVersion");
const stockStore = require("../../stores/guildBankStockStore");
const stock = require("../../services/guildbank/guildBankStock");
const view = require("../../services/guildbank/stockView");
const { queueLookups } = require("../../services/guildbank/itemMeta");
const { queueItemEmojiSync } = require("../../services/guildbank/itemEmojis");
const { pendingForBank, advanceWaitlist } = require("../../services/signups/guildBank");
const waitlist = require("../../services/guildbank/waitlist");
const requestStore = require("../../stores/guildBankStore");
const { iconUrl } = require("../../utils/loot/wowhead");

const NOT_FOUND = { code: "not_found", error: "Gildenbank nicht gefunden." };

/** GET /api/guildbank */
const getGuildBank = withUser(async ({ req, res, query }) => {
    const guildId = activeGuildFor(req);
    const { versionId } = resolveVersionQuery(query.get("version"));
    const { banks, bank } = view.stockForServer(guildId, { key: q.str(query, "key", { max: 200 }), versionId });
    // Items still without a current Wowhead answer (a lookup failed, the bot
    // restarted, German names stored before) are asked again in the
    // background — at most once per item within itemMeta's retry pause.
    if (bank) queueLookups(bank.gameVersion, stockStore.itemsWithoutWowheadMeta(bank.key));
    ok(res, { banks, bank });
});

/** POST /api/guildbank/item — what the orga decided for one item. */
const postGuildBankItem = withUser({ write: "raids", csrf: true, body: true }, async ({ req, body, res }) => {
    const key = q.str(body, "key", { max: 200 });
    if (!view.bankOfServer(key, activeGuildFor(req))) return sendFailure(res, NOT_FOUND);
    const patch = {};
    for (const field of ["status", "reserve", "maxPerRequest", "category"]) {
        if (body[field] !== undefined) patch[field] = field === "status" || field === "category" ? q.str(body, field) : body[field];
    }
    if (!Object.keys(patch).length) return sendFailure(res, { code: "invalid", error: "Nichts zu ändern." });
    const result = stockStore.setItemSettings(key, q.int(body, "itemId", { fallback: 0 }), patch);
    if (result.error) return sendFailure(res, { code: "invalid", error: result.error });
    if (patch.status !== undefined) queueItemEmojiSync();
    // a new status or reserve may free stock for the waiting list
    moveUp(key, q.int(body, "itemId", { fallback: 0 }));
    ok(res, { item: view.itemForPage(key, result.item) });
});

/** One request as the page's "Anfragen" dialog lists it. */
function requestRow(r, items) {
    const item = items.get(r.itemId);
    const icon = (item && item.icon) || r.icon;
    return {
        id: r.id, itemId: r.itemId, item: (item && item.name) || r.item, iconUrl: iconUrl(icon), amount: r.amount,
        userId: r.userId, userName: r.userName, characterName: r.characterName, realm: r.realm, purpose: r.purpose,
        status: r.status, createdAt: r.createdAt, handledByName: r.handledByName, handledAt: r.handledAt,
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

/** Move the waiting list up now; the cards and DMs follow in the background (never awaited, never throws). */
function moveUp(bankKey, itemId = 0) {
    advanceWaitlist({ bankKey, itemId }).catch(() => {});
}

/** One waiting-list entry as the "Warteliste" dialog lists it. */
function waitingRow(r, items) {
    const item = items.get(r.itemId);
    return {
        id: r.id, itemId: r.itemId, item: (item && item.name) || r.item, iconUrl: iconUrl((item && item.icon) || r.icon), amount: r.amount,
        userId: r.userId, userName: r.userName, characterName: r.characterName, realm: r.realm, purpose: r.purpose,
        createdAt: r.createdAt, position: r.position, addedByName: r.addedByName,
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
        const bank = view.bankOfServer(key, activeGuildFor(req));
        if (!bank) return sendFailure(res, NOT_FOUND);
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
        name: q.str(body, "name", { max: 40 }), itemId: q.int(body, "itemId", { fallback: 0 }), amount: body.amount, by, byName,
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

/** POST /api/guildbank/waitlist/preview — body: { key, text }; stores nothing. */
const previewGuildBankWaitlist = withUser({ write: "raids", csrf: true, body: true }, async ({ req, body, res }) => {
    const bank = view.bankOfServer(q.str(body, "key", { max: 200 }), activeGuildFor(req));
    if (!bank) return sendFailure(res, NOT_FOUND);
    ok(res, waitlist.previewImport(bank.key, q.str(body, "text", { max: IMPORT_TEXT_MAX })));
});

/** POST /api/guildbank/waitlist/import — body: { key, text }; the lines the preview marks ok, at the end of their lists. */
const importGuildBankWaitlist = waitlistWrite(({ bank, body, by, byName }) => {
    const result = waitlist.importLines(bank.key, q.str(body, "text", { max: IMPORT_TEXT_MAX }), { by, byName });
    return result.error ? result : { added: result.added.length, skipped: result.skipped };
});

/** POST /api/guildbank/tab — hide or show a whole bank tab. */
const postGuildBankTab = withUser({ write: "raids", csrf: true, body: true }, async ({ req, body, res }) => {
    const key = q.str(body, "key", { max: 200 });
    if (!view.bankOfServer(key, activeGuildFor(req))) return sendFailure(res, NOT_FOUND);
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
    { method: "POST", path: "/api/guildbank/tab", handler: postGuildBankTab, area: "raids" },
    { method: "GET", path: "/api/guildbank/requests", handler: getGuildBankRequests, area: "raids" },
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
    getGuildBank, postGuildBankItem, postGuildBankTab, getGuildBankRequests, getGuildBanks, assignGuildBank, deleteGuildBank,
    getGuildBankWaitlist, addGuildBankWaiting, moveGuildBankWaiting, removeGuildBankWaiting, previewGuildBankWaitlist, importGuildBankWaitlist,
    routes,
};
