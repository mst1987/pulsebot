// The "Warteliste" of the guild bank page (#775): list, add, move, remove,
// the import's preview and the import itself — only on the active server's
// bank, writes need raids write, and every change moves the list up at once.
let mockUser = { id: "1", name: "Orga", isAdmin: true };
jest.mock("../../../../src/web/http/apiMiddleware", () => require("../../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../../src/web/http/apiBody", () => require("../../../helpers/http").apiBodyMock());
jest.mock("../../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../../src/services/guildbank/itemMeta", () => ({
    ...jest.requireActual("../../../../src/services/guildbank/itemMeta"),
    queueLookups: jest.fn(() => 0),
}));
jest.mock("../../../../src/services/guildbank/itemEmojis", () => ({ queueItemEmojiSync: jest.fn() }));
jest.mock("../../../../src/services/discord/discord", () => ({
    listGuilds: jest.fn(() => []),
    postPayload: jest.fn(async () => ({ channelId: "900000", messageId: "m1" })),
    sendDirectMessage: jest.fn(async () => ({ ok: true })),
}));
jest.mock("../../../../src/stores/settings/settingsStore", () => ({
    getConfig: jest.fn(() => ({ guildId: "g1", discordServers: { eventGuilds: [{ guildId: "g1" }] }, serverSettings: { g1: { guildBankChannelId: "900000" } } })),
}));

const { readJsonBody } = require("../../../../src/web/http/apiBody");
const { activeGuildFor } = require("../../../../src/web/http/activeGuild");
const stockStore = require("../../../../src/stores/loot/guildBankStockStore");
const requests = require("../../../../src/stores/loot/guildBankStore");
const profiles = require("../../../../src/stores/roster/raiderProfileStore");
const { parseGuildBankScan, GB_FORMAT } = require("../../../../src/utils/guildbank/guildBankScan");
const {
    getGuildBankWaitlist, addGuildBankWaiting, moveGuildBankWaiting, removeGuildBankWaiting, previewGuildBankWaitlist, importGuildBankWaitlist,
    postGuildBankItem, getGuildBank,
} = require("../../../../src/web/apiRoutes/loot/guildBank");
const { AREA_BY_PATH } = require("../../../../src/web/http/apiAccess");
const { mockRes, status, body } = require("../../../helpers/http");
const { tempStoreFile } = require("../../../helpers/tempStore");

const SPINAL = 32470;
const PYRE = 32471;
let KEY;

function record(guild, guildId, items) {
    const scan = parseGuildBankScan({
        format: GB_FORMAT, version: 1, client: { project: "tbc" }, guild: { name: guild, realm: "Spineshatter" },
        scannedAt: 1791000000, tabs: [{ index: 1, name: "A", items }],
    });
    return stockStore.recordScan(scan, { now: 1, guildId }).bank.key;
}

async function call(handler, { payload, url = "http://x/api/guildbank/waitlist" } = {}) {
    if (payload) readJsonBody.mockResolvedValueOnce(payload);
    const res = mockRes();
    await handler({}, res, new URL(url));
    return res;
}
const list = () => call(getGuildBankWaitlist, { url: `http://x/api/guildbank/waitlist?key=${encodeURIComponent(KEY)}` });

beforeAll(() => {
    stockStore.useFile(tempStoreFile("guild-bank-stock.json"));
    requests.useFile(tempStoreFile("guild-bank.json"));
    profiles.useFile(tempStoreFile("profiles.json"));
});
afterAll(() => {
    stockStore.useFile(null);
    requests.useFile(null);
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    jest.clearAllMocks();
    readJsonBody.mockReset();
    readJsonBody.mockResolvedValue({});
    mockUser = { id: "1", name: "Orga", isAdmin: true };
    activeGuildFor.mockReturnValue("g1");
    for (const b of stockStore.listBanks()) stockStore.removeBank(b.key);
    for (const r of requests.listRequests()) requests.removeRequest(r.id);
    profiles.reset();
    KEY = record("Alpha", "g1", [{ itemId: SPINAL, count: 2 }, { itemId: PYRE, count: 1 }]);
    stockStore.setItemMeta("tbc", SPINAL, { name: "Crimson Spinal", icon: "inv_spinal" }, { source: "wowhead" });
    stockStore.setItemMeta("tbc", PYRE, { name: "Pyrestone", icon: "inv_pyre" }, { source: "wowhead" });
    stockStore.setItemSettings(KEY, SPINAL, { status: "give", reserve: 2 });
    stockStore.setItemSettings(KEY, PYRE, { status: "give", reserve: 1 });
});

describe("apiRoutes/guildBank — waiting list", () => {
    it("gates every route under raids", () => {
        for (const path of ["", "/add", "/move", "/remove", "/preview", "/import"]) expect(AREA_BY_PATH[`/api/guildbank/waitlist${path}`]).toBe("raids");
    });

    it("previews pasted lines without storing, then imports them in order", async () => {
        profiles.addCharacter("u-alina", { source: "log", name: "Alina", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] });
        const text = "Whapap\tCrimson Spinal\t1\nAlîna\tCrimson Spinal\t2\nJosh\tDragon Egg\t1";
        const preview = body(await call(previewGuildBankWaitlist, { payload: { key: KEY, text } }));
        expect(preview.rows.map((r) => [r.name, r.ok, r.match && r.match.userId])).toEqual([["Whapap", true, null], ["Alîna", true, "u-alina"], ["Josh", false, null]]);
        expect(requests.listRequests()).toEqual([]);

        const res = await call(importGuildBankWaitlist, { payload: { key: KEY, text } });
        expect(status(res)).toBe(200);
        expect(body(res)).toMatchObject({ added: 2, skipped: 1 });
        expect(body(res).entries.map((e) => [e.position, e.characterName, e.userId, e.item, e.amount, e.addedByName])).toEqual([
            [1, "Whapap", "", "Crimson Spinal", 1, "Orga"], [2, "Alina", "u-alina", "Crimson Spinal", 2, "Orga"],
        ]);
        expect(body(res).entries[0].iconUrl).toContain("inv_spinal");
        expect(status(await call(importGuildBankWaitlist, { payload: { key: KEY, text: "" } }))).toBe(400);
    });

    it("adds, moves and removes entries; answers the list after each change", async () => {
        let res = await call(addGuildBankWaiting, { payload: { key: KEY, name: "Gentle", itemId: SPINAL, amount: 2 } });
        expect(body(res)).toMatchObject({ added: 1, entries: [expect.objectContaining({ characterName: "Gentle", position: 1 })] });
        await call(addGuildBankWaiting, { payload: { key: KEY, name: "Josh", itemId: SPINAL, amount: 1 } });
        const josh = body(await list()).entries[1];
        res = await call(moveGuildBankWaiting, { payload: { key: KEY, id: josh.id, direction: "up" } });
        expect(body(res).entries.map((e) => [e.characterName, e.position])).toEqual([["Josh", 1], ["Gentle", 2]]);
        res = await call(removeGuildBankWaiting, { payload: { key: KEY, id: josh.id } });
        expect(body(res).entries.map((e) => e.characterName)).toEqual(["Gentle"]);
        // gone already, an unknown direction, a wrong add
        expect(status(await call(removeGuildBankWaiting, { payload: { key: KEY, id: josh.id } }))).toBe(404);
        const gentle = body(await list()).entries[0];
        expect(status(await call(moveGuildBankWaiting, { payload: { key: KEY, id: gentle.id, direction: "left" } }))).toBe(400);
        expect(body(await call(addGuildBankWaiting, { payload: { key: KEY, name: "", itemId: SPINAL, amount: 1 } })).error.message).toBe("Bitte einen Namen angeben.");
    });

    it("moves the list up when the orga frees stock (a lower reserve) — and the GET shows the waiting counts", async () => {
        await call(addGuildBankWaiting, { payload: { key: KEY, name: "Gentle", itemId: SPINAL, amount: 3 } });
        const page = body(await call(getGuildBank, { url: "http://x/api/guildbank" }));
        expect(page.bank.items.find((i) => i.itemId === SPINAL)).toMatchObject({ waiting: 1, waitingAmount: 3, free: 0 });
        await call(postGuildBankItem, { payload: { key: KEY, itemId: SPINAL, reserve: 0 } });
        expect(requests.listRequests().map((r) => [r.status, r.amount])).toEqual([["open", 2], ["waiting", 1]]);
        expect(body(await list()).entries.map((e) => e.amount)).toEqual([1]);
    });

    it("touches only the active server's bank and needs raids write", async () => {
        const other = record("Beta", "g2", [{ itemId: SPINAL, count: 1 }]);
        expect(status(await call(getGuildBankWaitlist, { url: `http://x/api/guildbank/waitlist?key=${encodeURIComponent(other)}` }))).toBe(404);
        expect(status(await call(addGuildBankWaiting, { payload: { key: other, name: "A", itemId: SPINAL, amount: 1 } }))).toBe(404);
        expect(status(await call(previewGuildBankWaitlist, { payload: { key: other, text: "a\tb\t1" } }))).toBe(404);
        // an entry of another bank cannot be moved through this one
        stockStore.setItemSettings(other, SPINAL, { status: "give" });
        const foreign = requests.addWaiting({ userId: "u9", bankKey: other, itemId: SPINAL, item: "x", amount: 1 }).request;
        expect(status(await call(moveGuildBankWaiting, { payload: { key: KEY, id: foreign.id, direction: "up" } }))).toBe(404);
        mockUser = { id: "2", access: { raids: { read: true, write: false } } };
        expect(status(await call(importGuildBankWaitlist, { payload: { key: KEY, text: "a\tb\t1" } }))).toBe(403);
        expect(status(await list())).toBe(200);
    });
});
