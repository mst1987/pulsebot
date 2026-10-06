// The addon's hand-out list (#634): which confirmed requests the sync tool
// pulls per bank, and the report back — idempotent, per-id results, card and
// DM through services/signups/guildBank, the stored stock untouched. Real
// stores on temp files; Discord mocked.
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
const stockView = require("../../../src/services/guildbank/stockView");
const handouts = require("../../../src/services/guildbank/handouts");
const { parseGuildBankScan, GB_FORMAT } = require("../../../src/utils/guildbank/guildBankScan");
const { tempStoreFile } = require("../../helpers/tempStore");
const { cardText } = require("../../helpers/cardText");

const CONFIG = { botLanguage: "de", discordServers: { eventGuilds: [{ guildId: "g1" }], guildBankChannelId: "900000" } };
const RUBY = 32193;
const FLASK = 22854;
const NOW = 1791100000000;
let KEY;
let OTHER;

function bankScan(guild, tabs) {
    return parseGuildBankScan({
        format: GB_FORMAT, version: 1, client: { project: "tbc" }, guild: { name: guild, realm: "Spineshatter", faction: "Alliance" },
        scannedAt: 1791000000, tabs,
    });
}

/** Bank of g1 (rubies in tabs 1 and 2, flasks in tab 2), a second unassigned bank. */
function seed() {
    KEY = stockStore.recordScan(bankScan("Die Gilde", [
        { index: 1, name: "Edelsteine", items: [{ itemId: RUBY, count: 10 }] },
        { index: 2, name: "Verbrauch", items: [{ itemId: RUBY, count: 4 }, { itemId: FLASK, count: 6 }] },
    ]), { now: 1, guildId: "g1" }).bank.key;
    OTHER = stockStore.recordScan(bankScan("Andere Gilde", [{ index: 1, name: "A", items: [{ itemId: RUBY, count: 3 }] }]), { now: 1 }).bank.key;
    stockStore.setItemMeta("tbc", RUBY, { name: "Klobiger lebendiger Rubin", icon: "inv_jewelcrafting_livingruby_03", quality: 3, classId: 3, className: "Edelsteine" }, { source: "wowhead" });
    stockStore.setItemSettings(KEY, RUBY, { status: "give" });
    stockStore.setItemSettings(KEY, FLASK, { status: "give" });
}

/** A confirmed request of the stock with its orga card. */
function confirmed(over = {}, { at = 1791050000000 } = {}) {
    const { request } = store.addRequest({
        userId: "u1", userName: "Anna", categoryId: "cat1", item: "Rubin", amount: 2, purpose: "Gruul",
        bankKey: KEY, itemId: RUBY, icon: "inv_old", group: "Edelsteine",
        characterName: "Zibbo", realm: "Spineshatter", faction: "Alliance", ...over,
    }, { now: at - 1000 });
    store.setMessage(request.id, { channelId: "900000", messageId: `m-${request.id}` });
    return store.confirmRequest(request.id, { by: "o1", byName: "Arthas" }, { now: at }).request;
}

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
    seed();
    jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => console.warn.mockRestore());

describe("classFileOf", () => {
    it("turns the profile's class id into the game's class token", () => {
        expect(handouts.classFileOf("Priest")).toBe("PRIEST");
        expect(handouts.classFileOf("DK")).toBe("DEATHKNIGHT");
        expect(handouts.classFileOf("Death Knight")).toBe("DEATHKNIGHT");
        expect(handouts.classFileOf("")).toBe("");
        expect(handouts.classFileOf(undefined)).toBe("");
    });
});

describe("handoutList", () => {
    it("lists the assigned banks with their confirmed requests from the stock only", () => {
        profiles.addCharacter("u1", { name: "Zibbo", className: "Priest", realm: "Spineshatter", specs: [{ key: "Priest-Holy", gear: "ready" }] });
        const r = confirmed();
        store.addRequest({ userId: "u2", userName: "Bert", item: "Rubin", amount: 1, bankKey: KEY, itemId: RUBY }); // open
        store.addRequest({ userId: "u3", userName: "Cleo", item: "Gold", amount: 1 }); // free text
        const list = handouts.handoutList({ now: NOW });
        expect(list).toMatchObject({ format: "eventhelper-guildbank-handouts", version: 1, generatedAt: 1791100000 });
        // the unassigned bank is not listed
        expect(list.banks).toHaveLength(1);
        expect(list.banks[0]).toEqual({
            key: KEY, gameVersion: "tbc", realm: "Spineshatter", guild: "Die Gilde", faction: "Alliance", scannedAt: 1791000000,
            handouts: [{
                id: r.id, itemId: RUBY, name: "Klobiger lebendiger Rubin", icon: "inv_jewelcrafting_livingruby_03", quality: 3,
                amount: 2, purpose: "Gruul",
                character: { name: "Zibbo", realm: "Spineshatter", faction: "Alliance", classFile: "PRIEST" },
                requestedBy: "Anna", requestedAt: 1791049999, confirmedBy: "Arthas", confirmedAt: 1791050000,
                inBank: 14,
                tabs: [{ index: 1, name: "Edelsteine", count: 10 }, { index: 2, name: "Verbrauch", count: 4 }],
            }],
        });
    });

    it("gives no character without a name, falls back to the request's item, and lists a bank without requests empty", () => {
        stockStore.setTabHidden(KEY, 2, true);
        const flask = confirmed({ itemId: FLASK, item: "Fläschchen", icon: "inv_flask", characterName: "" });
        let [bank] = handouts.handoutList().banks;
        expect(bank.handouts[0]).toMatchObject({
            id: flask.id, name: "Fläschchen", icon: "inv_flask", quality: -1, character: null, inBank: 0, tabs: [],
        });
        store.handOutRequest(flask.id, { via: "manual" });
        [bank] = handouts.handoutList().banks;
        expect(bank.handouts).toEqual([]);
    });

    it("keeps the character without a class when the profile does not know it", () => {
        confirmed({ characterName: "Fremd", realm: "", faction: "" });
        const [h] = handouts.handoutList().banks[0].handouts;
        expect(h.character).toEqual({ name: "Fremd", realm: "Spineshatter", faction: "Alliance", classFile: "" });
    });

    it("lists the oldest confirmation first and narrows to one bank or a token's server", () => {
        const late = confirmed({}, { at: 1791060000000 });
        const early = confirmed({ userId: "u2" }, { at: 1791040000000 });
        expect(handouts.handoutList().banks[0].handouts.map((h) => h.id)).toEqual([early.id, late.id]);
        expect(handouts.handoutList({ bankKey: KEY.toUpperCase() }).banks.map((b) => b.key)).toEqual([KEY]);
        expect(handouts.handoutList({ bankKey: OTHER }).banks).toEqual([]);
        stockStore.assignBank(OTHER, "g2");
        expect(handouts.handoutList().banks.map((b) => b.key).sort()).toEqual([KEY, OTHER].sort());
        expect(handouts.handoutList({ token: { guildId: "g2" } }).banks.map((b) => b.key)).toEqual([OTHER]);
    });
});

describe("parseReport", () => {
    it("takes ids and objects, each id once, and counts what is no id", () => {
        const { entries, invalid } = handouts.parseReport({ done: ["a", { id: "b", via: "mail", by: "  Jaina  ", at: 5 }, "a", { id: 7, via: "owl" }, null, {}, "", { id: { x: 1 } }] });
        expect(entries).toEqual([
            { id: "a", via: "manual", by: "", at: 0 },
            { id: "b", via: "mail", by: "Jaina", at: 5 },
            { id: "7", via: "manual", by: "", at: 0 },
        ]);
        expect(invalid).toBe(4);
    });

    it("refuses a body without a done list and one that is too long", () => {
        expect(() => handouts.parseReport({})).toThrow(handouts.HandoutReportError);
        expect(() => handouts.parseReport(undefined)).toThrow(/done/);
        expect(() => handouts.parseReport({ done: "a" })).toThrow(handouts.HandoutReportError);
        expect(() => handouts.parseReport({ done: Array.from({ length: handouts.MAX_DONE + 1 }, (_, i) => `id${i}`) })).toThrow(/Höchstens 200/);
    });
});

describe("reportHandouts", () => {
    const TOKEN = { id: "t1", name: "Raidlead-PC", createdBy: "admin1" };

    it("hands a confirmed request out by mail: card, DM, the officer's name; the stored stock stays", async () => {
        const r = confirmed();
        const before = stockView.stockItem(KEY, RUBY);
        expect(before).toMatchObject({ count: 14, reserved: 2, handedOut: 0, available: 12 });

        const out = await handouts.reportHandouts({ done: [{ id: r.id, via: "mail", by: "Jaina", at: 1791070000 }] }, { token: TOKEN, now: NOW });
        expect(out).toEqual({ format: "eventhelper-guildbank-handouts", version: 1, ok: [r.id], duplicate: [], notConfirmed: [], unknown: [], invalid: 0 });
        expect(store.getRequest(r.id)).toMatchObject({
            status: "handedOut", handoutVia: "mail", handedOutBy: "admin1", handedOutByName: "Jaina", handedOutAt: 1791070000000,
        });
        expect(cardText(discord.editPayload.mock.calls[0][2])).toContain("per Post ausgegeben von Jaina");
        expect(discord.sendDirectMessage).toHaveBeenCalledTimes(1);
        // the reservation became a hand-out: Verfügbar stays, the stored stock is untouched
        expect(stockView.stockItem(KEY, RUBY)).toMatchObject({ count: 14, reserved: 0, handedOut: 2, available: 12 });
        expect(stockStore.getBank(KEY).items.find((i) => i.itemId === RUBY).count).toBe(14);
    });

    it("is idempotent: a second report is a duplicate and touches nothing", async () => {
        const r = confirmed();
        await handouts.reportHandouts({ done: [r.id] }, { token: TOKEN, now: NOW });
        expect(store.getRequest(r.id)).toMatchObject({ handoutVia: "manual", handedOutByName: "Raidlead-PC", handedOutAt: NOW });
        expect(cardText(discord.editPayload.mock.calls[0][2])).toContain("ausgegeben von Raidlead-PC · im Spiel abgehakt");
        jest.clearAllMocks();
        const again = await handouts.reportHandouts({ done: [r.id, r.id] }, { token: TOKEN, now: NOW + 5000 });
        expect(again).toMatchObject({ ok: [], duplicate: [r.id] });
        expect(store.getRequest(r.id).handedOutAt).toBe(NOW);
        expect(discord.editPayload).not.toHaveBeenCalled();
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
    });

    it("sorts released, unknown, free-text and invalid entries out without failing", async () => {
        const released = confirmed();
        store.releaseRequest(released.id);
        const free = store.addRequest({ userId: "u3", userName: "Cleo", item: "Gold", amount: 1 }).request;
        const good = confirmed({ userId: "u2" });
        const out = await handouts.reportHandouts({ done: [released.id, "nope", free.id, 42, good.id, null] }, { token: {}, now: NOW });
        expect(out).toEqual({
            format: "eventhelper-guildbank-handouts", version: 1,
            ok: [good.id], duplicate: [], notConfirmed: [released.id], unknown: ["nope", free.id, "42"], invalid: 1,
        });
        expect(store.getRequest(released.id).status).toBe("open");
        expect(store.getRequest(good.id)).toMatchObject({ status: "handedOut", handedOutBy: "addon", handedOutByName: "Addon" });
    });

    it("answers another server's request as unknown for a token bound to a server", async () => {
        const r = confirmed();
        const out = await handouts.reportHandouts({ done: [r.id] }, { token: { ...TOKEN, guildId: "g2" }, now: NOW });
        expect(out.unknown).toEqual([r.id]);
        expect(store.getRequest(r.id).status).toBe("confirmed");
    });

    it("takes the time of the hand-out only when it is plausible", async () => {
        const future = confirmed();
        const beforeConfirm = confirmed({ userId: "u2" });
        await handouts.reportHandouts({ done: [{ id: future.id, at: NOW / 1000 + 60 }, { id: beforeConfirm.id, at: 1791000000 }] }, { token: TOKEN, now: NOW });
        expect(store.getRequest(future.id).handedOutAt).toBe(NOW);
        expect(store.getRequest(beforeConfirm.id).handedOutAt).toBe(NOW);
    });

    it("sorts a request that changed between the check and the hand-out by its new state", async () => {
        const guildBank = require("../../../src/services/signups/guildBank");
        const r = confirmed();
        const spy = jest.spyOn(guildBank, "handOutRequest");
        spy.mockResolvedValueOnce({ error: "x", request: { ...r, status: "handedOut" } })
            .mockResolvedValueOnce({ error: "x", request: { ...r, status: "open" } })
            .mockResolvedValueOnce({ error: "x" });
        for (const list of ["duplicate", "notConfirmed", "unknown"]) {
            const out = await handouts.reportHandouts({ done: [r.id] }, { token: TOKEN, now: NOW });
            expect(out[list]).toEqual([r.id]);
        }
        spy.mockRestore();
    });
});
