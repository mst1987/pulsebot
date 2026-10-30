// POST /api/guildbank/item/add and GET /api/guildbank/item/search.
let mockUser = { id: "1", isAdmin: true };
jest.mock("../../../../src/web/http/apiMiddleware", () => require("../../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../../src/web/http/apiBody", () => require("../../../helpers/http").apiBodyMock());
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../../src/services/guildbank/itemMeta", () => ({
    ...jest.requireActual("../../../../src/services/guildbank/itemMeta"),
    queueLookups: jest.fn(() => 0),
}));
jest.mock("../../../../src/services/guildbank/itemEmojis", () => ({ queueItemEmojiSync: jest.fn() }));
jest.mock("../../../../src/services/signups/guildBank", () => ({
    ...jest.requireActual("../../../../src/services/signups/guildBank"),
    advanceWaitlist: jest.fn(() => Promise.resolve()),
}));
jest.mock("../../../../src/utils/loot/wowhead", () => ({
    ...jest.requireActual("../../../../src/utils/loot/wowhead"),
    searchItems: jest.fn(),
}));

const { readJsonBody } = require("../../../../src/web/http/apiBody");
const { activeGuildFor } = require("../../../../src/web/http/activeGuild");
const wowhead = require("../../../../src/utils/loot/wowhead");
const { queueItemEmojiSync } = require("../../../../src/services/guildbank/itemEmojis");
const { advanceWaitlist } = require("../../../../src/services/signups/guildBank");
const stockStore = require("../../../../src/stores/loot/guildBankStockStore");
const requests = require("../../../../src/stores/loot/guildBankStore");
const { addGuildBankItem, searchGuildBankItems } = require("../../../../src/web/apiRoutes/loot/guildBank");
const { AREA_BY_PATH } = require("../../../../src/web/http/apiAccess");
const { mockRes, status, body } = require("../../../helpers/http");
const { tempStoreFile } = require("../../../helpers/tempStore");

const SPINEL = { id: 32227, name: "Crimson Spinel", icon: "inv_x", iconUrl: "u", quality: 4 };

function record(guild, guildId) {
    return stockStore.recordScan({
        key: `tbc:spineshatter:${guild.toLowerCase()}`, gameVersion: "tbc", realm: "Spineshatter", guild, faction: "Horde", scannedAt: 1, tabs: [], items: {},
    }, { now: 1, guildId }).bank;
}

async function call(handler, { payload, url = "http://x/api/guildbank/item/add" } = {}) {
    if (payload) readJsonBody.mockResolvedValueOnce(payload);
    const res = mockRes();
    await handler({}, res, new URL(url));
    return res;
}

beforeAll(() => {
    stockStore.useFile(tempStoreFile("guild-bank-stock.json"));
    requests.useFile(tempStoreFile("guild-bank.json"));
});
afterAll(() => {
    stockStore.useFile(null);
    requests.useFile(null);
});
beforeEach(() => {
    jest.clearAllMocks();
    readJsonBody.mockReset();
    readJsonBody.mockResolvedValue({});
    mockUser = { id: "1", isAdmin: true };
    activeGuildFor.mockReturnValue("g1");
    for (const b of stockStore.listBanks()) stockStore.removeBank(b.key);
});

describe("apiRoutes/guildBank item add", () => {
    it("is gated under raids", () => {
        expect(AREA_BY_PATH["/api/guildbank/item/add"]).toBe("raids");
        expect(AREA_BY_PATH["/api/guildbank/item/search"]).toBe("raids");
    });

    it("adds an item by id: offered at once, emoji sync and waiting list woken", async () => {
        const bank = record("Alpha", "g1");
        const res = await call(addGuildBankItem, { payload: { key: bank.key, query: "32227" } });
        expect(status(res)).toBe(200);
        expect(body(res)).toMatchObject({ created: true, item: { itemId: 32227, count: 0, status: "give", addedByHand: true } });
        expect(queueItemEmojiSync).toHaveBeenCalledTimes(1);
        expect(advanceWaitlist).toHaveBeenCalledWith({ bankKey: bank.key, itemId: 32227 });
    });

    it("answers 400 ambiguous with the hits when a name fits several items", async () => {
        const bank = record("Alpha", "g1");
        wowhead.searchItems.mockResolvedValue([SPINEL, { ...SPINEL, id: 2, name: "Runed Crimson Spinel" }]);
        const res = await call(addGuildBankItem, { payload: { key: bank.key, query: "Spinel" } });
        expect(status(res)).toBe(400);
        expect(body(res).error.code).toBe("ambiguous");
        expect(queueItemEmojiSync).not.toHaveBeenCalled();
    });

    it("refuses bad input, another server's bank and a raider without write right", async () => {
        const bank = record("Alpha", "g1");
        const other = record("Beta", "g2");
        let res = await call(addGuildBankItem, { payload: { key: bank.key, query: "" } });
        expect([status(res), body(res).error.code]).toEqual([400, "invalid"]);
        res = await call(addGuildBankItem, { payload: { key: other.key, query: "32227" } });
        expect(status(res)).toBe(404);
        expect(stockStore.getBank(other.key).counts.items).toBe(0);
        mockUser = { id: "2", isAdmin: false, permissions: { raids: "read" } };
        res = await call(addGuildBankItem, { payload: { key: bank.key, query: "32227" } });
        expect(status(res)).toBe(403);
    });

    it("searches Wowhead for the bank's version", async () => {
        const bank = record("Alpha", "g1");
        wowhead.searchItems.mockResolvedValue([SPINEL]);
        const res = await call(searchGuildBankItems, { url: `http://x/api/guildbank/item/search?key=${encodeURIComponent(bank.key)}&q=Crimson` });
        expect(body(res)).toEqual({ items: [SPINEL] });
        expect(wowhead.searchItems).toHaveBeenCalledWith("Crimson", expect.objectContaining({ path: "tbc" }));
        const gone = await call(searchGuildBankItems, { url: "http://x/api/guildbank/item/search?key=nope&q=Crimson" });
        expect(status(gone)).toBe(404);
    });
});
