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

// #924: the guild bank channel is per server; g1 is the first server
const CONFIG = { guildId: "g1", discordServers: { eventGuilds: [{ guildId: "g1" }] }, serverSettings: { g1: { botLanguage: "de", guildBankChannelId: "900000" } } };
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
        // only into a channel of the bank's server (#924)
        expect(discord.postPayload.mock.calls[0][2]).toEqual({ guildId: "g1" });
    });

    it("a new request waits in full while somebody waits; the list moves up in turns, a rest goes to the end", async () => {
        await ask("u1", 3);
        // stock arrived without anybody moving the list up yet
        scan(2);
        const late = await ask("u2", 1);
        // u1 got one portion (2), the 1 left of it stands behind u2 now
        expect(late).toMatchObject({ request: null, position: 1, portion: 2 });
        expect(statuses()).toEqual([["u1", "open", 2], ["u2", "waiting", 1], ["u1", "waiting", 1]]);
        expect(waitlist.listForBank(KEY).map((r) => [r.userId, r.position])).toEqual([["u2", 1], ["u1", 2]]);
    });

    it("moves up on a new scan: the orga card says 'aus der Warteliste' with the rest, the raider gets 'Du bist dran'", async () => {
        await ask("u1", 3);
        await ask("u2", 1);
        scan(2);
        const run = await guildBank.advanceWaitlist({ bankKey: KEY });
        expect(run.moved).toHaveLength(1);
        expect(run.posted).toBe(1);
        const card = discord.postPayload.mock.calls[0][1];
        expect(discord.postPayload.mock.calls[0][2]).toEqual({ guildId: "g1" });
        expect(cardText(card)).toContain("## 2× Crimson Spinal");
        expect(cardText(card)).toContain("aus der Warteliste · Rest 1 wartet (Platz 2) · offen");
        expect(cardButtons(card).map((b) => b.label)).toEqual(["Bestätigen", "Charakter ändern …", "Ablehnen …"]);
        const [to, dm] = discord.sendDirectMessage.mock.calls[0];
        expect(to).toBe("u1");
        expect(cardText(dm)).toContain("## Du bist dran");
        expect(cardText(dm)).toContain("1 weitere stehen für dich wieder hinten auf der Warteliste – du bist Nr. 2.");
        // the same scan again: nothing is handed out twice
        scan(2);
        discord.postPayload.mockClear();
        expect((await guildBank.advanceWaitlist({})).moved).toEqual([]);
        expect(discord.postPayload).not.toHaveBeenCalled();
    });

    it("the live list (1, 1, 15, 2, 1, 1, 8, 3, 3, 1, 12) and 5 come in: 1, 1, 2 and 1 — the two rests to the end", async () => {
        [1, 1, 15, 2, 1, 1, 8, 3, 3, 1, 12].forEach((amount, i) => {
            store.addWaiting({ userId: `u${i + 1}`, bankKey: KEY, itemId: SPINAL, item: "Crimson Spinal", amount }, { now: 1000 + i });
        });
        scan(5);
        const run = await guildBank.advanceWaitlist({ bankKey: KEY });
        expect(run.moved.map((m) => [m.request.userId, m.request.amount, m.rest && m.rest.amount, m.restPosition]))
            .toEqual([["u1", 1, null, 0], ["u2", 1, null, 0], ["u3", 2, 13, 8], ["u4", 1, 1, 9]]);
        expect(waitlist.listForBank(KEY).map((r) => `${r.userId}:${r.amount}`)).toEqual(["u5:1", "u6:1", "u7:8", "u8:3", "u9:3", "u10:1", "u11:12", "u3:13", "u4:1"]);
        // four cards, one per raider; the 15er's says where its rest stands
        expect(discord.postPayload).toHaveBeenCalledTimes(4);
        const texts = discord.postPayload.mock.calls.map((c) => cardText(c[1]));
        expect(texts.filter((t) => t.includes("aus der Warteliste · Rest 13 wartet (Platz 8) · offen"))).toHaveLength(1);
        expect(texts.filter((t) => t.includes("aus der Warteliste · offen"))).toHaveLength(2);
        const dm = discord.sendDirectMessage.mock.calls.find((c) => c[0] === "u3")[1];
        expect(cardText(dm)).toContain("13 weitere stehen für dich wieder hinten auf der Warteliste – du bist Nr. 8.");
        // a portion of its own: 5 per turn — the next 5 all go to u5, u6 and u7 (1, 1, 3)
        stockStore.setItemSettings(KEY, SPINAL, { portion: 5 });
        scan(10);
        const next = await guildBank.advanceWaitlist({ bankKey: KEY });
        expect(next.moved.map((m) => [m.request.userId, m.request.amount])).toEqual([["u5", 1], ["u6", 1], ["u7", 3]]);
    });

    it("an entry imported without a Discord account moves up unlinked: no DM, no confirming until the orga links it", async () => {
        waitlist.importLines(KEY, "Whapap\tCrimson Spinal\t1", { by: "o1", byName: "Orga" });
        scan(1);
        await guildBank.advanceWaitlist({ bankKey: KEY });
        const card = discord.postPayload.mock.calls[0][1];
        expect(cardText(card)).toContain("**Whapap** · ohne Discord-Konto, keine DM");
        expect(cardText(card)).toContain("Kein verknüpfter Charakter");
        // no dead Bestätigen: the orga can vouch for the name on the card (#806)
        expect(cardButtons(card).map((b) => b.label)).toEqual(["Geprüft & bestätigen", "Charakter ändern …", "Ablehnen …"]);
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
        const open = store.listRequests({ status: "open" })[0];
        expect(open).toMatchObject({ userId: "", characterName: "Whapap", fromWaitlist: true });
        // confirming is refused (the addon would mail to a name nobody plays), the card is drawn again
        discord.editPayload.mockClear();
        const refused = await guildBank.confirmRequest(open.id, { by: "o1", byName: "Arthas" });
        expect(refused).toMatchObject({ error: guildBank.NOT_LINKED, notLinked: true, request: { id: open.id } });
        expect(store.getRequest(open.id).status).toBe("open");
        expect(discord.editPayload).toHaveBeenCalledTimes(1);
        // the orga links the raider's character in the web: card redrawn, confirming works, the raider gets the DM
        profiles.addCharacter("u7", { source: "log", name: "Whapap", className: "Mage", realm: "Spineshatter", specs: [{ key: "Mage-Frost", gear: "ready" }] }, { name: "Wha" });
        discord.editPayload.mockClear();
        const linked = await guildBank.linkRequest(open.id, { bankKey: KEY, userId: "u7", characterKey: "whapap" });
        expect(linked.request).toMatchObject({ userId: "u7", userName: "Wha", characterName: "Whapap", realm: "Spineshatter", linked: true });
        const redrawn = discord.editPayload.mock.calls[0][2];
        expect(cardText(redrawn)).not.toContain("Kein verknüpfter Charakter");
        expect(cardButtons(redrawn).find((b) => b.label === "Bestätigen").disabled).toBeFalsy();
        const confirmed = await guildBank.confirmRequest(open.id, { by: "o1", byName: "Arthas" });
        expect(confirmed).toMatchObject({ request: { status: "confirmed" }, dm: true });
        expect(discord.sendDirectMessage.mock.calls[0][0]).toBe("u7");
    });

    it("#806: an entry without a Discord account is confirmed with 'Geprüft & bestätigen', reaches the addon, and stays confirmable after a release", async () => {
        const handouts = require("../../../src/services/guildbank/handouts");
        waitlist.importLines(KEY, "Skerra\tCrimson Spinal\t1", { by: "o1", byName: "Orga" });
        scan(1);
        await guildBank.advanceWaitlist({ bankKey: KEY });
        const open = store.listRequests({ status: "open" })[0];
        expect(open).toMatchObject({ userId: "", characterName: "Skerra", realm: "Spineshatter", fromWaitlist: true, recipientCheckedAt: 0 });
        expect(handouts.handoutList().banks[0].handouts).toEqual([]);
        // the orga checked "Skerra" in game and clicks "Geprüft & bestätigen" on the card
        discord.editPayload.mockClear();
        const done = await guildBank.checkAndConfirm(open.id, { by: "o1", byName: "Arthas" });
        expect(done).toMatchObject({ request: { status: "confirmed", recipientCheckedBy: "o1", recipientCheckedByName: "Arthas" }, dm: false });
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
        const card = discord.editPayload.mock.calls[0][2];
        expect(cardText(card)).toContain("**Skerra** · ohne Discord-Konto, keine DM");
        expect(cardText(card)).not.toContain("Kein verknüpfter Charakter");
        expect(cardButtons(card).map((b) => b.label)).toEqual(["Ausgegeben", "Vormerkung lösen", "Charakter ändern …"]);
        // the addon gets it, to Skerra-Spineshatter
        const [bank] = handouts.handoutList().banks;
        expect(bank.handouts.map((h) => [h.id, h.character.name, h.character.realm])).toEqual([[open.id, "Skerra", "Spineshatter"]]);
        expect(bank.unlinked).toBe(0);
        // released (e.g. it did not go out): open again, and "Bestätigen" works at once — no second check
        discord.editPayload.mockClear();
        await guildBank.releaseRequest(open.id);
        const reopened = discord.editPayload.mock.calls[0][2];
        expect(cardText(reopened)).not.toContain("Kein verknüpfter Charakter");
        expect(cardButtons(reopened).map((b) => [b.label, !!b.disabled])).toEqual([["Bestätigen", false], ["Charakter ändern …", false], ["Ablehnen …", false]]);
        expect(await guildBank.confirmRequest(open.id, { by: "o2", byName: "Jaina" })).toMatchObject({ request: { status: "confirmed" } });
    });

    it("#806: the web vouches for an entry's own name; another bank, a handled request and a nameless one are refused", async () => {
        const entry = waitlist.importLines(KEY, "Skerra\tCrimson Spinal\t1", { by: "o1", byName: "Orga" }).added[0];
        expect(waitlist.listForBank(KEY)[0]).toMatchObject({ linked: false, linkProblem: "none" });
        expect(await guildBank.checkRequestRecipient(entry.id, { bankKey: "other", by: "o1" })).toMatchObject({ code: "not_found" });
        expect(await guildBank.checkRequestRecipient("nope", { bankKey: KEY, by: "o1" })).toMatchObject({ code: "not_found" });
        const checked = await guildBank.checkRequestRecipient(entry.id, { bankKey: KEY, by: "o1", byName: "Arthas" });
        expect(checked.request).toMatchObject({ id: entry.id, linked: true, linkProblem: "", recipientCheckedByName: "Arthas" });
        expect(waitlist.listForBank(KEY)[0]).toMatchObject({ linked: true });
        // it moves up linked: the card offers "Bestätigen" straight away
        scan(1);
        await guildBank.advanceWaitlist({ bankKey: KEY });
        expect(cardButtons(discord.postPayload.mock.calls[0][1]).map((b) => [b.label, !!b.disabled])).toEqual([["Bestätigen", false], ["Charakter ändern …", false], ["Ablehnen …", false]]);
        // a request without any name has nothing to vouch for
        const nameless = store.addWaiting({ userId: "u9", item: "Crimson Spinal", amount: 1, bankKey: KEY, itemId: SPINAL, addedBy: "o1" }).request;
        expect(await guildBank.checkRequestRecipient(nameless.id, { bankKey: KEY, by: "o1" })).toMatchObject({ code: "invalid", error: "Die Anfrage nennt keinen Charakter – erst verknüpfen." });
    });

    it("#806: 'Geprüft & bestätigen' on a request without a name is refused like Bestätigen", async () => {
        const nameless = store.addWaiting({ userId: "u9", item: "Crimson Spinal", amount: 1, bankKey: KEY, itemId: SPINAL, addedBy: "o1" }).request;
        scan(1);
        await guildBank.advanceWaitlist({ bankKey: KEY });
        expect(await guildBank.checkAndConfirm(nameless.id, { by: "o1", byName: "Arthas" })).toMatchObject({ error: guildBank.NOT_LINKED, notLinked: true });
        expect(store.getRequest(nameless.id)).toMatchObject({ status: "open", recipientCheckedAt: 0 });
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
