// Guild bank requests from the stock (#633): which bank a raider sees, the
// checks against "Verfügbar" and maxPerRequest, the recipient character, and
// the orga's steps open → confirmed → handedOut (and back, and the race on
// confirm) with their cards and DMs. Real stores on temp files; Discord mocked.
jest.mock("../../../src/services/discord/discord", () => ({
    postPayload: jest.fn(async () => ({ guildId: "g1", channelId: "900000", messageId: "m1", url: "" })),
    editPayload: jest.fn(async () => ({})),
    sendDirectMessage: jest.fn(async () => ({ ok: true, messageId: "dm1" })),
    listCategories: jest.fn(() => [{ id: "cat1", name: "TBC Montag" }]),
}));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/stores/userPrefsStore", () => ({ getLang: jest.fn(() => ""), getClientLang: jest.fn(() => ""), localeToLang: jest.fn(() => "") }));

const discord = require("../../../src/services/discord/discord");
const settingsStore = require("../../../src/stores/settingsStore");
const store = require("../../../src/stores/guildBankStore");
const stockStore = require("../../../src/stores/guildBankStockStore");
const profiles = require("../../../src/stores/raiderProfileStore");
const guildBank = require("../../../src/services/signups/guildBank");
const { parseGuildBankScan, GB_FORMAT } = require("../../../src/utils/guildbank/guildBankScan");
const { tempStoreFile } = require("../../helpers/tempStore");
const { cardText, cardButtons } = require("../../helpers/cardText");

const CONFIG = { botLanguage: "de", discordServers: { eventGuilds: [{ guildId: "g1" }], guildBankChannelId: "900000" } };
const RUBY = 32193;
const FLASK = 22854;
let KEY;

/** The tbc bank of server g1: 14 rubies (max. 5 per request, 2 kept back), 6 flasks only in stock. */
function seedBank() {
    const scan = parseGuildBankScan({
        format: GB_FORMAT, version: 1, client: { project: "tbc" }, guild: { name: "Die Gilde", realm: "Spineshatter", faction: "Alliance" },
        scannedAt: 1791000000, tabs: [{ index: 1, name: "A", items: [{ itemId: RUBY, count: 14 }, { itemId: FLASK, count: 6 }] }],
    });
    KEY = stockStore.recordScan(scan, { now: 1, guildId: "g1" }).bank.key;
    stockStore.setItemMeta("tbc", RUBY, { name: "Klobiger lebendiger Rubin", icon: "inv_ruby", classId: 3, className: "Edelsteine" }, { source: "wowhead" });
    stockStore.setItemSettings(KEY, RUBY, { status: "give", maxPerRequest: 5, reserve: 2 });
    stockStore.setItemSettings(KEY, FLASK, { status: "show" });
}

const ask = (over = {}, opts = {}) => guildBank.createStockRequest("u1", { bankKey: KEY, itemId: RUBY, amount: "2", purpose: "Gruul", ...over }, { userName: "Anna", categoryId: "cat1", ...opts });

beforeAll(() => {
    store.useFile(tempStoreFile("guild-bank.json"));
    stockStore.useFile(tempStoreFile("guild-bank-stock.json"));
    profiles.useFile(tempStoreFile("profiles.json"));
});
afterAll(() => {
    store.useFile(null);
    stockStore.useFile(null);
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    jest.clearAllMocks();
    for (const r of store.listRequests()) store.removeRequest(r.id);
    for (const b of stockStore.listBanks()) stockStore.removeBank(b.key);
    profiles.reset();
    settingsStore.getConfig.mockReturnValue(CONFIG);
    seedBank();
    jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => console.warn.mockRestore());

describe("services/signups/guildBank — requests from the stock", () => {
    it("offers the organizer's server's bank, else an event server's, else nothing", () => {
        const offer = guildBank.offerFor({ guildIds: ["g1"], categoryId: "cat1" });
        expect(offer.bank.key).toBe(KEY);
        expect(offer.groups.map((g) => [g.name, g.items.map((it) => it.itemId)])).toEqual([["Edelsteine", [RUBY]]]);
        expect(offer.groups[0].items[0]).toMatchObject({ available: 12, maxPerRequest: 5 });
        // the talk server has no bank: the event server's is offered
        expect(guildBank.offerFor({ guildIds: ["talk"] }).bank.key).toBe(KEY);
        settingsStore.getConfig.mockReturnValue({ ...CONFIG, discordServers: { ...CONFIG.discordServers, eventGuilds: [] } });
        expect(guildBank.offerFor({ guildIds: [undefined, "talk"] })).toEqual({ bank: null, groups: [] });
    });

    it("stores the item, the recipient (the raider's first character of the bank's version) and posts the card", async () => {
        profiles.addCharacter("u1", { name: "Zibbo", className: "Priest", realm: "Spineshatter", specs: [{ key: "Priest-Holy", gear: "ready" }] });
        profiles.addCharacter("u1", { name: "Zibbowar", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "ready" }] });
        profiles.addCharacter("u1", { name: "Devi Res", className: "Mage", specs: [{ key: "Mage-Frost", gear: "ready" }] }, { versionId: "forever" });
        const bank = stockStore.getBank(KEY);
        expect(guildBank.charactersFor("u1", bank).map((c) => c.name)).toEqual(["Zibbo", "Zibbowar"]);
        expect(guildBank.charactersFor("u1", null)).toEqual([]);

        const { request } = await ask();
        expect(request).toMatchObject({
            item: "Klobiger lebendiger Rubin", amount: 2, purpose: "Gruul", bankKey: KEY, itemId: RUBY, icon: "inv_ruby", group: "Edelsteine",
            characterName: "Zibbo", realm: "Spineshatter", faction: "Alliance", status: "open", messageId: "m1",
        });
        const card = discord.postPayload.mock.calls[0][1];
        expect(cardText(card)).toContain("-# Gildenbank · Edelsteine\n## 2× Klobiger lebendiger Rubin");
        expect(cardText(card)).toContain("An: Zibbo-Spineshatter");
        expect(cardText(card)).toContain("**Bestand** 14 · **Vorgemerkt** 0 · **Verfügbar** 12 (danach 10)");
        expect(cardButtons(card).map((b) => b.custom_id)).toEqual([`guildbank:confirm:${request.id}`, `guildbank:reject:${request.id}`]);

        // the picked character wins; without a realm of its own the bank's
        const picked = (await ask({ characterKey: "zibbowar" })).request;
        expect(picked).toMatchObject({ characterName: "Zibbowar", realm: "Spineshatter" });
        // no character of the version: no name, the orga sees the raider
        profiles.reset();
        expect((await ask()).request).toMatchObject({ characterName: "", realm: "Spineshatter" });
    });

    it("checks the item, the amount, maxPerRequest and what is left", async () => {
        expect(await ask({ itemId: FLASK })).toEqual({ error: guildBank.NOT_OFFERED });
        expect(await ask({ itemId: 1 })).toEqual({ error: guildBank.NOT_OFFERED });
        expect(await ask({ bankKey: "" })).toEqual({ error: guildBank.NOT_OFFERED });
        expect(await ask({ amount: "0" })).toEqual({ error: "Die Menge muss eine ganze Zahl von 1 bis 9999 sein." });
        expect(await ask({ amount: "6" })).toEqual({ error: "Höchstens 5 pro Anfrage." });
        stockStore.setItemSettings(KEY, RUBY, { maxPerRequest: 0, reserve: 10 });
        expect(await ask({ amount: "5" })).toEqual({ error: "Nur noch 4 verfügbar." });
        settingsStore.getConfig.mockReturnValue({ discordServers: {} });
        expect(await ask()).toEqual({ error: guildBank.NOT_SET_UP });
        expect(discord.postPayload).not.toHaveBeenCalled();
    });

    it("takes a request back whose card does not reach the channel", async () => {
        discord.postPayload.mockRejectedValueOnce(new Error("Missing Access"));
        expect(await ask()).toEqual({ error: "Die Anfrage konnte nicht gepostet werden – versuch es später noch einmal." });
        expect(store.listRequests()).toEqual([]);
    });

    it("confirm sets the amount aside, redraws the card and the other cards of the item, DMs the raider", async () => {
        const first = (await ask({ amount: "5" })).request;
        const second = (await ask({ amount: "4" })).request;
        discord.editPayload.mockClear();
        const result = await guildBank.confirmRequest(first.id, { by: "o1", byName: "Arthas" });
        expect(result).toMatchObject({ posted: true, dm: true, request: { status: "confirmed", handledByName: "Arthas" } });
        expect(stockStore.getBank(KEY) && guildBank.offerFor({ guildIds: ["g1"] }).groups[0].items[0].available).toBe(7);
        const [own, sibling] = discord.editPayload.mock.calls.map((c) => c[2]);
        expect(cardText(own)).toContain("-# TBC Montag · Vorgemerkt von Arthas · wartet auf Ausgabe im Spiel");
        expect(cardButtons(own).map((b) => b.label)).toEqual(["Ausgegeben", "Vormerkung lösen"]);
        expect(cardText(sibling)).toContain("**Bestand** 14 · **Vorgemerkt** 5 · **Verfügbar** 7 (danach 3)");
        expect(discord.editPayload.mock.calls[1][1]).toBe(second.messageId);
        expect(cardText(discord.sendDirectMessage.mock.calls[0][1])).toContain("## Anfrage bestätigt");
    });

    it("confirm checks again: someone may have taken it meanwhile", async () => {
        const first = (await ask({ amount: "5" })).request;
        const second = (await ask({ amount: "5" })).request;
        const third = (await ask({ amount: "5" })).request;
        await guildBank.confirmRequest(first.id, { byName: "A" });
        await guildBank.confirmRequest(second.id, { byName: "B" });
        discord.editPayload.mockClear();
        discord.sendDirectMessage.mockClear();
        const late = await guildBank.confirmRequest(third.id, { byName: "C" });
        expect(late).toMatchObject({ error: "Nicht genug verfügbar: noch 2, angefragt 5.", available: 2, request: { id: third.id } });
        expect(store.getRequest(third.id).status).toBe("open");
        expect(discord.editPayload).toHaveBeenCalledTimes(1);
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
        // the item gone from the bank: nothing left
        stockStore.removeBank(KEY);
        expect((await guildBank.confirmRequest(third.id, {})).available).toBe(0);
    });

    it("release makes a confirmed request open again without a DM; hand-out ends it with a DM", async () => {
        const r = (await ask()).request;
        await guildBank.confirmRequest(r.id, { byName: "Arthas" });
        discord.sendDirectMessage.mockClear();
        const released = await guildBank.releaseRequest(r.id);
        expect(released).toMatchObject({ request: { status: "open" }, dm: false });
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();

        await guildBank.confirmRequest(r.id, { byName: "Arthas" });
        discord.editPayload.mockClear();
        discord.sendDirectMessage.mockClear();
        const out = await guildBank.handOutRequest(r.id, { by: "o2", byName: "Jaina" });
        expect(out).toMatchObject({ posted: true, dm: true, request: { status: "handedOut", handoutVia: "discord", handedOutByName: "Jaina" } });
        expect(cardText(discord.editPayload.mock.calls[0][2])).toContain("-# TBC Montag · ausgegeben von Jaina");
        expect(cardText(discord.sendDirectMessage.mock.calls[0][1])).toContain("## Anfrage ausgegeben");
        // still counted until the next scan: available does not jump back up
        expect(guildBank.offerFor({ guildIds: ["g1"] }).groups[0].items[0].available).toBe(10);
        // a second hand-out report changes nothing
        discord.sendDirectMessage.mockClear();
        expect(await guildBank.handOutRequest(r.id, { via: "manual" })).toMatchObject({ error: "Diese Anfrage ist schon ausgegeben." });
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
    });

    it("lists a bank's open and confirmed requests for the web page", async () => {
        const a = (await ask()).request;
        const b = (await ask()).request;
        const c = (await ask()).request;
        await guildBank.confirmRequest(a.id, {});
        await guildBank.resolveRequest(c.id, { status: "rejected" });
        await guildBank.createRequest("u1", { item: "Freitext", amount: 1 }, {});
        expect(guildBank.pendingForBank(KEY).map((r) => [r.id, r.status])).toEqual([[b.id, "open"], [a.id, "confirmed"]]);
        expect(guildBank.pendingForBank("")).toEqual([]);
    });
});
