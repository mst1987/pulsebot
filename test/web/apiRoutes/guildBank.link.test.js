// Linking a guild bank request to a profile character in the web, the
// character search behind the link dialog, and the "Ausgegeben" tab's list —
// only on the active server's bank; linking and searching need raids write.
let mockUser = { id: "1", name: "Orga", isAdmin: true };
jest.mock("../../../src/web/http/apiMiddleware", () => require("../../helpers/http").apiMiddlewareMock({ user: () => mockUser }));
jest.mock("../../../src/web/http/apiBody", () => require("../../helpers/http").apiBodyMock());
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../src/services/guildbank/itemMeta", () => ({
    ...jest.requireActual("../../../src/services/guildbank/itemMeta"),
    queueLookups: jest.fn(() => 0),
}));
jest.mock("../../../src/services/guildbank/itemEmojis", () => ({ queueItemEmojiSync: jest.fn() }));
jest.mock("../../../src/services/discord/discord", () => ({
    listGuilds: jest.fn(() => []),
    postPayload: jest.fn(async () => ({ channelId: "900000", messageId: "m1" })),
    editPayload: jest.fn(async () => ({})),
    sendDirectMessage: jest.fn(async () => ({ ok: true })),
}));
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({ guildId: "g1", discordServers: { eventGuilds: [{ guildId: "g1" }], guildBankChannelId: "900000" } })),
}));

const discord = require("../../../src/services/discord/discord");
const { readJsonBody } = require("../../../src/web/http/apiBody");
const { activeGuildFor } = require("../../../src/web/http/activeGuild");
const stockStore = require("../../../src/stores/guildBankStockStore");
const requests = require("../../../src/stores/guildBankStore");
const profiles = require("../../../src/stores/raiderProfileStore");
const { parseGuildBankScan, GB_FORMAT } = require("../../../src/utils/guildbank/guildBankScan");
const {
    linkGuildBankRequest, searchGuildBankCharacters, getGuildBankHandedOut, getGuildBankRequests, getGuildBankWaitlist, importGuildBankWaitlist,
    previewGuildBankWaitlist, addGuildBankWaiting, getGuildBank,
} = require("../../../src/web/apiRoutes/guildBank");
const { AREA_BY_PATH } = require("../../../src/web/http/apiAccess");
const { mockRes, status, body } = require("../../helpers/http");
const { tempStoreFile } = require("../../helpers/tempStore");

const SPINAL = 32470;
let KEY;

function record(guild, guildId, items) {
    const scan = parseGuildBankScan({
        format: GB_FORMAT, version: 1, client: { project: "tbc" }, guild: { name: guild, realm: "Spineshatter" },
        scannedAt: 1791000000, tabs: [{ index: 1, name: "A", items }],
    });
    return stockStore.recordScan(scan, { now: 1, guildId }).bank.key;
}

async function call(handler, { payload, url = "http://x/api/guildbank" } = {}) {
    if (payload) readJsonBody.mockResolvedValueOnce(payload);
    const res = mockRes();
    await handler({}, res, new URL(url));
    return res;
}
const q = (path, params) => `http://x/api/guildbank/${path}?${new URLSearchParams(params)}`;

/** A waiting-list entry imported by name alone (no Discord account) — not linked. */
const imported = () => requests.addWaiting({ characterName: "Whapap", item: "Crimson Spinal", amount: 1, bankKey: KEY, itemId: SPINAL, addedBy: "o1" }).request;

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
    KEY = record("Alpha", "g1", [{ itemId: SPINAL, count: 2 }]);
    stockStore.setItemMeta("tbc", SPINAL, { name: "Crimson Spinal", icon: "inv_spinal" }, { source: "wowhead" });
    // all of it kept back: nothing is free, the waiting list stays
    stockStore.setItemSettings(KEY, SPINAL, { status: "give", reserve: 2 });
    profiles.addCharacter("u7", { name: "Whapap", className: "Mage", realm: "Spineshatter", specs: [{ key: "Mage-Frost", gear: "ready" }] }, { name: "Wha" });
    profiles.addCharacter("u8", { name: "Skerra", className: "Rogue" }, { name: "Sk" });
});

describe("apiRoutes/guildBank — linking and the hand-out history", () => {
    it("gates the new routes under raids", () => {
        for (const path of ["/api/guildbank/handedout", "/api/guildbank/characters", "/api/guildbank/request/link"]) expect(AREA_BY_PATH[path]).toBe("raids");
    });

    it("the waiting list and the requests say whether an entry is linked", async () => {
        const entry = imported();
        let res = await call(getGuildBankWaitlist, { url: q("waitlist", { key: KEY }) });
        expect(body(res).entries).toEqual([expect.objectContaining({ id: entry.id, userId: "", linked: false })]);
        requests.promoteWaiting(entry.id, 1);
        res = await call(getGuildBankRequests, { url: q("requests", { key: KEY }) });
        expect(body(res).requests).toEqual([expect.objectContaining({ id: entry.id, linked: false })]);
    });

    it("searches the profile characters for the link dialog (write only, the active server's bank)", async () => {
        let res = await call(searchGuildBankCharacters, { url: q("characters", { key: KEY, q: "wha" }) });
        expect(status(res)).toBe(200);
        expect(body(res).characters).toEqual([expect.objectContaining({ userId: "u7", characterKey: "whapap", characterName: "Whapap", userName: "Wha", ownVersion: true })]);
        res = await call(searchGuildBankCharacters, { url: q("characters", { key: KEY }) });
        expect(body(res).characters.map((c) => c.characterName)).toEqual(["Skerra", "Whapap"]);
        res = await call(searchGuildBankCharacters, { url: q("characters", { key: "nope" }) });
        expect(status(res)).toBe(404);
        mockUser = { id: "2", name: "Leser", areas: { raids: "read" } };
        res = await call(searchGuildBankCharacters, { url: q("characters", { key: KEY }) });
        expect(status(res)).toBe(403);
    });

    it("links a waiting entry to a profile character and answers the row; an open one gets its card redrawn", async () => {
        const entry = imported();
        let res = await call(linkGuildBankRequest, { payload: { key: KEY, id: entry.id, userId: "u7", characterKey: "whapap" } });
        expect(status(res)).toBe(200);
        expect(body(res).request).toMatchObject({ id: entry.id, userId: "u7", userName: "Wha", characterName: "Whapap", realm: "Spineshatter", linked: true });
        expect(discord.editPayload).not.toHaveBeenCalled();

        // relink an open request with a posted card to another character
        requests.promoteWaiting(entry.id, 1);
        requests.setMessage(entry.id, { channelId: "900000", messageId: "m9" });
        res = await call(linkGuildBankRequest, { payload: { key: KEY, id: entry.id, userId: "u8", characterKey: "skerra" } });
        expect(body(res).request).toMatchObject({ userId: "u8", characterName: "Skerra", realm: "Spineshatter", linked: true });
        expect(discord.editPayload).toHaveBeenCalledWith("900000", "m9", expect.anything());
    });

    it("refuses another server's bank, an unknown request, a character the profile does not have and a reader", async () => {
        const entry = imported();
        let res = await call(linkGuildBankRequest, { payload: { key: "nope", id: entry.id, userId: "u7", characterKey: "whapap" } });
        expect(status(res)).toBe(404);
        res = await call(linkGuildBankRequest, { payload: { key: KEY, id: "nope", userId: "u7", characterKey: "whapap" } });
        expect(status(res)).toBe(404);
        res = await call(linkGuildBankRequest, { payload: { key: KEY, id: entry.id, userId: "u7", characterKey: "skerra" } });
        expect(status(res)).toBe(400);
        activeGuildFor.mockReturnValue("g2");
        res = await call(linkGuildBankRequest, { payload: { key: KEY, id: entry.id, userId: "u7", characterKey: "whapap" } });
        expect(status(res)).toBe(404);
        activeGuildFor.mockReturnValue("g1");
        mockUser = { id: "2", name: "Leser", areas: { raids: "read" } };
        res = await call(linkGuildBankRequest, { payload: { key: KEY, id: entry.id, userId: "u7", characterKey: "whapap" } });
        expect(status(res)).toBe(403);
        expect(requests.getRequest(entry.id).userId).toBe("");
    });

    it("the import takes the orga's picks per line and says how many land unlinked", async () => {
        const text = "Whappy\tCrimson Spinal\t1\nNiemand\tCrimson Spinal\t1";
        const links = { 1: { userId: "u7", characterKey: "whapap" }, junk: { userId: "u8" }, 2: "x" };
        let res = await call(previewGuildBankWaitlist, { payload: { key: KEY, text, links } });
        expect(body(res).rows.map((r) => [r.linked, r.picked])).toEqual([[true, true], [false, false]]);
        res = await call(importGuildBankWaitlist, { payload: { key: KEY, text, links } });
        expect(body(res)).toMatchObject({ added: 2, skipped: 0, unlinked: 1 });
        expect(body(res).entries.map((e) => [e.characterName, e.linked])).toEqual([["Whapap", true], ["Niemand", false]]);
    });

    it("adds an entry for a picked character", async () => {
        const res = await call(addGuildBankWaiting, { payload: { key: KEY, userId: "u8", characterKey: "skerra", itemId: SPINAL, amount: 1 } });
        expect(status(res)).toBe(200);
        expect(body(res).entries).toEqual([expect.objectContaining({ userId: "u8", characterName: "Skerra", linked: true })]);
    });

    it("lists the handed-out requests newest first and counts them in the bank", async () => {
        stockStore.recordScan(parseGuildBankScan({
            format: GB_FORMAT, version: 1, client: { project: "tbc" }, guild: { name: "Alpha", realm: "Spineshatter" },
            scannedAt: 1791000100, tabs: [{ index: 1, name: "A", items: [{ itemId: SPINAL, count: 5 }] }],
        }), { now: 2, guildId: "g1" });
        const ask = (userId, name) => requests.addRequest({ userId, userName: name, item: "Crimson Spinal", amount: 2, bankKey: KEY, itemId: SPINAL, icon: "inv_spinal", characterName: "Whapap", realm: "Spineshatter" }).request;
        const a = ask("u7", "Wha");
        const b = ask("u8", "Sk");
        for (const r of [a, b]) requests.confirmRequest(r.id, { byName: "Arthas" });
        requests.handOutRequest(a.id, { byName: "Jaina", via: "mail" }, { now: 1000 });
        requests.handOutRequest(b.id, { byName: "Arthas", via: "manual" }, { now: 2000 });
        let res = await call(getGuildBankHandedOut, { url: q("handedout", { key: KEY }) });
        expect(status(res)).toBe(200);
        expect(body(res).requests).toEqual([
            expect.objectContaining({ id: b.id, handoutVia: "manual", handedOutByName: "Arthas", handedOutAt: 2000, confirmedByName: "Arthas", fromWaitlist: false }),
            expect.objectContaining({ id: a.id, handoutVia: "mail", handedOutByName: "Jaina", item: "Crimson Spinal", characterName: "Whapap", realm: "Spineshatter" }),
        ]);
        expect(body(res).requests[0].iconUrl).toContain("inv_spinal");
        res = await call(getGuildBank, { url: q("", { key: KEY }) });
        expect(body(res).bank.handedOutRequests).toBe(2);
        res = await call(getGuildBankHandedOut, { url: q("handedout", { key: "nope" }) });
        expect(status(res)).toBe(404);
    });
});
