jest.mock("../../src/web/discord", () => ({
    getGuild: jest.fn(),
    botPermissionsIn: jest.fn(),
    fetchGuildMembersCached: jest.fn(),
}));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: jest.fn() }));

const discord = require("../../src/web/discord");
const { getConfig } = require("../../src/web/settingsStore");
const guildRoles = require("../../src/web/guildRoles");

const servers = (over = {}) => ({
    eventGuildId: "", talkGuildId: "", talkOverviewChannelId: "", talkPingChannelId: "", ...over,
});
const member = (id, bot = false) => ({ id, user: { bot } });

beforeEach(() => {
    jest.resetAllMocks();
    getConfig.mockReturnValue({ guildId: "", discordServers: servers() });
});

describe("web/guildRoles ids", () => {
    it("falls back to the old guildId when no event server is set", () => {
        getConfig.mockReturnValue({ guildId: "100", discordServers: servers() });
        expect(guildRoles.eventGuildId()).toBe("100");
        expect(guildRoles.talkGuildId()).toBe("");
        expect(guildRoles.configuredGuildIds()).toEqual(["100"]);
    });

    it("prefers the event server over guildId and adds the talk server", () => {
        const config = { guildId: "100", discordServers: servers({ eventGuildId: "200", talkGuildId: "300" }) };
        expect(guildRoles.eventGuildId(config)).toBe("200");
        expect(guildRoles.talkGuildId(config)).toBe("300");
        expect(guildRoles.configuredGuildIds(config)).toEqual(["200", "300"]);
    });

    it("treats a talk server equal to the event server as no talk server", () => {
        const config = { guildId: "200", discordServers: servers({ talkGuildId: "200" }) };
        expect(guildRoles.talkGuildId(config)).toBe("");
        expect(guildRoles.isTalkGuild("200", config)).toBe(false);
        expect(guildRoles.configuredGuildIds(config)).toEqual(["200"]);
    });

    it("tells the role of a server", () => {
        getConfig.mockReturnValue({ guildId: "", discordServers: servers({ eventGuildId: "200", talkGuildId: "300" }) });
        expect(guildRoles.guildRole("200")).toBe("event");
        expect(guildRoles.guildRole("300")).toBe("talk");
        expect(guildRoles.guildRole("400")).toBe("");
        expect(guildRoles.guildRole("")).toBe("");
        expect(guildRoles.isEventGuild("200")).toBe(true);
        expect(guildRoles.isTalkGuild("300")).toBe(true);
    });

    it("has no configured server on a blank install", () => {
        expect(guildRoles.configuredGuildIds({})).toEqual([]);
        expect(guildRoles.eventGuild({})).toBeNull();
        expect(guildRoles.talkGuild({})).toBeNull();
    });
});

describe("web/guildRoles cards", () => {
    it("describes a connected server with its missing rights", () => {
        discord.getGuild.mockReturnValue({ name: "Pulse Events", memberCount: 212, iconURL: () => "https://cdn/icon.png" });
        discord.botPermissionsIn.mockReturnValue([
            { key: "SendMessages", label: "Nachrichten senden", ok: true },
            { key: "ManageRoles", label: "Rollen verwalten", ok: false },
        ]);
        const card = guildRoles.eventGuild({ discordServers: servers({ eventGuildId: "200" }) });
        expect(card).toMatchObject({
            role: "event", id: "200", name: "Pulse Events", connected: true, memberCount: 212,
            iconUrl: "https://cdn/icon.png", missing: ["Rollen verwalten"],
        });
        expect(discord.botPermissionsIn).toHaveBeenCalledWith("200");
    });

    // A server the bot is not on: nothing is known, so nothing reads as missing.
    it("describes a server the bot is not on as not connected, rights unknown", () => {
        discord.getGuild.mockReturnValue(null);
        const card = guildRoles.talkGuild({ discordServers: servers({ eventGuildId: "200", talkGuildId: "300" }) });
        expect(card).toEqual({
            role: "talk", id: "300", name: "", connected: false, memberCount: null, iconUrl: "", permissions: null, missing: [],
        });
        expect(discord.botPermissionsIn).not.toHaveBeenCalled();
    });
});

describe("web/guildRoles memberOverlap", () => {
    const two = { discordServers: servers({ eventGuildId: "200", talkGuildId: "300" }) };

    it("is null without a second server", async () => {
        expect(await guildRoles.memberOverlap({ guildId: "200", discordServers: servers() })).toBeNull();
    });

    it("counts the human members that are on both servers", async () => {
        discord.getGuild.mockImplementation((id) => ({ id }));
        discord.fetchGuildMembersCached.mockImplementation(async (id) => (id === "200"
            ? [member("a"), member("b"), member("c"), member("bot", true)]
            : [member("b"), member("c"), member("d"), member("bot", true)]));
        expect(await guildRoles.memberOverlap(two)).toEqual({ eventCount: 3, talkCount: 3, both: 2, error: null });
    });

    it("reports a failed member fetch instead of throwing", async () => {
        discord.getGuild.mockImplementation((id) => ({ id }));
        discord.fetchGuildMembersCached.mockRejectedValue(new Error("Used disallowed intents"));
        expect(await guildRoles.memberOverlap(two)).toEqual({
            eventCount: null, talkCount: null, both: null, error: "Used disallowed intents",
        });
    });

    it("says so when the bot is missing on one server", async () => {
        discord.getGuild.mockImplementation((id) => (id === "200" ? { id } : null));
        const out = await guildRoles.memberOverlap(two);
        expect(out.both).toBeNull();
        expect(out.error).toMatch(/nicht auf beiden/);
        expect(discord.fetchGuildMembersCached).not.toHaveBeenCalled();
    });
});
