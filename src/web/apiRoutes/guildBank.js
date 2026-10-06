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
//   GET  /api/settings/guild-banks          every bank (summary) + the event servers to pick from
//   POST /api/settings/guild-banks/assign   { key, guildId } — "" takes the assignment back
//   POST /api/settings/guild-banks/delete   { key } — forget a bank with its settings
//
// The page's routes only ever touch a bank of the active server: another
// server's bank answers 404 like an unknown one. A changed item status (and a
// forgotten bank) queues the item emojis' sync (services/guildbank/itemEmojis.js)
// in the background — the answer never waits for Discord.
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
const { pendingForBank } = require("../../services/signups/guildBank");
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

/** POST /api/guildbank/tab — hide or show a whole bank tab. */
const postGuildBankTab = withUser({ write: "raids", csrf: true, body: true }, async ({ req, body, res }) => {
    const key = q.str(body, "key", { max: 200 });
    if (!view.bankOfServer(key, activeGuildFor(req))) return sendFailure(res, NOT_FOUND);
    const result = stockStore.setTabHidden(key, q.int(body, "index", { fallback: 0 }), q.bool(body, "hidden"));
    if (result.error) return sendFailure(res, { code: "invalid", error: result.error });
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
    { method: "GET", path: "/api/settings/guild-banks", handler: getGuildBanks, area: "settings" },
    { method: "POST", path: "/api/settings/guild-banks/assign", handler: assignGuildBank, area: "settings" },
    { method: "POST", path: "/api/settings/guild-banks/delete", handler: deleteGuildBank, area: "settings" },
];

module.exports = { getGuildBank, postGuildBankItem, postGuildBankTab, getGuildBankRequests, getGuildBanks, assignGuildBank, deleteGuildBank, routes };
