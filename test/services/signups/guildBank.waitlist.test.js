// The guild bank's waiting list in the request flow (#775): a request splits
// into what is free and what waits, strict order while somebody waits, the
// move-up posts the orga card ("aus der Warteliste") and DMs the raider —
// none for an entry imported without a Discord account — and a decline frees
// stock for the list. Real stores on temp files; Discord mocked.
jest.mock("../../../src/services/discord/discord", () => ({
    postPayload: jest.fn(async () => ({ guildId: "g1", channelId: "900000", messageId: `m${Math.random()}`, url: "" })),
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
const waitlist = require("../../../src/services/guildbank/waitlist");
const { parseGuildBankScan, GB_FORMAT } = require("../../../src/utils/guildbank/guildBankScan");
const { tempStoreFile } = require("../../helpers/tempStore");
const { cardText, cardButtons } = require("../../helpers/cardText");

const CONFIG = { botLanguage: "de", discordServers: { eventGuilds: [{ guildId: "g1" }], guildBankChannelId: "900000" } };
const SPINAL = 32470;
let KEY;
let scanAt = 1791000000;

/** A scan of the bank with `count` Crimson Spinal (0 = not in the scan at all). */
function scan(count) {
    scanAt += 1;
    const parsed = parseGuildBankScan({
        format: GB_FORMAT, version: 1, client: { project: "tbc" }, guild: { name: "Die Gilde", realm: "Spineshatter", faction: "Alliance" },
        scannedAt: scanAt, tabs: [{ index: 1, name: "A", items: count ? [{ itemId: SPINAL, count }] : [] }],
    });
    return stockStore.recordScan(parsed, { now: 1, guildId: "g1" }).bank.key;
}

const ask = (userId, amount, over = {}) => guildBank.createStockRequest(userId, { bankKey: KEY, itemId: SPINAL, amount: String(amount), ...over }, { userName: userId, categoryId: "cat1" });
const statuses = () => store.listRequests().map((r) => [r.userId || r.characterName, r.status, r.amount]);

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
    KEY = scan(1);
    stockStore.setItemMeta("tbc", SPINAL, { name: "Crimson Spinal", icon: "inv_spinal" }, { source: "wowhead" });
    stockStore.setItemSettings(KEY, SPINAL, { status: "give" });
    // the bank runs empty: Crimson Spinal is not in the scan any more, its settings stay
    scan(0);
    jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => console.warn.mockRestore());

describe("services/signups/guildBank — waiting list", () => {
    it("an empty item stays requestable: everything waits, with its place", async () => {
        const offer = guildBank.offerFor({ guildIds: ["g1"] });
        expect(offer.groups[0].items[0]).toMatchObject({ itemId: SPINAL, count: 0, available: 0, free: 0, waiting: 0 });
        const first = await ask("u1", 2);
        expect(first).toMatchObject({ request: null, waiting: { status: "waiting", amount: 2, queueRank: 1 }, position: 1 });
        expect((await ask("u2", 1)).position).toBe(2);
        expect(discord.postPayload).not.toHaveBeenCalled();
        expect(guildBank.offerFor({ guildIds: ["g1"] }).groups[0].items[0]).toMatchObject({ waiting: 2, waitingAmount: 3 });
    });

    it("splits a request: the free part goes out now, the rest waits", async () => {
        scan(3);
        const result = await ask("u1", 5);
        expect(result.request).toMatchObject({ status: "open", amount: 3, fromWaitlist: false });
        expect(result.waiting).toMatchObject({ status: "waiting", amount: 2 });
        expect(result.position).toBe(1);
        expect(discord.postPayload).toHaveBeenCalledTimes(1);
    });

    it("keeps strict order: while somebody waits, a new request waits in full and the first moves up", async () => {
        await ask("u1", 3);
        // stock arrived without anybody moving the list up yet
        scan(2);
        const late = await ask("u2", 1);
        expect(late).toMatchObject({ request: null, position: 2 });
        // u1 got the 2 there were, 1 still waits for u1 — first in line
        expect(statuses()).toEqual([["u1", "open", 2], ["u1", "waiting", 1], ["u2", "waiting", 1]]);
        expect(waitlist.listForBank(KEY).map((r) => [r.userId, r.position])).toEqual([["u1", 1], ["u2", 2]]);
    });

    it("moves up on a new scan: the orga card says 'aus der Warteliste', the raider gets 'Du bist dran'", async () => {
        await ask("u1", 3);
        await ask("u2", 1);
        scan(2);
        const run = await guildBank.advanceWaitlist({ bankKey: KEY });
        expect(run.moved).toHaveLength(1);
        expect(run.posted).toBe(1);
        const card = discord.postPayload.mock.calls[0][1];
        expect(cardText(card)).toContain("## 2× Crimson Spinal");
        expect(cardText(card)).toContain("aus der Warteliste · offen");
        expect(cardButtons(card).map((b) => b.label)).toEqual(["Bestätigen", "Ablehnen …"]);
        const [to, dm] = discord.sendDirectMessage.mock.calls[0];
        expect(to).toBe("u1");
        expect(cardText(dm)).toContain("## Du bist dran");
        expect(cardText(dm)).toContain("1 weitere bleiben für dich auf der Warteliste – du bist als Nächstes dran.");
        // the same scan again: nothing is handed out twice
        scan(2);
        discord.postPayload.mockClear();
        expect((await guildBank.advanceWaitlist({})).moved).toEqual([]);
        expect(discord.postPayload).not.toHaveBeenCalled();
    });

    it("an entry imported without a Discord account moves up with a card and no DM", async () => {
        waitlist.importLines(KEY, "Whapap\tCrimson Spinal\t1", { by: "o1", byName: "Orga" });
        scan(1);
        await guildBank.advanceWaitlist({ bankKey: KEY });
        const card = discord.postPayload.mock.calls[0][1];
        expect(cardText(card)).toContain("**Whapap** · ohne Discord-Konto, keine DM");
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
        const open = store.listRequests({ status: "open" })[0];
        expect(open).toMatchObject({ userId: "", characterName: "Whapap", fromWaitlist: true });
        // the orga handles it like any other: confirm without a DM
        const confirmed = await guildBank.confirmRequest(open.id, { by: "o1", byName: "Arthas" });
        expect(confirmed).toMatchObject({ request: { status: "confirmed" }, dm: false });
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
    });

    it("posts a moved-up card again on the next run when the channel was not reachable", async () => {
        await ask("u1", 1);
        scan(1);
        discord.postPayload.mockRejectedValueOnce(new Error("offline"));
        const first = await guildBank.advanceWaitlist({ bankKey: KEY });
        expect(first.posted).toBe(0);
        expect(store.listRequests({ status: "open" })[0]).toMatchObject({ fromWaitlist: true, messageId: "" });
        const second = await guildBank.advanceWaitlist({ bankKey: KEY });
        expect(second).toMatchObject({ moved: [], posted: 1 });
        expect(store.listRequests({ status: "open" })[0].messageId).toMatch(/^m/);
        // the DM went out once, with the move-up
        expect(discord.sendDirectMessage).toHaveBeenCalledTimes(1);
    });

    it("a declined request frees its amount for the waiting list", async () => {
        scan(2);
        const direct = (await ask("u1", 2)).request;
        await ask("u2", 1);
        expect(statuses()).toEqual([["u1", "open", 2], ["u2", "waiting", 1]]);
        await guildBank.resolveRequest(direct.id, { status: "rejected", by: "o1", byName: "Orga", reason: "doppelt" });
        expect(statuses()).toEqual([["u2", "open", 1], ["u1", "rejected", 2]]);
        expect(discord.sendDirectMessage.mock.calls.map((c) => c[0])).toEqual(["u1", "u2"]);
    });

    it("a lower reserve or a released confirmation lets the list move up", async () => {
        scan(4);
        stockStore.setItemSettings(KEY, SPINAL, { reserve: 4 });
        await ask("u1", 1);
        expect(statuses()).toEqual([["u1", "waiting", 1]]);
        stockStore.setItemSettings(KEY, SPINAL, { reserve: 0 });
        await guildBank.advanceWaitlist({ bankKey: KEY, itemId: SPINAL });
        expect(statuses()).toEqual([["u1", "open", 1]]);
        const open = store.listRequests({ status: "open" })[0];
        await guildBank.confirmRequest(open.id, {});
        expect((await guildBank.releaseRequest(open.id)).request.status).toBe("open");
    });

    it("checks the limits before storing anything: 5 open requests, 10 waiting entries", async () => {
        for (let i = 0; i < store.MAX_WAITING; i++) expect((await ask("u1", 1)).waiting).toBeTruthy();
        expect(await ask("u1", 1)).toEqual({ error: "Höchstens 10 Einträge auf der Warteliste – warte, bis einer drankommt." });
        scan(20);
        for (const r of store.listRequests()) store.removeRequest(r.id);
        for (let i = 0; i < store.MAX_OPEN; i++) expect((await ask("u2", 1)).request).toBeTruthy();
        expect(await ask("u2", 1)).toEqual({ error: "Höchstens 5 offene Anfragen – warte, bis die Orga eine erledigt hat." });
        // moving up never fails on MAX_OPEN
        scan(5);
        for (let i = 0; i < 2; i++) store.addWaiting({ userId: "u2", bankKey: KEY, itemId: SPINAL, item: "Crimson Spinal", amount: 1 });
        scan(20);
        await guildBank.advanceWaitlist({ bankKey: KEY });
        expect(store.openCount("u2")).toBe(7);
        expect(guildBank.splitAmount({ waiting: 1, free: 9 }, 3)).toEqual({ now: 0, wait: 3 });
        expect(guildBank.splitAmount({ waiting: 0, free: 2 }, 3)).toEqual({ now: 2, wait: 1 });
    });

    it("never throws: a broken store read is logged and nothing moves", async () => {
        const spy = jest.spyOn(waitlist, "promoteBank").mockImplementation(() => { throw new Error("kaputt"); });
        expect(await guildBank.advanceWaitlist({ bankKey: KEY })).toEqual({ moved: [], posted: 0 });
        expect(console.warn).toHaveBeenCalled();
        spy.mockRestore();
        settingsStore.getConfig.mockReturnValue({ discordServers: {} });
        expect(await guildBank.advanceWaitlist({})).toEqual({ moved: [], posted: 0 });
    });
});
