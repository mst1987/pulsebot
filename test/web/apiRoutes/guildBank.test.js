jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: { id: "1" } }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/services/discord/discord", () => ({
    listGuilds: jest.fn(() => [{ id: "g1", name: "Event-Server" }]),
}));
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({ guildId: "g1", discordServers: { eventGuilds: [{ guildId: "g1", label: "PvE" }, { guildId: "g2", label: "" }] } })),
}));

const { readJsonBody } = require("../../../src/web/http/apiBody");
const store = require("../../../src/stores/guildBankStockStore");
const { parseGuildBankScan, GB_FORMAT } = require("../../../src/utils/guildbank/guildBankScan");
const { getGuildBanks, assignGuildBank, deleteGuildBank } = require("../../../src/web/apiRoutes/guildBank");
const { AREA_BY_PATH } = require("../../../src/web/http/apiAccess");
const { mockRes, status, body } = require("../../helpers/http");
const { tempStoreFile } = require("../../helpers/tempStore");

const NOW = 1_800_000_000_000;

function record(guild, guildId = "") {
    const scan = parseGuildBankScan({
        format: GB_FORMAT, version: 1, client: { project: "tbc" }, guild: { name: guild, realm: "Spineshatter" },
        scannedAt: 1791000000, tabs: [{ index: 1, name: "A", items: [{ itemId: 22854, count: 3 }] }],
    });
    return store.recordScan(scan, { now: NOW, guildId }).bank;
}

beforeAll(() => store.useFile(tempStoreFile("guild-bank-stock.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    jest.clearAllMocks();
    for (const b of store.listBanks()) store.removeBank(b.key);
});

describe("apiRoutes/guildBank", () => {
    it("is gated as a settings path", () => {
        expect(AREA_BY_PATH["/api/settings/guild-banks"]).toBe("settings");
        expect(AREA_BY_PATH["/api/settings/guild-banks/assign"]).toBe("settings");
        expect(AREA_BY_PATH["/api/settings/guild-banks/delete"]).toBe("settings");
    });

    it("GET lists every bank with its server name, the servers to pick and how many wait", async () => {
        record("Alpha", "g1");
        record("Beta");
        const res = mockRes();
        await getGuildBanks({}, res, new URL("http://x/api/settings/guild-banks"));
        const data = body(res);
        expect(data.pending).toBe(1);
        expect(data.servers).toEqual([{ guildId: "g1", name: "Event-Server", label: "PvE" }, { guildId: "g2", name: "", label: "" }]);
        expect(data.banks.map((b) => [b.guild, b.pending, b.serverName])).toEqual([["Beta", true, ""], ["Alpha", false, "PvE"]]);
        expect(data.banks[0].items).toBeUndefined();
    });

    it("POST assign sets and takes back the server, refusing unknown banks and servers", async () => {
        const bank = record("Alpha");
        readJsonBody.mockResolvedValueOnce({ key: bank.key, guildId: "g2" });
        let res = mockRes();
        await assignGuildBank({}, res);
        expect(status(res)).toBe(200);
        expect(body(res).bank).toMatchObject({ guildId: "g2", pending: false });

        readJsonBody.mockResolvedValueOnce({ key: bank.key, guildId: "" });
        res = mockRes();
        await assignGuildBank({}, res);
        expect(body(res).bank.pending).toBe(true);

        readJsonBody.mockResolvedValueOnce({ key: bank.key, guildId: "g9" });
        res = mockRes();
        await assignGuildBank({}, res);
        expect(status(res)).toBe(400);
        expect(body(res).error.code).toBe("invalid");

        readJsonBody.mockResolvedValueOnce({ key: "nope", guildId: "g1" });
        res = mockRes();
        await assignGuildBank({}, res);
        expect(status(res)).toBe(404);
    });

    it("POST delete forgets a bank, 404 for an unknown one", async () => {
        const bank = record("Alpha");
        readJsonBody.mockResolvedValueOnce({ key: bank.key });
        let res = mockRes();
        await deleteGuildBank({}, res);
        expect(body(res)).toEqual({ key: bank.key });
        expect(store.getBank(bank.key)).toBeNull();

        readJsonBody.mockResolvedValueOnce({ key: bank.key });
        res = mockRes();
        await deleteGuildBank({}, res);
        expect(status(res)).toBe(404);
    });
});
