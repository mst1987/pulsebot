// Confirming characters in the guild bank's link dialog: every choice carries
// its evidence, "Im Arsenal prüfen" asks the armory (mocked) and stores an
// answer, "Im Spiel geprüft" stores the orga's check — only on the active
// server's bank, only with raids write; requests and waiting entries say why
// they are not linked ("none" / "unverified").
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
jest.mock("../../../src/web/characters/profileView", () => ({
    ...jest.requireActual("../../../src/web/characters/profileView"),
    lookupArmory: jest.fn(),
}));

const { readJsonBody } = require("../../../src/web/http/apiBody");
const { activeGuildFor } = require("../../../src/web/http/activeGuild");
const { lookupArmory } = require("../../../src/web/characters/profileView");
const stockStore = require("../../../src/stores/guildBankStockStore");
const requests = require("../../../src/stores/guildBankStore");
const profiles = require("../../../src/stores/raiderProfileStore");
const { parseGuildBankScan, GB_FORMAT } = require("../../../src/utils/guildbank/guildBankScan");
const {
    searchGuildBankCharacters, checkGuildBankCharacterArmory, verifyGuildBankCharacter, linkGuildBankRequest, getGuildBankWaitlist, getGuildBankRequests,
    previewGuildBankWaitlist,
} = require("../../../src/web/apiRoutes/guildBank");
const { AREA_BY_PATH } = require("../../../src/web/http/apiAccess");
const { mockRes, status, body } = require("../../helpers/http");
const { tempStoreFile } = require("../../helpers/tempStore");

const SPINAL = 32470;
let KEY;

async function call(handler, { payload, url = "http://x/api/guildbank" } = {}) {
    if (payload) readJsonBody.mockResolvedValueOnce(payload);
    const res = mockRes();
    await handler({}, res, new URL(url));
    return res;
}
const q = (path, params) => `http://x/api/guildbank/${path}?${new URLSearchParams(params)}`;

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
    lookupArmory.mockResolvedValue({ url: "https://armory/x", fetched: false, className: "", level: null, guild: "" });
    for (const b of stockStore.listBanks()) stockStore.removeBank(b.key);
    for (const r of requests.listRequests()) requests.removeRequest(r.id);
    profiles.reset();
    KEY = stockStore.recordScan(parseGuildBankScan({
        format: GB_FORMAT, version: 1, client: { project: "tbc" }, guild: { name: "Alpha", realm: "Spineshatter" },
        scannedAt: 1791000000, tabs: [{ index: 1, name: "A", items: [{ itemId: SPINAL, count: 2 }] }],
    }), { now: 1, guildId: "g1" }).bank.key;
    stockStore.setItemMeta("tbc", SPINAL, { name: "Crimson Spinal", icon: "inv_spinal" }, { source: "wowhead" });
    stockStore.setItemSettings(KEY, SPINAL, { status: "give", reserve: 2 });
    // the raider Gentle: "Gentle" typed at a signup, "Gentleowl" and "Gentletwowl" from the logs
    profiles.addCharacter("u3", { name: "Gentle", className: "Druid" }, { name: "Gentle" });
    profiles.addCharacter("u3", { source: "log", name: "Gentleowl", className: "Druid" });
    profiles.addCharacter("u3", { source: "log", name: "Gentletwowl", className: "Priest" });
});

const gentleEntry = () => requests.addWaiting({ userId: "u3", userName: "Gentle", characterName: "Gentle", item: "Crimson Spinal", amount: 1, bankKey: KEY, itemId: SPINAL }).request;

describe("apiRoutes/guildBank — confirmed characters", () => {
    it("gates the new routes under raids", () => {
        for (const path of ["/api/guildbank/characters/armory", "/api/guildbank/characters/verify"]) expect(AREA_BY_PATH[path]).toBe("raids");
    });

    it("lists every choice with its evidence, the confirmed ones of the raider first", async () => {
        const res = await call(searchGuildBankCharacters, { url: q("characters", { key: KEY, q: "Gentle" }) });
        expect(body(res).characters.map((c) => [c.characterName, c.verified, c.evidence])).toEqual([
            ["Gentleowl", true, "log"], ["Gentletwowl", true, "log"], ["Gentle", false, ""],
        ]);
    });

    it("says why a waiting entry or a request is not linked", async () => {
        const entry = gentleEntry();
        requests.addWaiting({ characterName: "Whapap", item: "Crimson Spinal", amount: 1, bankKey: KEY, itemId: SPINAL, addedBy: "o1" });
        let res = await call(getGuildBankWaitlist, { url: q("waitlist", { key: KEY }) });
        expect(body(res).entries.map((e) => [e.characterName, e.linked, e.linkProblem])).toEqual([["Gentle", false, "unverified"], ["Whapap", false, "none"]]);
        requests.promoteWaiting(entry.id, 1);
        res = await call(getGuildBankRequests, { url: q("requests", { key: KEY }) });
        expect(body(res).requests).toEqual([expect.objectContaining({ id: entry.id, linked: false, linkProblem: "unverified" })]);
    });

    it("refuses to link an unconfirmed character, takes a confirmed one of the same raider", async () => {
        const entry = gentleEntry();
        let res = await call(linkGuildBankRequest, { payload: { key: KEY, id: entry.id, userId: "u3", characterKey: "gentle" } });
        expect([status(res), body(res).error.message]).toEqual([400, "Gentle ist nicht bestätigt – erst im Arsenal oder im Spiel prüfen, dann verknüpfen."]);
        res = await call(linkGuildBankRequest, { payload: { key: KEY, id: entry.id, userId: "u3", characterKey: "gentleowl" } });
        expect(body(res).request).toMatchObject({ characterName: "Gentleowl", linked: true, linkProblem: "" });
    });

    it("the import preview offers the raider's confirmed characters for an unconfirmed name", async () => {
        const res = await call(previewGuildBankWaitlist, { payload: { key: KEY, text: "Gentle\tCrimson Spinal\t1" } });
        expect(body(res).rows[0]).toMatchObject({ linked: false, unverified: true, match: null });
        expect(body(res).rows[0].candidates.map((c) => c.characterName)).toEqual(["Gentleowl", "Gentletwowl"]);
    });

    it("Im Arsenal prüfen: an answer is stored and confirms the character", async () => {
        lookupArmory.mockResolvedValueOnce({ url: "https://armory/gentle", fetched: true, className: "Druid", level: 70, guild: "Die Gilde" });
        const entry = gentleEntry();
        const res = await call(checkGuildBankCharacterArmory, { payload: { key: KEY, userId: "u3", characterKey: "gentle" } });
        expect(status(res)).toBe(200);
        expect(body(res)).toEqual({ found: true, choice: expect.objectContaining({ characterName: "Gentle", verified: true, evidence: "armory" }) });
        // the character's realm is empty: the bank's realm is asked, in the character's version
        expect(lookupArmory).toHaveBeenCalledWith("Gentle", "Spineshatter", "tbc");
        expect(profiles.getProfile("u3").characters.find((c) => c.key === "gentle").armory).toMatchObject({ level: 70, guild: "Die Gilde", fetchedAt: expect.any(Number) });
        const list = await call(getGuildBankWaitlist, { url: q("waitlist", { key: KEY }) });
        expect(body(list).entries).toEqual([expect.objectContaining({ id: entry.id, linked: true, linkProblem: "" })]);
    });

    it("Im Arsenal prüfen: no answer (or a link alone) stores nothing and says so", async () => {
        let res = await call(checkGuildBankCharacterArmory, { payload: { key: KEY, userId: "u3", characterKey: "gentle" } });
        expect(body(res)).toEqual({ found: false, choice: expect.objectContaining({ verified: false }) });
        lookupArmory.mockResolvedValueOnce({ url: "x", fetched: true, className: "Druid", level: null, guild: "" });
        res = await call(checkGuildBankCharacterArmory, { payload: { key: KEY, userId: "u3", characterKey: "gentle" } });
        expect(body(res).found).toBe(false);
        expect(profiles.getProfile("u3").characters.find((c) => c.key === "gentle").armory).toBeNull();
    });

    it("Im Spiel geprüft: stores who checked it and when; the character is confirmed", async () => {
        const res = await call(verifyGuildBankCharacter, { payload: { key: KEY, userId: "u3", characterKey: "gentle" } });
        expect(status(res)).toBe(200);
        expect(body(res).choice).toMatchObject({ characterName: "Gentle", verified: true, evidence: "orga" });
        expect(profiles.getProfile("u3").characters.find((c) => c.key === "gentle")).toMatchObject({ verifiedBy: "1", verifiedByName: "Orga", verifiedAt: expect.any(Number) });
    });

    it("refuses another server's bank, an unknown character, another version's character and a reader", async () => {
        profiles.addCharacter("u3", { source: "log", name: "Gentleforever", className: "Druid" }, { versionId: "forever" });
        const forever = profiles.getProfile("u3").characters.find((c) => c.name === "Gentleforever");
        for (const handler of [checkGuildBankCharacterArmory, verifyGuildBankCharacter]) {
            let res = await call(handler, { payload: { key: "nope", userId: "u3", characterKey: "gentle" } });
            expect(status(res)).toBe(404);
            activeGuildFor.mockReturnValue("g2");
            res = await call(handler, { payload: { key: KEY, userId: "u3", characterKey: "gentle" } });
            expect(status(res)).toBe(404);
            activeGuildFor.mockReturnValue("g1");
            res = await call(handler, { payload: { key: KEY, userId: "u3", characterKey: "nobody" } });
            expect([status(res), body(res).error.message]).toEqual([404, "Diesen Charakter gibt es im Profil nicht."]);
            res = await call(handler, { payload: { key: KEY, userId: "", characterKey: "gentle" } });
            expect(status(res)).toBe(404);
            res = await call(handler, { payload: { key: KEY, userId: "u3", characterKey: forever.key } });
            expect([status(res), body(res).error.message]).toEqual([400, "Gentleforever ist ein Forever-Charakter – diese Gildenbank ist für TBC. Bitte einen TBC-Charakter wählen."]);
            mockUser = { id: "2", name: "Leser", areas: { raids: "read" } };
            res = await call(handler, { payload: { key: KEY, userId: "u3", characterKey: "gentle" } });
            expect(status(res)).toBe(403);
            mockUser = { id: "1", name: "Orga", isAdmin: true };
            // the refused call never read its body: drop it
            readJsonBody.mockReset();
            readJsonBody.mockResolvedValue({});
        }
        expect(lookupArmory).not.toHaveBeenCalled();
        expect(profiles.getProfile("u3").characters.find((c) => c.key === "gentle").verifiedAt).toBeUndefined();
    });
});
