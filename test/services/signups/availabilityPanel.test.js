// Das Panel der Ab-/Anwesenheiten je Raid-Kategorie: posten, ersetzen, entfernen.
let mockConfig = { botLanguage: "en" };
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/services/discord/guildRoles", () => ({ eventGuildIds: () => ["g1", "g2"] }));
jest.mock("../../../src/services/discord/discord", () => ({
    listCategories: jest.fn((guildId) => (guildId === "g2" ? [{ id: "cat1", name: "Raids TBC" }] : [])),
    postPayload: jest.fn(async (channelId) => ({ guildId: "g2", channelId, messageId: `m-${channelId}`, url: `https://x/${channelId}` })),
    deleteMessage: jest.fn(async () => true),
    editPayload: jest.fn(async () => ({})),
}));

const discord = require("../../../src/services/discord/discord");
const store = require("../../../src/stores/availabilityStore");
const panel = require("../../../src/services/signups/availabilityPanel");
const { tempStoreFile } = require("../../helpers/tempStore");

beforeAll(() => store.useFile(tempStoreFile("eh-availability-panel.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    mockConfig = { botLanguage: "en" };
    jest.clearAllMocks();
    for (const p of store.listPanels()) store.removePanel(p.categoryId);
});

describe("availabilityPanel", () => {
    it("findet den Kategorienamen auf irgendeinem Event-Server", () => {
        expect(panel.categoryNameFor("cat1")).toBe("Raids TBC");
        expect(panel.categoryNameFor("cat9")).toBe("");
        discord.listCategories.mockImplementationOnce(() => {
            throw new Error("offline");
        });
        expect(panel.categoryNameFor("cat1")).toBe("Raids TBC");
    });

    it("postet das Panel mit dem Kategorienamen und den drei Knöpfen", async () => {
        const res = await panel.postPanel({ categoryId: "cat1", channelId: "c1", by: "u1" });
        expect(res).toMatchObject({ url: "https://x/c1", panel: { categoryId: "cat1", channelId: "c1", messageId: "m-c1", postedBy: "u1" } });
        const payload = discord.postPayload.mock.calls[0][1];
        expect((payload.embeds[0].data || payload.embeds[0]).title).toBe("Absence & attendance · Raids TBC");
        const ids = payload.components[0].components.map((b) => b.data.custom_id);
        expect(ids).toEqual(["availability:a:cat1", "availability:p:cat1", "availability:l:cat1"]);
    });

    it("postet auf Deutsch, wenn der Server Deutsch spricht, und zeichnet Panels bei einem Wechsel neu", async () => {
        mockConfig = {};
        await panel.postPanel({ categoryId: "cat1", channelId: "c1" });
        const de = discord.postPayload.mock.calls[0][1];
        expect((de.embeds[0].data || de.embeds[0]).title).toBe("Ab- & Anwesenheit · Raids TBC");
        expect(de.components[0].components[0].data.label).toBe("Abwesenheit eintragen");
        mockConfig = { botLanguage: "en" };
        discord.editPayload.mockClear();
        expect(await panel.refreshPanels()).toEqual({ edited: 1, failed: 0 });
        const en = discord.editPayload.mock.calls[0][2];
        expect(discord.editPayload.mock.calls[0].slice(0, 2)).toEqual(["c1", "m-c1"]);
        expect((en.embeds[0].data || en.embeds[0]).title).toBe("Absence & attendance · Raids TBC");
        discord.editPayload.mockRejectedValueOnce(new Error("Unknown Message"));
        expect(await panel.refreshPanels()).toEqual({ edited: 0, failed: 1 });
    });

    it("ersetzt ein früheres Panel der Kategorie und löscht dessen Nachricht", async () => {
        await panel.postPanel({ categoryId: "cat1", channelId: "c1" });
        await panel.postPanel({ categoryId: "cat1", channelId: "c2" });
        expect(discord.deleteMessage).toHaveBeenCalledWith("c1", "m-c1");
        expect(store.listPanels().map((p) => p.channelId)).toEqual(["c2"]);
    });

    it("sagt, was fehlt oder schiefging", async () => {
        expect((await panel.postPanel({ channelId: "c1" })).error).toBe("Keine Kategorie gewählt.");
        expect((await panel.postPanel({ categoryId: "cat1" })).error).toBe("Kein Kanal gewählt.");
        discord.postPayload.mockRejectedValueOnce(new Error("Missing Access"));
        expect((await panel.postPanel({ categoryId: "cat1", channelId: "c1" })).error).toBe("Das Panel konnte nicht gepostet werden: Missing Access");
        expect(store.listPanels()).toEqual([]);
    });

    it("nimmt ein Panel samt Nachricht herunter", async () => {
        await panel.postPanel({ categoryId: "cat1", channelId: "c1" });
        expect((await panel.removePanel("cat1")).messageId).toBe("m-c1");
        expect(discord.deleteMessage).toHaveBeenCalledWith("c1", "m-c1");
        expect(await panel.removePanel("cat1")).toBeNull();
    });
});
