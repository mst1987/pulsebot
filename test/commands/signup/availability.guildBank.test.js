// "Anfrage stellen" in the organizer with a guild bank behind it (#633): the
// pick card instead of the free-text modal, picking an item opens its modal,
// the submitted modal is checked against the stock and posted to the orga.
// Without anything offerable the free-text modal stays.
const { MessageFlags } = require("discord.js");
const { answerOf } = require("../../helpers/signupMocks");

jest.mock("../../../src/stores/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/stores/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/stores/settingsStore", () => require("../../helpers/signupMocks").settingsStore());
jest.mock("../../../src/services/discord/discord", () => ({
    ...require("../../helpers/signupMocks").discord(),
    sendDirectMessage: jest.fn(async () => ({ ok: true, messageId: "dm" })),
    postPayload: jest.fn(async () => ({ guildId: "g1", channelId: "900000", messageId: "m-bank", url: "" })),
}));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1, logcheckAdminIds: [], adminRoleIds: [] }));

const mocks = require("../../helpers/signupMocks");
const discord = require("../../../src/services/discord/discord");
const profiles = require("../../../src/stores/raiderProfileStore");
const bankStore = require("../../../src/stores/guildBankStore");
const stockStore = require("../../../src/stores/guildBankStockStore");
const command = require("../../../src/commands/signup/availability");
const { parseGuildBankScan, GB_FORMAT } = require("../../../src/utils/guildbank/guildBankScan");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { tempStoreFile } = require("../../helpers/tempStore");
const { cardText, cardControls } = require("../../helpers/cardText");

const ANNA = "200000000000000001";
const RUBY = 32193;
const CONFIG = { botLanguage: "de", discordServers: { eventGuilds: [{ guildId: "g1" }], guildBankChannelId: "900000" } };
let KEY;

const click = (customId, extra = {}) => Object.assign(mockInteraction({ customId, userId: ANNA, ...extra }), { guildId: "g1" });
const pickItem = (values) => click("availability:bp:cat1:0", { values });
/** A submitted item modal: text inputs and, optionally, the character select. */
function submit(customId, fields, character = null) {
    const i = click(customId, { modal: true, options: fields });
    i.fields.getStringSelectValues = jest.fn((id) => {
        if (id === "character" && character) return [character];
        throw new Error("no such field");
    });
    return i;
}

beforeAll(() => {
    profiles.useFile(tempStoreFile("profiles.json"));
    bankStore.useFile(tempStoreFile("guild-bank.json"));
    stockStore.useFile(tempStoreFile("guild-bank-stock.json"));
});
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
    bankStore.useFile(null);
    stockStore.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mocks.reset();
    mocks.access.config = CONFIG;
    discord.postPayload.mockClear();
    for (const r of bankStore.listRequests()) bankStore.removeRequest(r.id);
    for (const b of stockStore.listBanks()) stockStore.removeBank(b.key);
    const scan = parseGuildBankScan({
        format: GB_FORMAT, version: 1, client: { project: "tbc" }, guild: { name: "Die Gilde", realm: "Spineshatter", faction: "Horde" },
        scannedAt: 1791000000, tabs: [{ index: 1, name: "A", items: [{ itemId: RUBY, count: 10 }] }],
    });
    KEY = stockStore.recordScan(scan, { now: 1, guildId: "g1" }).bank.key;
    stockStore.setItemMeta("tbc", RUBY, { name: "Klobiger lebendiger Rubin", icon: "inv_ruby", classId: 3, className: "Edelsteine" }, { source: "wowhead" });
    stockStore.setItemSettings(KEY, RUBY, { status: "give", maxPerRequest: 5 });
});

describe("Gildenbank aus dem Bestand", () => {
    it("Anfrage stellen zeigt die Auswahl nach Kategorie statt des Freitext-Formulars", async () => {
        const i = click("availability:b:cat1");
        await command.execute(i);
        expect(i.showModal).not.toHaveBeenCalled();
        const payload = i.reply.mock.calls[0][0];
        expect(payload.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
        expect(cardText(payload)).toContain("## Was brauchst du?");
        expect(cardText(payload)).toContain("**Edelsteine**\n-# 1 Sorte");
        expect(cardControls(payload)[0].options).toEqual([{ label: "Klobiger lebendiger Rubin", description: "Verfügbar: 10 · max. 5 pro Anfrage", value: String(RUBY) }]);
    });

    it("ohne etwas Ausgebbares bleibt das Freitext-Formular", async () => {
        stockStore.setItemSettings(KEY, RUBY, { status: "show" });
        const i = click("availability:b:cat1");
        await command.execute(i);
        expect(i.showModal.mock.calls[0][0].toJSON().custom_id).toBe("availability:mb:cat1");
    });

    it("die Wahl öffnet das Formular des Gegenstands, mit Charakterwahl ab zwei Charakteren", async () => {
        const one = pickItem([String(RUBY)]);
        await command.execute(one);
        const modal = one.showModal.mock.calls[0][0];
        expect(modal.custom_id).toBe(`availability:mbi:cat1:${RUBY}`);
        expect(modal.components).toHaveLength(3);

        profiles.addCharacter(ANNA, { name: "Zibbo", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] });
        profiles.addCharacter(ANNA, { name: "Zibbowar", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "ready" }] });
        const two = pickItem([String(RUBY)]);
        await command.execute(two);
        expect(two.showModal.mock.calls[0][0].components[3].component.options.map((o) => [o.value, o.default])).toEqual([["zibbo", true], ["zibbowar", false]]);
    });

    it("ein inzwischen vergebener Gegenstand: ein Hinweis statt des Formulars", async () => {
        stockStore.setItemSettings(KEY, RUBY, { status: "hide" });
        const i = pickItem([String(RUBY)]);
        await command.execute(i);
        expect(i.showModal).not.toHaveBeenCalled();
        expect(answerOf(i.reply.mock.calls[0][0]).description).toBe("⚠️ Diesen Gegenstand gibt es gerade nicht in der Gildenbank.");
    });

    it("Absenden prüft gegen den Bestand, postet an die Orga und nennt den Empfänger", async () => {
        profiles.addCharacter(ANNA, { name: "Zibbo", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] });
        profiles.addCharacter(ANNA, { name: "Zibbowar", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "ready" }] });
        const sent = submit(`availability:mbi:cat1:${RUBY}`, { amount: "3", purpose: "Gruul" }, "zibbowar");
        await command.execute(sent);
        expect(sent.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        const answer = answerOf(sent.editReply.mock.calls[0][0]);
        expect(answer.title).toBe("✅ Anfrage gesendet – die Orga meldet sich per DM.");
        expect(answer.description).toBe("**3× Klobiger lebendiger Rubin**\nWofür: Gruul\nAn: Zibbowar-Spineshatter");
        expect(bankStore.listRequests()).toEqual([expect.objectContaining({ itemId: RUBY, bankKey: KEY, amount: 3, characterName: "Zibbowar", faction: "Horde" })]);
        expect(cardText(discord.postPayload.mock.calls[0][1])).toContain("## 3× Klobiger lebendiger Rubin");
    });

    it("ohne Charakterwahl im Formular und ohne Wofür-Feld: der erste Charakter, kein Zweck", async () => {
        profiles.addCharacter(ANNA, { name: "Zibbo", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] });
        const sent = click(`availability:mbi:cat1:${RUBY}`, { modal: true });
        sent.fields.getTextInputValue = jest.fn((id) => {
            if (id === "amount") return "1";
            throw new Error("no such field");
        });
        await command.execute(sent);
        expect(bankStore.listRequests()).toEqual([expect.objectContaining({ amount: 1, purpose: "", characterName: "Zibbo" })]);
    });

    it("ein Bestand, der beim Absenden weg ist, und eine leere Wahl", async () => {
        stockStore.removeBank(KEY);
        const sent = submit(`availability:mbi:cat1:${RUBY}`, { amount: "1" });
        await command.execute(sent);
        expect(answerOf(sent.editReply.mock.calls[0][0]).description).toBe("⚠️ Diesen Gegenstand gibt es gerade nicht in der Gildenbank.");
        const empty = click("availability:bp:cat1:0", { values: [] });
        empty.values = undefined;
        await command.execute(empty);
        expect(empty.showModal).not.toHaveBeenCalled();
    });

    it("zu viel: über maxPerRequest und über Verfügbar, auf Englisch für einen englischen Server", async () => {
        mocks.access.config = { ...CONFIG, botLanguage: "en" };
        const tooMany = submit(`availability:mbi:cat1:${RUBY}`, { amount: "6" });
        await command.execute(tooMany);
        expect(answerOf(tooMany.editReply.mock.calls[0][0]).description).toBe("⚠️ At most 5 per request.");
        stockStore.setItemSettings(KEY, RUBY, { reserve: 8 });
        const left = submit(`availability:mbi:cat1:${RUBY}`, { amount: "3" });
        await command.execute(left);
        expect(answerOf(left.editReply.mock.calls[0][0]).description).toBe("⚠️ Only 2 left.");
        expect(discord.postPayload).not.toHaveBeenCalled();
    });
});
