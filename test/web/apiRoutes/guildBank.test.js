let mockUser = { id: "1", isAdmin: true };
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../src/services/guildbank/itemMeta", () => ({
    ...jest.requireActual("../../../src/services/guildbank/itemMeta"),
    queueLookups: jest.fn(() => 0),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    listGuilds: jest.fn(() => [{ id: "g1", name: "Event-Server" }]),
}));
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({ guildId: "g1", discordServers: { eventGuilds: [{ guildId: "g1", label: "PvE" }, { guildId: "g2", label: "" }] } })),
}));

const fs = require("fs");
const { readJsonBody } = require("../../../src/web/http/apiBody");
const { activeGuildFor } = require("../../../src/web/http/activeGuild");
const { queueLookups } = require("../../../src/services/guildbank/itemMeta");
const store = require("../../../src/stores/guildBankStockStore");
const requests = require("../../../src/stores/guildBankStore");
const { parseGuildBankScan, GB_FORMAT } = require("../../../src/utils/guildbank/guildBankScan");
const {
    getGuildBank, postGuildBankItem, postGuildBankTab, getGuildBanks, assignGuildBank, deleteGuildBank,
} = require("../../../src/web/apiRoutes/guildBank");
const { AREA_BY_PATH } = require("../../../src/web/http/apiAccess");
const { mockRes, status, body } = require("../../helpers/http");
const { tempStoreFile } = require("../../helpers/tempStore");

const NOW = 1_800_000_000_000;
const REQUESTS_FILE = tempStoreFile("guild-bank.json");

function record(guild, guildId = "", { project = "tbc", items = [{ itemId: 22854, count: 3 }] } = {}) {
    const scan = parseGuildBankScan({
        format: GB_FORMAT, version: 1, client: { project }, guild: { name: guild, realm: "Spineshatter" },
        scannedAt: 1791000000, tabs: [{ index: 1, name: "A", items }, { index: 2, name: "B", items: [{ itemId: 21877, count: 5 }] }],
    });
    return store.recordScan(scan, { now: NOW, guildId }).bank;
}

/** Stored requests as #633 will write them — written straight to the file. */
function writeRequests(list) {
    fs.writeFileSync(REQUESTS_FILE, JSON.stringify({ requests: list }));
}

async function call(handler, { payload, url = "http://x/api/guildbank" } = {}) {
    if (payload) readJsonBody.mockResolvedValueOnce(payload);
    const res = mockRes();
    await handler({}, res, new URL(url));
    return res;
}

beforeAll(() => {
    store.useFile(tempStoreFile("guild-bank-stock.json"));
    requests.useFile(REQUESTS_FILE);
});
afterAll(() => {
    store.useFile(null);
    requests.useFile(null);
});
beforeEach(() => {
    jest.clearAllMocks();
    // a refused call never reads its body: drop what it left queued
    readJsonBody.mockReset();
    readJsonBody.mockResolvedValue({});
    mockUser = { id: "1", isAdmin: true };
    activeGuildFor.mockReturnValue("g1");
    for (const b of store.listBanks()) store.removeBank(b.key);
    writeRequests([]);
});

describe("apiRoutes/guildBank", () => {
    it("gates the page under raids and the assignment under settings", () => {
        expect(AREA_BY_PATH["/api/guildbank"]).toBe("raids");
        expect(AREA_BY_PATH["/api/guildbank/item"]).toBe("raids");
        expect(AREA_BY_PATH["/api/guildbank/tab"]).toBe("raids");
        expect(AREA_BY_PATH["/api/settings/guild-banks"]).toBe("settings");
        expect(AREA_BY_PATH["/api/settings/guild-banks/assign"]).toBe("settings");
        expect(AREA_BY_PATH["/api/settings/guild-banks/delete"]).toBe("settings");
    });

    describe("GET /api/guildbank", () => {
        it("answers no bank for a server without one", async () => {
            record("Fremd", "g2");
            const res = await call(getGuildBank);
            expect(body(res)).toEqual({ banks: [], bank: null });
            expect(queueLookups).not.toHaveBeenCalled();
        });

        it("shows the server's bank with reserved and available per item, and asks Wowhead for names still missing", async () => {
            const bank = record("Alpha", "g1");
            store.setItemSettings(bank.key, 22854, { status: "give", reserve: 1 });
            writeRequests([
                { id: "r1", userId: "u1", amount: 1, status: "confirmed", bankKey: bank.key, itemId: 22854 },
                { id: "r2", userId: "u2", amount: 5, status: "open", bankKey: bank.key, itemId: 22854 },
            ]);
            const data = body(await call(getGuildBank));
            expect(data.banks).toEqual([{ key: bank.key, gameVersion: "tbc", versionShort: "TBC", realm: "Spineshatter", guild: "Alpha", scannedAt: bank.scannedAt }]);
            expect(data.bank).toMatchObject({ key: bank.key, versionShort: "TBC", wowheadPath: "tbc", reservedRequests: 1 });
            expect(data.bank.items.find((i) => i.itemId === 22854)).toMatchObject({ count: 3, reserved: 1, reserve: 1, available: 1, status: "give" });
            expect(data.bank.items.find((i) => i.itemId === 21877)).toMatchObject({ count: 5, reserved: 0, available: 5, status: "new" });
            expect(queueLookups).toHaveBeenCalledWith("tbc", expect.arrayContaining([22854, 21877]));
        });

        it("picks the bank by key, else by the content version, else the first", async () => {
            const tbc = record("Alpha", "g1");
            const forever = record("Alpha", "g1", { project: "forever" });
            expect(body(await call(getGuildBank, { url: "http://x/api/guildbank?version=forever" })).bank.key).toBe(forever.key);
            expect(body(await call(getGuildBank, { url: `http://x/api/guildbank?version=forever&key=${encodeURIComponent(tbc.key)}` })).bank.key).toBe(tbc.key);
            const data = body(await call(getGuildBank, { url: "http://x/api/guildbank?version=classic" }));
            expect(data.banks).toHaveLength(2);
            expect([tbc.key, forever.key]).toContain(data.bank.key);
        });
    });

    describe("POST /api/guildbank/item", () => {
        it("changes status, reserve, limit and category and answers the item with its numbers", async () => {
            const bank = record("Alpha", "g1");
            const res = await call(postGuildBankItem, { payload: { key: bank.key, itemId: 22854, status: "give", reserve: "1", maxPerRequest: 2, category: "Tränke" } });
            expect(status(res)).toBe(200);
            expect(body(res).item).toMatchObject({ itemId: 22854, status: "give", reserve: 1, maxPerRequest: 2, category: "Tränke", group: "Tränke", available: 2 });
        });

        it("refuses wrong values, an empty change, unknown items and another server's bank", async () => {
            const bank = record("Alpha", "g1");
            const other = record("Beta", "g2");
            let res = await call(postGuildBankItem, { payload: { key: bank.key, itemId: 22854, status: "new" } });
            expect([status(res), body(res).error.code]).toEqual([400, "invalid"]);
            res = await call(postGuildBankItem, { payload: { key: bank.key, itemId: 22854, reserve: "-1" } });
            expect(status(res)).toBe(400);
            res = await call(postGuildBankItem, { payload: { key: bank.key, itemId: 22854 } });
            expect(body(res).error.message).toBe("Nichts zu ändern.");
            res = await call(postGuildBankItem, { payload: { key: bank.key, itemId: 1, status: "give" } });
            expect(status(res)).toBe(400);
            res = await call(postGuildBankItem, { payload: { key: other.key, itemId: 22854, status: "give" } });
            expect(status(res)).toBe(404);
            expect(store.getBank(other.key).items.find((i) => i.itemId === 22854).status).toBe("new");
        });

        it("needs write on raids", async () => {
            const bank = record("Alpha", "g1");
            mockUser = { id: "2", access: { raids: { read: true, write: false } } };
            const res = await call(postGuildBankItem, { payload: { key: bank.key, itemId: 22854, status: "give" } });
            expect(status(res)).toBe(403);
        });
    });

    describe("POST /api/guildbank/tab", () => {
        it("hides and shows a bank tab of the server's bank", async () => {
            const bank = record("Alpha", "g1");
            let res = await call(postGuildBankTab, { payload: { key: bank.key, index: 2, hidden: true } });
            expect(body(res).tabs.find((t) => t.index === 2).hidden).toBe(true);
            res = await call(postGuildBankTab, { payload: { key: bank.key, index: 2, hidden: false } });
            expect(body(res).tabs.find((t) => t.index === 2).hidden).toBe(false);
            res = await call(postGuildBankTab, { payload: { key: bank.key, index: 99, hidden: true } });
            expect(status(res)).toBe(400);
            activeGuildFor.mockReturnValue("g2");
            res = await call(postGuildBankTab, { payload: { key: bank.key, index: 1, hidden: true } });
            expect(status(res)).toBe(404);
        });
    });

    it("GET settings lists every bank with its server name, the servers to pick and how many wait", async () => {
        record("Alpha", "g1");
        record("Beta");
        const data = body(await call(getGuildBanks, { url: "http://x/api/settings/guild-banks" }));
        expect(data.pending).toBe(1);
        expect(data.servers).toEqual([{ guildId: "g1", name: "Event-Server", label: "PvE" }, { guildId: "g2", name: "", label: "" }]);
        expect(data.banks.map((b) => [b.guild, b.pending, b.serverName])).toEqual([["Beta", true, ""], ["Alpha", false, "PvE"]]);
        expect(data.banks[0].items).toBeUndefined();
    });

    it("POST assign sets and takes back the server, refusing unknown banks and servers", async () => {
        const bank = record("Alpha");
        let res = await call(assignGuildBank, { payload: { key: bank.key, guildId: "g2" } });
        expect(status(res)).toBe(200);
        expect(body(res).bank).toMatchObject({ guildId: "g2", pending: false });

        res = await call(assignGuildBank, { payload: { key: bank.key, guildId: "" } });
        expect(body(res).bank.pending).toBe(true);

        res = await call(assignGuildBank, { payload: { key: bank.key, guildId: "g9" } });
        expect(status(res)).toBe(400);
        expect(body(res).error.code).toBe("invalid");

        res = await call(assignGuildBank, { payload: { key: "nope", guildId: "g1" } });
        expect(status(res)).toBe(404);
    });

    it("POST delete forgets a bank, 404 for an unknown one", async () => {
        const bank = record("Alpha");
        let res = await call(deleteGuildBank, { payload: { key: bank.key } });
        expect(body(res)).toEqual({ key: bank.key });
        expect(store.getBank(bank.key)).toBeNull();

        res = await call(deleteGuildBank, { payload: { key: bank.key } });
        expect(status(res)).toBe(404);
    });
});
