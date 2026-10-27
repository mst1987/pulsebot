jest.mock("../../../src/services/discord/discord", () => ({ listGuilds: jest.fn() }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({ guildId: "" })) }));

const discord = require("../../../src/services/discord/discord");
const settingsStore = require("../../../src/stores/settingsStore");
const { pickActiveGuild } = require("../../../src/web/http/guildChoice");

beforeEach(() => {
    jest.clearAllMocks();
    settingsStore.getConfig.mockReturnValue({ guildId: "" });
    discord.listGuilds.mockReturnValue([]);
});

describe("web/http/guildChoice pickActiveGuild (#925)", () => {
    it("keeps an explicit selection", () => {
        settingsStore.getConfig.mockReturnValue({ guildId: "g1" });
        expect(pickActiveGuild("g2")).toBe("g2");
    });

    it("takes the configured guild when the bot is a member", () => {
        settingsStore.getConfig.mockReturnValue({ guildId: "g1" });
        discord.listGuilds.mockReturnValue([{ id: "g1" }, { id: "g2" }]);
        expect(pickActiveGuild(null)).toBe("g1");
    });

    // A configured guild the bot is not in must not become the server whose
    // rights decide - that would be a server no one can manage.
    it("ignores a configured guild the bot is not in", () => {
        settingsStore.getConfig.mockReturnValue({ guildId: "gX" });
        discord.listGuilds.mockReturnValue([{ id: "g1" }, { id: "g2" }]);
        expect(pickActiveGuild(null)).toBe("");
    });

    it("falls back to the only guild", () => {
        discord.listGuilds.mockReturnValue([{ id: "g1" }]);
        expect(pickActiveGuild(undefined)).toBe("g1");
    });

    it("returns an empty id when nothing can be chosen", () => {
        expect(pickActiveGuild("")).toBe("");
    });
});
