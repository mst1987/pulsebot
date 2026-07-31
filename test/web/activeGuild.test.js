jest.mock("../../src/web/discord", () => ({ listGuilds: jest.fn() }));
jest.mock("../../src/web/auth", () => ({ getActiveGuild: jest.fn() }));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: jest.fn(() => ({ guildId: "" })) }));

const discord = require("../../src/web/discord");
const auth = require("../../src/web/auth");
const settingsStore = require("../../src/web/settingsStore");
const { activeGuildFor } = require("../../src/web/activeGuild");

beforeEach(() => {
    jest.clearAllMocks();
    settingsStore.getConfig.mockReturnValue({ guildId: "" });
});

describe("web/activeGuild activeGuildFor", () => {
    it("returns the session's explicitly selected guild when set", () => {
        auth.getActiveGuild.mockReturnValue("g-selected");
        expect(activeGuildFor({})).toBe("g-selected");
        expect(discord.listGuilds).not.toHaveBeenCalled();
    });

    // An admin who switched away in the topbar keeps that choice, whatever the
    // configured default says.
    it("prefers the session selection over the configured guild", () => {
        auth.getActiveGuild.mockReturnValue("g2");
        settingsStore.getConfig.mockReturnValue({ guildId: "g1" });
        expect(activeGuildFor({})).toBe("g2");
    });

    it("preselects the configured guild when the session picked none", () => {
        auth.getActiveGuild.mockReturnValue(null);
        settingsStore.getConfig.mockReturnValue({ guildId: " g1 " });
        discord.listGuilds.mockReturnValue([{ id: "g1", name: "Main" }, { id: "g2", name: "Other" }]);
        expect(activeGuildFor({})).toBe("g1");
    });

    // A configured id the bot isn't a member of would make every page load a
    // guild whose channels/roles can never be fetched.
    it("ignores a configured guild the bot is not in", () => {
        auth.getActiveGuild.mockReturnValue(null);
        settingsStore.getConfig.mockReturnValue({ guildId: "g-unknown" });
        discord.listGuilds.mockReturnValue([{ id: "g1" }, { id: "g2" }]);
        expect(activeGuildFor({})).toBe("");
    });

    it("still falls back to the bot's only guild when nothing is configured", () => {
        auth.getActiveGuild.mockReturnValue(null);
        discord.listGuilds.mockReturnValue([{ id: "g1", name: "G" }]);
        expect(activeGuildFor({})).toBe("g1");
    });

    it("returns an empty string when no guild is selected and the bot is in several/none", () => {
        auth.getActiveGuild.mockReturnValue(null);
        discord.listGuilds.mockReturnValue([{ id: "g1" }, { id: "g2" }]);
        expect(activeGuildFor({})).toBe("");

        discord.listGuilds.mockReturnValue([]);
        expect(activeGuildFor({})).toBe("");
    });
});
