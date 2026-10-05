jest.mock("../../../src/services/discord/discord", () => ({
    postPayload: jest.fn(async () => ({ guildId: "g1", channelId: "900000", messageId: "m1", url: "" })),
    editPayload: jest.fn(async () => ({})),
    sendDirectMessage: jest.fn(async () => ({ ok: true, messageId: "dm1" })),
    listCategories: jest.fn(() => [{ id: "cat1", name: "╭・ TBC Montag" }]),
}));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/stores/userPrefsStore", () => ({ getLang: jest.fn(() => "") }));

const discord = require("../../../src/services/discord/discord");
const settingsStore = require("../../../src/stores/settingsStore");
const userPrefs = require("../../../src/stores/userPrefsStore");
const store = require("../../../src/stores/guildBankStore");
const guildBank = require("../../../src/services/signups/guildBank");
const { tempStoreFile } = require("../../helpers/tempStore");

const CONFIG = { botLanguage: "de", guildId: "111111", discordServers: { eventGuilds: [{ guildId: "111111" }], guildBankChannelId: "900000" } };
const INPUT = { item: "Super Mana Potion", amount: "12", purpose: "BT" };

beforeAll(() => store.useFile(tempStoreFile("guild-bank.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    for (const r of store.listRequests()) store.removeRequest(r.id);
    settingsStore.getConfig.mockReturnValue(CONFIG);
    userPrefs.getLang.mockReturnValue("");
    jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => console.warn.mockRestore());

const create = (over = {}) => guildBank.createRequest("u1", { ...INPUT, ...over }, { userName: "Anna", categoryId: "cat1" });

describe("services/signups/guildBank", () => {
    it("knows the guild bank channel only when it is an id", () => {
        expect(guildBank.guildBankChannelId(CONFIG)).toBe("900000");
        expect(guildBank.guildBankChannelId({ discordServers: { guildBankChannelId: "kanal" } })).toBe("");
        expect(guildBank.guildBankChannelId({})).toBe("");
    });

    it("stores the request and posts it to the orga channel", async () => {
        const { request } = await create();
        expect(request).toMatchObject({ userId: "u1", userName: "Anna", item: "Super Mana Potion", amount: 12, status: "open", channelId: "900000", messageId: "m1" });
        const [channelId, payload] = discord.postPayload.mock.calls[0];
        expect(channelId).toBe("900000");
        expect(payload.embeds[0].title).toBe("🏦 Anfrage von Anna");
        expect(payload.embeds[0].footer.text).toBe("TBC Montag · offen");
        expect(payload.components[0].components.map((b) => b.custom_id)).toEqual([`guildbank:done:${request.id}`, `guildbank:reject:${request.id}`]);
        expect(store.getRequest(request.id).messageId).toBe("m1");
    });

    it("refuses without a channel, with bad input and above the limit", async () => {
        settingsStore.getConfig.mockReturnValue({ discordServers: {} });
        expect(await create()).toEqual({ error: "Die Gildenbank ist gerade nicht eingerichtet." });
        settingsStore.getConfig.mockReturnValue(CONFIG);
        expect(await create({ amount: "0" })).toEqual({ error: "Die Menge muss eine ganze Zahl von 1 bis 9999 sein." });
        for (let i = 0; i < 5; i++) await create();
        expect(await create()).toEqual({ error: "Höchstens 5 offene Anfragen – warte, bis die Orga eine erledigt hat." });
        expect(discord.postPayload).toHaveBeenCalledTimes(5);
    });

    it("takes a request back when the post fails", async () => {
        discord.postPayload.mockRejectedValueOnce(new Error("Missing Access"));
        expect(await create()).toEqual({ error: "Die Anfrage konnte nicht gepostet werden – versuch es später noch einmal." });
        expect(store.listRequests()).toEqual([]);
    });

    it("resolves a request: edits the post without buttons and DMs the raider in their language", async () => {
        const { request } = await create();
        userPrefs.getLang.mockReturnValue("en");
        const result = await guildBank.resolveRequest(request.id, { by: "o1", byName: "Orga", status: "done" });
        expect(result).toMatchObject({ posted: true, dm: true, request: { status: "done", handledBy: "o1", handledByName: "Orga" } });
        const [channelId, messageId, payload] = discord.editPayload.mock.calls[0];
        expect([channelId, messageId]).toEqual(["900000", "m1"]);
        expect(payload.components).toEqual([]);
        expect(payload.embeds[0].description).toContain("✅ Erledigt von Orga");
        expect(discord.sendDirectMessage).toHaveBeenCalledWith("u1", { content: "🏦 Your request **12× Super Mana Potion** is done." });
    });

    it("declines with a reason, in German for a German raider", async () => {
        const { request } = await create();
        await guildBank.resolveRequest(request.id, { by: "o1", byName: "Orga", status: "rejected", reason: "gerade leer" });
        expect(discord.editPayload.mock.calls[0][2].embeds[0].description).toContain("⛔ Abgelehnt von Orga: gerade leer");
        expect(discord.sendDirectMessage).toHaveBeenCalledWith("u1", { content: "🏦 Deine Anfrage **12× Super Mana Potion** wurde abgelehnt: gerade leer" });
    });

    it("refuses a handled request and draws its post again", async () => {
        const { request } = await create();
        await guildBank.resolveRequest(request.id, { by: "o1", byName: "Orga", status: "done" });
        discord.editPayload.mockClear();
        discord.sendDirectMessage.mockClear();
        const again = await guildBank.resolveRequest(request.id, { by: "o2", byName: "Zweite", status: "rejected" });
        expect(again.error).toBe("Diese Anfrage ist schon erledigt.");
        expect(discord.editPayload).toHaveBeenCalledTimes(1);
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
        expect(await guildBank.resolveRequest("nope", { status: "done" })).toEqual({ error: "Anfrage nicht gefunden." });
    });

    it("never throws on Discord failures: a post that cannot be edited, a DM that does not arrive", async () => {
        const { request } = await create();
        discord.editPayload.mockRejectedValueOnce(new Error("Unknown Message"));
        discord.sendDirectMessage.mockRejectedValueOnce(new Error("Bot nicht verbunden."));
        const result = await guildBank.resolveRequest(request.id, { by: "o1", byName: "Orga", status: "done" });
        expect(result).toMatchObject({ posted: false, dm: false, request: { status: "done" } });

        const second = (await create()).request;
        discord.sendDirectMessage.mockResolvedValueOnce({ ok: false, error: "Cannot send messages to this user" });
        expect((await guildBank.resolveRequest(second.id, { by: "o1", status: "rejected" })).dm).toBe(false);
        expect(await guildBank.redrawPost({ id: "x" })).toBe(false);
    });

    it("names no category when the bot cannot list them", async () => {
        discord.listCategories.mockImplementationOnce(() => { throw new Error("offline"); });
        expect(guildBank.postFor({ ...store.addRequest({ userId: "u9", item: "x", amount: 1, categoryId: "cat1" }).request }).embeds[0].footer.text).toBe("offen");
    });
});
