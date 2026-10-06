// POST /api/ingest/guildbank through the real router: the token gate, the
// parser's refusals, the store behind it and the Wowhead lookups that start
// only after the answer.
const { mockRes, status, json, jsonRequest } = require("../../helpers/http");

// The uploader is a machine: no session anywhere.
jest.mock("../../../src/web/http/auth", () => ({
    getUser: jest.fn(() => null),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(() => true),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../src/stores/ingestTokenStore", () => ({
    verifyToken: jest.fn(),
    touchToken: jest.fn(),
    bearerFrom: jest.requireActual("../../../src/stores/ingestTokenStore").bearerFrom,
}));
jest.mock("../../../src/services/guildbank/itemMeta", () => ({
    ...jest.requireActual("../../../src/services/guildbank/itemMeta"),
    queueLookups: jest.fn(() => 0),
}));
jest.mock("../../../src/services/guildbank/itemEmojis", () => ({ queueItemEmojiSync: jest.fn() }));
// Two event servers: a new bank cannot know its own and waits.
jest.mock("../../../src/services/discord/guildRoles", () => ({
    ...jest.requireActual("../../../src/services/discord/guildRoles"),
    eventGuildIds: jest.fn(() => ["g1", "g2"]),
}));

const { eventGuildIds } = require("../../../src/services/discord/guildRoles");
const { verifyToken, touchToken } = require("../../../src/stores/ingestTokenStore");
const { queueLookups } = require("../../../src/services/guildbank/itemMeta");
const { queueItemEmojiSync } = require("../../../src/services/guildbank/itemEmojis");
const store = require("../../../src/stores/guildBankStockStore");
const { handle } = require("../../../src/web/http/apiRouter");
const { GB_FORMAT } = require("../../../src/utils/guildbank/guildBankScan");
const { tempStoreFile } = require("../../helpers/tempStore");

const TOKEN = { id: "t1", name: "Raidlead-PC" };
const KEY = "tbc:spineshatter:die gilde";

const scan = (over = {}) => ({
    format: GB_FORMAT,
    version: 1,
    generatedAt: 1791000100,
    client: { project: "tbc", build: "2.5.5" },
    guild: { name: "Die Gilde", realm: "Spineshatter", faction: "Alliance" },
    scannedBy: "Gemli",
    scannedAt: 1791000000,
    money: 12345678,
    tabs: [
        { index: 1, name: "Edelsteine", items: [{ itemId: 24027, count: 14, slot: 1 }] },
        { index: 2, name: "Verbrauch", items: [{ itemId: 22854, count: 40, slot: 1 }, { itemId: 21877, count: 340, slot: 2 }] },
    ],
    ...over,
});

async function upload(payload, authorization = "Bearer ehl_good") {
    const req = jsonRequest("POST", "/api/ingest/guildbank", payload, authorization ? { authorization } : {});
    const res = mockRes();
    await handle("/api/ingest/guildbank", req, res);
    return res;
}

beforeAll(() => store.useFile(tempStoreFile("guild-bank-stock.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    jest.clearAllMocks();
    verifyToken.mockReturnValue(TOKEN);
    for (const b of store.listBanks()) store.removeBank(b.key);
});

describe("POST /api/ingest/guildbank", () => {
    it("refuses an upload without a token, and with an unknown one", async () => {
        let res = await upload(scan(), null);
        expect(status(res)).toBe(401);
        expect(json(res).error.code).toBe("no_token");
        verifyToken.mockReturnValue(null);
        res = await upload(scan());
        expect(status(res)).toBe(401);
        expect(json(res).error.code).toBe("bad_token");
        expect(store.listBanks()).toEqual([]);
        expect(touchToken).not.toHaveBeenCalled();
    });

    it("stores a scan from a valid token as a bank waiting for assignment, then queues the lookups", async () => {
        const res = await upload(scan());
        expect(status(res)).toBe(201);
        expect(json(res).data).toEqual({
            status: "created", bankKey: KEY, gameVersion: "tbc", guild: "Die Gilde", realm: "Spineshatter",
            pending: true, scannedAt: 1791000000000, tabs: 2, items: 3, newItems: 3,
        });
        expect(touchToken).toHaveBeenCalledWith("t1");
        expect(queueLookups).toHaveBeenCalledWith("tbc", expect.arrayContaining([24027, 22854, 21877]));
        // The answer went out before the lookups were queued.
        expect(queueLookups.mock.invocationCallOrder[0]).toBeGreaterThan(res.end.mock.invocationCallOrder[0]);

        const bank = store.getBank(KEY);
        expect(bank).toMatchObject({ uploadedBy: "Raidlead-PC", scannedBy: "Gemli", money: 12345678 });
        expect(bank.items.map((i) => [i.itemId, i.count, i.status]).sort()).toEqual([
            [21877, 340, "new"], [22854, 40, "new"], [24027, 14, "new"],
        ]);
    });

    it("gives a new bank to the only event server", async () => {
        eventGuildIds.mockReturnValue(["g1"]);
        const res = await upload(scan());
        expect(json(res).data.pending).toBe(false);
        expect(store.getBank(KEY).guildId).toBe("g1");
        eventGuildIds.mockReturnValue(["g1", "g2"]);
    });

    it("keeps the orga's decisions over the next upload", async () => {
        await upload(scan());
        // nothing offered yet: no emoji sync
        expect(queueItemEmojiSync).not.toHaveBeenCalled();
        store.setItemSettings(KEY, 22854, { status: "give", reserve: 5 });
        const res = await upload(scan({ scannedAt: 1791003600, tabs: [{ index: 2, name: "Verbrauch", items: [{ itemId: 22854, count: 12 }] }] }));
        expect(json(res).data).toMatchObject({ status: "updated", newItems: 0, items: 1 });
        // an item already on "give": its emoji is synced in the background (#633)
        expect(queueItemEmojiSync).toHaveBeenCalledTimes(1);
        const items = Object.fromEntries(store.getBank(KEY).items.map((i) => [i.itemId, i]));
        expect(items[22854]).toMatchObject({ count: 12, status: "give", reserve: 5 });
        expect(items[21877]).toMatchObject({ count: 0, status: "new" });
    });

    it("answers a late upload of an older scan as stale and changes nothing", async () => {
        await upload(scan({ scannedAt: 1791003600 }));
        queueLookups.mockClear();
        const res = await upload(scan());
        expect(status(res)).toBe(201);
        expect(json(res).data.status).toBe("stale");
        expect(queueLookups).not.toHaveBeenCalled();
    });

    it("refuses what is no scan and a newer format, and stores nothing", async () => {
        let res = await upload({ format: "eventhelper-loot", version: 1 });
        expect(status(res)).toBe(400);
        expect(json(res).error.code).toBe("parse_failed");
        res = await upload(scan({ version: 2 }));
        expect(status(res)).toBe(400);
        expect(json(res).error.message).toMatch(/Format v2, unterstützt wird v1/);
        res = await upload(undefined);
        expect(status(res)).toBe(400);
        expect(store.listBanks()).toEqual([]);
        expect(touchToken).not.toHaveBeenCalled();
    });
});
