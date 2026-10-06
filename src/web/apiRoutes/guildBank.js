// The guild banks the addon uploaded and which Discord server each belongs to
// (Einstellungen). A bank scanned for the first time waits for an assignment;
// until then nobody can request from it. The stock page itself (#632) reads
// the store directly.
//
//   GET  /api/settings/guild-banks          every bank (summary) + the event servers to pick from
//   POST /api/settings/guild-banks/assign   { key, guildId } — "" takes the assignment back
//   POST /api/settings/guild-banks/delete   { key } — forget a bank with its settings
const { ok } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const { sendFailure } = require("../http/apiResult");
const { listBanks } = require("../../stores/guildBankStockStore");
const stock = require("../../services/guildbank/guildBankStock");

/** GET /api/settings/guild-banks */
const getGuildBanks = withUser(async ({ res }) => {
    const servers = stock.bankServers();
    const names = new Map(servers.map((s) => [s.guildId, s.label || s.name]));
    const banks = listBanks().map((b) => ({ ...b, serverName: b.guildId ? names.get(b.guildId) || "" : "" }));
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
    ok(res, { key: String(body.key || "") });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/settings/guild-banks", handler: getGuildBanks, area: "settings" },
    { method: "POST", path: "/api/settings/guild-banks/assign", handler: assignGuildBank, area: "settings" },
    { method: "POST", path: "/api/settings/guild-banks/delete", handler: deleteGuildBank, area: "settings" },
];

module.exports = { getGuildBanks, assignGuildBank, deleteGuildBank, routes };
