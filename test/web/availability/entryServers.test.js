// Die Server-Blöcke des Ab-/Anwesenheits-Dialogs (src/web/availability/entryServers.js):
// nur Server mit Mitgliedschaft, in der Reihenfolge der Serverliste, je Server seine Kategorien.

jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: () => ({ fromStore: true }) }));
jest.mock("../../../src/services/discord/discord", () => ({ guildMembership: jest.fn() }));
jest.mock("../../../src/services/discord/roles/guildRoles", () => ({
    serverChoices: jest.fn(() => [
        { guildId: "g1", name: "Pulse", label: "Pulse (online)", iconUrl: "https://cdn/g1.png" },
        { guildId: "g2", name: "", label: "PuGs" },
        { guildId: "g3", name: "Fremd", label: "Fremd" },
    ]),
}));
jest.mock("../../../src/services/categories/categoryGuild", () => ({
    categoryContext: jest.fn(() => ({ ctx: true })),
    displayServerOf: jest.fn((id) => ({ c1: "g1", c2: "g2", c3: "g1" })[id] || "g1"),
}));
jest.mock("../../../src/web/availability/entryCategories", () => ({
    entryCategories: jest.fn(() => [
        { id: "c1", name: "TBC", icon: "", versionId: "tbc" },
        { id: "c2", name: "PuG", icon: "", versionId: "forever" },
        { id: "c3", name: "Forever", icon: "", versionId: "forever" },
    ]),
}));

const discord = require("../../../src/services/discord/discord");
const { serverChoices } = require("../../../src/services/discord/roles/guildRoles");
const { categoryContext } = require("../../../src/services/categories/categoryGuild");
const { entryCategories } = require("../../../src/web/availability/entryCategories");
const { entryServers, serverNames } = require("../../../src/web/availability/entryServers");

beforeEach(() => jest.clearAllMocks());

describe("entryServers", () => {
    it("nimmt nur Server mit Mitgliedschaft, in Reihenfolge, je Server seine Kategorien", async () => {
        discord.guildMembership.mockImplementation(async (guildId) => guildId !== "g3");
        const servers = await entryServers("u1", { config: { c: 1 }, categoryNames: { c1: "TBC" } });
        expect(servers).toEqual([
            { guildId: "g1", name: "Pulse", icon: "https://cdn/g1.png", categories: [expect.objectContaining({ id: "c1" }), expect.objectContaining({ id: "c3" })] },
            { guildId: "g2", name: "PuGs", icon: "", categories: [expect.objectContaining({ id: "c2" })] },
        ]);
        expect(discord.guildMembership).toHaveBeenCalledTimes(3);
        expect(entryCategories).toHaveBeenCalledWith(expect.objectContaining({ config: { c: 1 }, categoryNames: { c1: "TBC" } }));
        expect(categoryContext).toHaveBeenCalledTimes(1);
    });

    it("behält einen Server, dessen Mitgliedschaft unbekannt ist", async () => {
        discord.guildMembership.mockResolvedValue(null);
        const servers = await entryServers("u1", { config: {} });
        expect(servers.map((s) => s.guildId)).toEqual(["g1", "g2", "g3"]);
        expect(servers[2].categories).toEqual([]);
    });

    it("ohne Kategorien kein Kategorie-Kontext, ohne Server leer", async () => {
        discord.guildMembership.mockResolvedValue(true);
        entryCategories.mockReturnValueOnce([]);
        const servers = await entryServers("u1");
        expect(servers.every((s) => s.categories.length === 0)).toBe(true);
        expect(categoryContext).not.toHaveBeenCalled();
        expect(serverChoices).toHaveBeenCalledWith({ fromStore: true });
        serverChoices.mockReturnValueOnce([]);
        expect(await entryServers("u1")).toEqual([]);
    });

    it("ohne Nutzer keine Discord-Abfrage", async () => {
        const servers = await entryServers("");
        expect(servers).toHaveLength(3);
        expect(discord.guildMembership).not.toHaveBeenCalled();
    });
});

describe("serverNames", () => {
    it("ordnet jeder Server-ID ihren Namen zu", () => {
        expect(serverNames({})).toEqual({ g1: "Pulse", g2: "PuGs", g3: "Fremd" });
        expect(serverNames()).toEqual({ g1: "Pulse", g2: "PuGs", g3: "Fremd" });
    });
});
