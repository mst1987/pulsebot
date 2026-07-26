jest.mock("../../src/web/discord", () => ({ listGuilds: jest.fn() }));
jest.mock("../../src/web/auth", () => ({ getActiveGuild: jest.fn() }));

const discord = require("../../src/web/discord");
const auth = require("../../src/web/auth");
const { activeGuildFor } = require("../../src/web/activeGuild");

describe("web/activeGuild activeGuildFor", () => {
    it("returns the session's explicitly selected guild when set", () => {
        auth.getActiveGuild.mockReturnValue("g-selected");
        expect(activeGuildFor({})).toBe("g-selected");
        expect(discord.listGuilds).not.toHaveBeenCalled();
    });

    it("falls back to the bot's only guild when none is selected", () => {
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
