// #809: the two stuck requests of the report — "Gentle" (a Discord raider whose
// request names the typed "Gentle", his real character "Gentletwowl" already
// got guild bank mail) and "Skerra" (no Discord account) — become actionable:
// another character name (known, or checked in game), the cards redrawn at
// start, and "Nicht genug verfügbar" as its own line. Real stores on temp
// files; Discord mocked.
jest.mock("../../../src/services/discord/discord", () => ({
    postPayload: jest.fn(async () => ({ guildId: "g1", channelId: "900000", messageId: `m${Math.random()}`, url: "" })),
    editPayload: jest.fn(async () => ({})),
    sendDirectMessage: jest.fn(async () => ({ ok: true, messageId: "dm1" })),
    listCategories: jest.fn(() => [{ id: "cat1", name: "TBC Montag" }]),
}));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/stores/userPrefsStore", () => ({ getLang: jest.fn(() => ""), getClientLang: jest.fn(() => ""), localeToLang: jest.fn(() => "") }));
jest.mock("../../../src/stores/characterStore", () => ({ listCharacters: jest.fn(() => []), getCharacter: jest.fn(() => null) }));

const discord = require("../../../src/services/discord/discord");
const settingsStore = require("../../../src/stores/settingsStore");
const characterStore = require("../../../src/stores/characterStore");
const store = require("../../../src/stores/guildBankStore");
const stockStore = require("../../../src/stores/guildBankStockStore");
const profiles = require("../../../src/stores/raiderProfileStore");
const guildBank = require("../../../src/services/signups/guildBank");
const waitlist = require("../../../src/services/guildbank/waitlist");
const handouts = require("../../../src/services/guildbank/handouts");
const { resetCache } = require("../../../src/services/characters/characterEvidence");
const { parseGuildBankScan, GB_FORMAT } = require("../../../src/utils/guildbank/guildBankScan");
const { tempStoreFile } = require("../../helpers/tempStore");
const { cardText, cardButtons } = require("../../helpers/cardText");

const CONFIG = { botLanguage: "de", discordServers: { eventGuilds: [{ guildId: "g1" }], guildBankChannelId: "900000" } };
const PYRESTONE = 23440;
const SPINEL = 32227;
let KEY;
let scanAt = 1791000000;

function scan(items) {
    scanAt += 1;
    const parsed = parseGuildBankScan({
        format: GB_FORMAT, version: 1, client: { project: "tbc" }, guild: { name: "Pulse", realm: "Thunderstrike", faction: "Alliance" },
        scannedAt: scanAt, tabs: [{ index: 1, name: "Edelsteine", items }],
    });
    return stockStore.recordScan(parsed, { now: 1, guildId: "g1" }).bank.key;
}

/** The report's state: Gentle and Skerra moved up from the waiting list, open; Gentletwowl got a Crimson Spinel before. */
async function reportState() {
    profiles.addCharacter("u3", { name: "Gentle", className: "Druid" }, { name: "Gentle" });
    // an earlier hand-out to Gentletwowl, imported by name, confirmed and mailed by the addon
    const earlier = waitlist.importLines(KEY, "Gentletwowl\tCrimson Spinel\t1", { by: "o1", byName: "Orga" }).added[0];
    await guildBank.advanceWaitlist({ bankKey: KEY });
    await guildBank.checkAndConfirm(earlier.id, { by: "o1", byName: "Arthas" });
    await handouts.reportHandouts({ done: [{ id: earlier.id, via: "mail" }] }, { token: { name: "Sync" } });
    store.addWaiting({ userId: "u3", userName: "Gentle", characterName: "Gentle", realm: "Thunderstrike", item: "Pyrestone", amount: 1, bankKey: KEY, itemId: PYRESTONE });
    waitlist.importLines(KEY, "Skerra\tCrimson Spinel\t1", { by: "o1", byName: "Orga" });
    await guildBank.advanceWaitlist({ bankKey: KEY });
    const open = store.listRequests({ status: "open" });
    return { gentle: open.find((r) => r.characterName === "Gentle"), skerra: open.find((r) => r.characterName === "Skerra") };
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
    resetCache();
    characterStore.getCharacter.mockReturnValue(null);
    for (const r of store.listRequests()) store.removeRequest(r.id);
    for (const b of stockStore.listBanks()) stockStore.removeBank(b.key);
    profiles.reset();
    settingsStore.getConfig.mockReturnValue(CONFIG);
    KEY = scan([{ itemId: PYRESTONE, count: 4 }, { itemId: SPINEL, count: 7 }]);
    stockStore.setItemMeta("tbc", PYRESTONE, { name: "Pyrestone", icon: "inv_pyrestone" }, { source: "wowhead" });
    stockStore.setItemMeta("tbc", SPINEL, { name: "Crimson Spinel", icon: "inv_spinel" }, { source: "wowhead" });
    stockStore.setItemSettings(KEY, PYRESTONE, { status: "give" });
    stockStore.setItemSettings(KEY, SPINEL, { status: "give" });
    jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => console.warn.mockRestore());

describe("services/signups/guildBank — another character name (#809)", () => {
    it("Gentle: the request goes to Gentletwowl — known from an earlier hand-out, no check needed; the raider and the DMs stay", async () => {
        const { gentle } = await reportState();
        expect(gentle).toMatchObject({ userId: "u3", characterName: "Gentle" });
        discord.editPayload.mockClear();
        const result = await guildBank.reassignRequest(gentle.id, { bankKey: KEY, characterName: "gentletwowl", by: "o1", byName: "Arthas" });
        expect(result.request).toMatchObject({ userId: "u3", userName: "Gentle", characterName: "Gentletwowl", realm: "Thunderstrike", linked: true, recipientCheckedAt: 0 });
        expect(result.profile).toBe("");
        // the card is drawn again at once: Bestätigen works
        const card = discord.editPayload.mock.calls[0][2];
        expect(cardText(card)).toContain("An: Gentletwowl-Thunderstrike");
        expect(cardText(card)).not.toContain("nicht bestätigt");
        expect(cardButtons(card).map((b) => [b.label, !!b.disabled])).toEqual([["Bestätigen", false], ["Charakter ändern …", false], ["Ablehnen …", false]]);
        expect(await guildBank.confirmRequest(gentle.id, { by: "o1", byName: "Arthas" })).toMatchObject({ request: { status: "confirmed" }, dm: true });
        expect(discord.sendDirectMessage.mock.calls.at(-1)[0]).toBe("u3");
    });

    it("puts the name into the raider's profile on request — first, ahead of the typed 'Gentle' — with the class of the class cache", async () => {
        const { gentle } = await reportState();
        characterStore.getCharacter.mockReturnValue({ key: "gentletwowl", character: "Gentletwowl", className: "Priest", source: "report" });
        const result = await guildBank.reassignRequest(gentle.id, { bankKey: KEY, characterName: "Gentletwowl", addToProfile: true, by: "o1", byName: "Arthas" });
        expect(result.profile).toBe("added");
        const chars = profiles.charactersOfVersion(profiles.getProfile("u3"), "tbc");
        expect(chars.map((c) => c.name)).toEqual(["Gentletwowl", "Gentle"]);
        expect(guildBank.charactersFor("u3", stockStore.getBank(KEY))[0]).toMatchObject({ name: "Gentletwowl", className: "Priest" });
        // no class known: nothing added, the orga hears why
        characterStore.getCharacter.mockReturnValue(null);
        expect((await guildBank.reassignRequest(gentle.id, { bankKey: KEY, characterName: "Gentleowl", checked: true, addToProfile: true })).profile).toBe("noClass");
    });

    it("never moves the name past a confirmed main", async () => {
        const { gentle } = await reportState();
        profiles.removeCharacter("u3", "gentle");
        profiles.addCharacter("u3", { name: "Realmain", className: "Mage", source: "log" });
        await guildBank.reassignRequest(gentle.id, { bankKey: KEY, characterName: "Gentletwowl", className: "Priest", addToProfile: true, checked: true, by: "o1" });
        expect(profiles.charactersOfVersion(profiles.getProfile("u3"), "tbc").map((c) => c.name)).toEqual(["Realmain", "Gentletwowl"]);
    });

    it("Skerra: any name the orga checked in game — the card's modal vouches; without evidence and unchecked it is refused", async () => {
        const { skerra } = await reportState();
        expect(await guildBank.reassignRequest(skerra.id, { bankKey: KEY, characterName: "Skerrah" })).toEqual({
            error: "Skerrah ist nirgends belegt – erst im Spiel prüfen („Im Spiel geprüft“).", code: "invalid",
        });
        const result = await guildBank.reassignRequest(skerra.id, { characterName: "Skerra", realm: "", checked: true, by: "o1", byName: "Arthas" });
        expect(result.request).toMatchObject({ userId: "", userName: "Skerra", characterName: "Skerra", realm: "Thunderstrike", linked: true, recipientCheckedByName: "Arthas" });
        expect(discord.sendDirectMessage).not.toHaveBeenCalledWith("", expect.anything());
    });

    it("checks the name by the game's rule and refuses a request that waits no more or of another bank", async () => {
        const { skerra } = await reportState();
        expect(await guildBank.reassignRequest(skerra.id, { characterName: "Sk3rra", checked: true })).toMatchObject({ code: "invalid", error: "Der Name darf nur Buchstaben haben." });
        expect(await guildBank.reassignRequest(skerra.id, { bankKey: "other", characterName: "Skerra", checked: true })).toMatchObject({ code: "not_found" });
        expect(await guildBank.reassignRequest("nope", { characterName: "Skerra", checked: true })).toMatchObject({ code: "not_found" });
        await guildBank.resolveRequest(skerra.id, { status: "rejected" });
        expect(await guildBank.reassignRequest(skerra.id, { characterName: "Skerra", checked: true })).toMatchObject({ code: "not_found" });
    });
});

describe("services/signups/guildBank — cards after a deploy, short stock (#809)", () => {
    it("redraws every posted open and confirmed card from the stock, nothing else", async () => {
        const { gentle, skerra } = await reportState();
        discord.editPayload.mockClear();
        expect(await guildBank.redrawPendingCards()).toBe(2);
        const ids = discord.editPayload.mock.calls.map((c) => c[1]);
        expect(ids).toEqual(expect.arrayContaining([store.getRequest(gentle.id).messageId, store.getRequest(skerra.id).messageId]));
        // a broken Discord costs nothing but the count
        discord.editPayload.mockRejectedValue(new Error("offline"));
        expect(await guildBank.redrawPendingCards()).toBe(0);
        discord.editPayload.mockResolvedValue({});
    });

    it("says 'Nicht genug verfügbar' on its own line and disables confirming, apart from the character problem", async () => {
        const { gentle } = await reportState();
        // 4 Pyrestone, all kept back: nothing available
        stockStore.setItemSettings(KEY, PYRESTONE, { status: "give", reserve: 4 });
        const card = guildBank.postFor(store.getRequest(gentle.id));
        expect(cardText(card)).toContain("Charakter nicht bestätigt");
        expect(cardText(card)).toContain("⚠ **Nicht genug verfügbar** – noch 0, angefragt 1.");
        expect(cardButtons(card).map((b) => [b.label, !!b.disabled])).toEqual([["Geprüft & bestätigen", true], ["Charakter ändern …", false], ["Ablehnen …", false]]);
        // linked now, still short: only the stock line
        await guildBank.reassignRequest(gentle.id, { characterName: "Gentletwowl" });
        const linked = guildBank.postFor(store.getRequest(gentle.id));
        expect(cardText(linked)).not.toContain("nicht bestätigt");
        expect(cardButtons(linked)[0]).toMatchObject({ label: "Bestätigen", disabled: true });
    });
});
