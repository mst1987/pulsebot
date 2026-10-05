// Das Panel der Ab-/Anwesenheiten je Raid-Kategorie: posten, ersetzen, entfernen.
let mockConfig = { botLanguage: "en" };
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));
let mockNext = null;
jest.mock("../../../src/services/signups/organizer", () => ({ nextRaidSummary: jest.fn(() => mockNext) }));
jest.mock("../../../src/logger", () => ({ warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() }));
jest.mock("../../../src/services/discord/guildRoles", () => ({ eventGuildIds: () => ["g1", "g2"] }));
jest.mock("../../../src/services/discord/discord", () => ({
    listCategories: jest.fn((guildId) => (guildId === "g2" ? [{ id: "cat1", name: "Raids TBC" }] : [])),
    postPayload: jest.fn(async (channelId) => ({ guildId: "g2", channelId, messageId: `m-${channelId}`, url: `https://x/${channelId}` })),
    deleteMessage: jest.fn(async () => true),
    editPayload: jest.fn(async () => ({})),
}));

const discord = require("../../../src/services/discord/discord");
const logger = require("../../../src/logger");
const store = require("../../../src/stores/availabilityStore");
const panel = require("../../../src/services/signups/availabilityPanel");
const { tempStoreFile } = require("../../helpers/tempStore");

beforeAll(() => store.useFile(tempStoreFile("eh-availability-panel.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    mockConfig = { botLanguage: "en" };
    mockNext = null;
    jest.clearAllMocks();
    for (const p of store.listPanels()) store.removePanel(p.categoryId);
    for (const id of Object.keys(store.listLinks())) store.setLinks(id, []);
});

// The container's texts and button custom ids, flattened (the payload is API JSON).
const texts = (payload) => JSON.stringify(payload.components[0]).match(/"content":"[^"]*"/g).map((t) => JSON.parse(`{${t}}`).content);
const customIds = (payload) => JSON.stringify(payload.components[0]).match(/"custom_id":"[^"]*"/g).map((t) => t.slice(13, -1));

describe("availabilityPanel", () => {
    it("findet den Kategorienamen auf irgendeinem Event-Server", () => {
        expect(panel.categoryNameFor("cat1")).toBe("Raids TBC");
        expect(panel.categoryNameFor("cat9")).toBe("");
        discord.listCategories.mockImplementationOnce(() => {
            throw new Error("offline");
        });
        expect(panel.categoryNameFor("cat1")).toBe("Raids TBC");
    });

    it("postet den Organizer mit dem Kategorienamen und seinen Knöpfen", async () => {
        const res = await panel.postPanel({ categoryId: "cat1", channelId: "c1", by: "u1" });
        expect(res).toMatchObject({ url: "https://x/c1", panel: { categoryId: "cat1", channelId: "c1", messageId: "m-c1", postedBy: "u1" } });
        const payload = discord.postPayload.mock.calls[0][1];
        expect(payload.flags).toBe(32768);
        expect(payload.embeds).toEqual([]);
        expect(texts(payload)[0]).toBe("## Raid hub · Raids TBC\n-# Everything for your Raids TBC raids in one place");
        expect(customIds(payload)).toEqual(["availability:a:cat1", "availability:p:cat1", "availability:l:cat1", "availability:o:cat1"]);
    });

    it("trägt den nächsten Raid und die Links der Kategorie im Panel", async () => {
        mockNext = { startTime: 1900000000, attending: 7 };
        store.setLinks("cat1", [{ label: "WCL", url: "https://www.warcraftlogs.com/x" }]);
        await panel.postPanel({ categoryId: "cat1", channelId: "c1" });
        const payload = discord.postPayload.mock.calls[0][1];
        expect(customIds(payload)).toContain("availability:r:cat1");
        expect(texts(payload).join("\n")).toContain("<t:1900000000:R> · 7 signed up");
        expect(JSON.stringify(payload.components[0])).toContain("https://www.warcraftlogs.com/x");
    });

    it("ändert sich der Fingerabdruck, wenn Links oder der nächste Raid sich ändern", async () => {
        await panel.postPanel({ categoryId: "cat1", channelId: "c1" });
        expect(await panel.refreshPanels({ onlyStale: true })).toEqual({ edited: 0, failed: 0, unchanged: 1 });
        store.setLinks("cat1", [{ label: "Info", url: "https://example.com" }]);
        expect(await panel.refreshPanels({ onlyStale: true })).toEqual({ edited: 1, failed: 0, unchanged: 0 });
        mockNext = { startTime: 1900000000, attending: 1 };
        expect(await panel.refreshPanels({ onlyStale: true })).toEqual({ edited: 1, failed: 0, unchanged: 0 });
    });

    it("postet auf Deutsch, wenn der Server Deutsch spricht, und zeichnet Panels bei einem Wechsel neu", async () => {
        mockConfig = {};
        await panel.postPanel({ categoryId: "cat1", channelId: "c1" });
        const de = discord.postPayload.mock.calls[0][1];
        expect(texts(de)[0]).toBe("## Raid-Zentrale · Raids TBC\n-# Alles für deine Raids TBC-Raids an einem Ort");
        expect(JSON.stringify(de.components[0])).toContain("Abwesend eintragen");
        mockConfig = { botLanguage: "en" };
        discord.editPayload.mockClear();
        expect(await panel.refreshPanels()).toEqual({ edited: 1, failed: 0, unchanged: 0 });
        const en = discord.editPayload.mock.calls[0][2];
        expect(discord.editPayload.mock.calls[0].slice(0, 2)).toEqual(["c1", "m-c1"]);
        expect(texts(en)[0]).toContain("## Raid hub · Raids TBC");
        discord.editPayload.mockRejectedValueOnce(new Error("Unknown Message"));
        expect(await panel.refreshPanels()).toEqual({ edited: 0, failed: 1, unchanged: 0 });
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

    // Panels posted before a deploy changed their text stayed as they were:
    // the ones from before #586 kept speaking English.
    describe("nach einem Deploy", () => {
        it("merkt sich beim Posten den Fingerabdruck dessen, was das Panel zeigt", async () => {
            await panel.postPanel({ categoryId: "cat1", channelId: "c1" });
            const payload = discord.postPayload.mock.calls[0][1];
            expect(store.getPanel("cat1").hash).toBe(panel.payloadHash(payload));
            expect(panel.payloadHash(payload)).toMatch(/^[0-9a-f]{16}$/);
        });

        it("zeichnet mit onlyStale nur Panels neu, deren Inhalt sich geändert hat", async () => {
            await panel.postPanel({ categoryId: "cat1", channelId: "c1" });
            // a panel from before the fingerprint, as on the live server
            store.setPanel({ categoryId: "cat2", channelId: "c2", messageId: "m-c2" });
            expect(await panel.refreshPanels({ onlyStale: true })).toEqual({ edited: 1, failed: 0, unchanged: 1 });
            expect(discord.editPayload).toHaveBeenCalledTimes(1);
            expect(discord.editPayload.mock.calls[0].slice(0, 2)).toEqual(["c2", "m-c2"]);
            // now it is current too
            discord.editPayload.mockClear();
            expect(await panel.refreshPanels({ onlyStale: true })).toEqual({ edited: 0, failed: 0, unchanged: 2 });
            expect(discord.editPayload).not.toHaveBeenCalled();
        });

        it("zeichnet ein Panel neu, sobald sich die Sprache geändert hat", async () => {
            await panel.postPanel({ categoryId: "cat1", channelId: "c1" });
            mockConfig = {};
            expect(await panel.refreshPanels({ onlyStale: true })).toMatchObject({ edited: 1 });
            const de = discord.editPayload.mock.calls[0][2];
            expect(texts(de)[0]).toContain("## Raid-Zentrale · Raids TBC");
        });

        it("zeichnet das Panel neu, sobald der Gildenbank-Kanal gesetzt oder geleert wird", async () => {
            await panel.postPanel({ categoryId: "cat1", channelId: "c1" });
            mockConfig = { botLanguage: "en", discordServers: { guildBankChannelId: "900000" } };
            expect(await panel.refreshPanels({ onlyStale: true })).toMatchObject({ edited: 1 });
            expect(customIds(discord.editPayload.mock.calls[0][2])).toContain("availability:b:cat1");
            expect(await panel.refreshPanels({ onlyStale: true })).toMatchObject({ edited: 0, unchanged: 1 });
            mockConfig = { botLanguage: "en", discordServers: { guildBankChannelId: "" } };
            discord.editPayload.mockClear();
            expect(await panel.refreshPanels({ onlyStale: true })).toMatchObject({ edited: 1 });
            expect(customIds(discord.editPayload.mock.calls[0][2])).not.toContain("availability:b:cat1");
        });

        it("zeichnet mit categoryId nur das Panel dieser Kategorie neu", async () => {
            store.setPanel({ categoryId: "cat1", channelId: "c1", messageId: "m-c1" });
            store.setPanel({ categoryId: "cat2", channelId: "c2", messageId: "m-c2" });
            expect(await panel.refreshPanels({ categoryId: "cat2" })).toEqual({ edited: 1, failed: 0, unchanged: 0 });
            expect(discord.editPayload).toHaveBeenCalledTimes(1);
            expect(discord.editPayload.mock.calls[0].slice(0, 2)).toEqual(["c2", "m-c2"]);
            expect(await panel.refreshPanels({ categoryId: "cat9" })).toEqual({ edited: 0, failed: 0, unchanged: 0 });
        });

        it("meldet ein Panel, das sich nicht bearbeiten lässt, nur einmal", async () => {
            store.setPanel({ categoryId: "cat7", channelId: "c7", messageId: "m-c7" });
            discord.editPayload.mockRejectedValue(new Error("Unknown Message"));
            try {
                await panel.refreshPanels({ categoryId: "cat7" });
                await panel.refreshPanels({ categoryId: "cat7" });
                expect(logger.warn).toHaveBeenCalledTimes(1);
                expect(logger.warn.mock.calls[0][0]).toContain("cat7");
                // once it works again, a later failure is said again
                discord.editPayload.mockResolvedValueOnce({});
                await panel.refreshPanels({ categoryId: "cat7" });
                await panel.refreshPanels({ categoryId: "cat7" });
                expect(logger.warn).toHaveBeenCalledTimes(2);
            } finally {
                discord.editPayload.mockReset();
                discord.editPayload.mockImplementation(async () => ({}));
            }
        });

        it("behält den alten Fingerabdruck, wenn das Bearbeiten scheitert, und versucht es beim nächsten Start wieder", async () => {
            store.setPanel({ categoryId: "cat1", channelId: "c1", messageId: "m-c1" });
            discord.editPayload.mockRejectedValueOnce(new Error("Unknown Message"));
            expect(await panel.refreshPanels({ onlyStale: true })).toEqual({ edited: 0, failed: 1, unchanged: 0 });
            expect(store.getPanel("cat1").hash).toBe("");
        });

        it("läuft nach firstDelayMs und dann alle intervalMs, bis stopPanelRefresh", async () => {
            jest.useFakeTimers();
            try {
                store.setPanel({ categoryId: "cat1", channelId: "c1", messageId: "m-c1" });
                panel.startPanelRefresh({ firstDelayMs: 1000, intervalMs: 5000 });
                await jest.advanceTimersByTimeAsync(999);
                expect(discord.editPayload).not.toHaveBeenCalled();
                await jest.advanceTimersByTimeAsync(1);
                expect(discord.editPayload).toHaveBeenCalledTimes(1);
                // current now: the later sweeps find nothing to redraw until the raid changes
                await jest.advanceTimersByTimeAsync(5000);
                expect(discord.editPayload).toHaveBeenCalledTimes(1);
                mockNext = { startTime: 1900000000, attending: 3 };
                await jest.advanceTimersByTimeAsync(5000);
                expect(discord.editPayload).toHaveBeenCalledTimes(2);
                panel.stopPanelRefresh();
                mockNext = { startTime: 1900000000, attending: 4 };
                await jest.advanceTimersByTimeAsync(20000);
                expect(discord.editPayload).toHaveBeenCalledTimes(2);
            } finally {
                panel.stopPanelRefresh();
                jest.useRealTimers();
            }
        });

        it("läuft einmal nach dem Start, verzögert und abbrechbar", async () => {
            jest.useFakeTimers();
            try {
                store.setPanel({ categoryId: "cat1", channelId: "c1", messageId: "m-c1" });
                const t = panel.startPanelRefresh({ firstDelayMs: 1000 });
                expect(panel.startPanelRefresh()).toBe(t);
                expect(discord.editPayload).not.toHaveBeenCalled();
                await jest.advanceTimersByTimeAsync(1000);
                expect(discord.editPayload).toHaveBeenCalledTimes(1);
                panel.stopPanelRefresh();
                panel.startPanelRefresh({ firstDelayMs: 1000 });
                panel.stopPanelRefresh();
                await jest.advanceTimersByTimeAsync(2000);
                expect(discord.editPayload).toHaveBeenCalledTimes(1);
            } finally {
                panel.stopPanelRefresh();
                jest.useRealTimers();
            }
        });
    });
});
