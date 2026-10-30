jest.mock("../../../../src/services/discord/discord", () => ({
    getGuild: jest.fn(),
    botPermissionsIn: jest.fn(),
    fetchGuildMembersCached: jest.fn(),
}));
jest.mock("../../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn() }));

const discord = require("../../../../src/services/discord/discord");
const { getConfig } = require("../../../../src/stores/settings/settingsStore");
const guildRoles = require("../../../../src/services/discord/roles/guildRoles");

// Ids must look like snowflakes (5+ digits): the old-shape blocks are migrated by configSchema.
const HOME = "10000";
const E1 = "20000";
const E2 = "30000";
const T = "40000";
const X = "90000";
const C1 = "90100";

// The server federation (#890) as getConfig() hands it over.
const block = (over = {}) => ({ servers: [], links: [], ...over });
const server = (guildId, label = "") => ({ guildId, label });
// An old event-server block (before #890).
const legacy = (over = {}) => ({ eventGuilds: [], talkGuildId: "", talkPingChannelId: "", ...over });
const eventGuild = (guildId, extra = {}) => ({ guildId, label: "", overviewGuildId: "", overviewChannelId: "", ...extra });
const member = (id, bot = false) => ({ id, user: { bot } });

beforeEach(() => {
    jest.resetAllMocks();
    getConfig.mockReturnValue({ guildId: "", discordServers: block() });
});


describe("services/discord/roles/guildRoles ids", () => {
    it("falls back to the old guildId when no server is set", () => {
        getConfig.mockReturnValue({ guildId: HOME, discordServers: block() });
        expect(guildRoles.serverIds()).toEqual([HOME]);
        expect(guildRoles.configuredGuildIds()).toEqual([HOME]);
    });

    it("lists every server, deduped, in order; eventGuildIds is the same list", () => {
        const config = { guildId: HOME, discordServers: block({ servers: [server(E1), server(E2), server(E1)] }) };
        expect(guildRoles.serverIds(config)).toEqual([E1, E2]);
        expect(guildRoles.eventGuildIds(config)).toEqual([E1, E2]);
        expect(guildRoles.isEventGuild(E2, config)).toBe(true);
        expect(guildRoles.isEventGuild(X, config)).toBe(false);
    });

    // #897: no talk role any more, every server of the list is an equal one.
    it("tells the role of a server: one of the list or none", () => {
        getConfig.mockReturnValue({ guildId: "", discordServers: block({ servers: [server(E1), server(T)] }) });
        expect(guildRoles.guildRole(E1)).toBe("event");
        expect(guildRoles.guildRole(T)).toBe("event");
        expect(guildRoles.guildRole(X)).toBe("");
        expect(guildRoles.guildRole("")).toBe("");
    });

    it("no longer offers the talk-server readers (#897)", () => {
        for (const name of ["eventGuildId", "talkGuildId", "isTalkGuild", "legacyEventGuilds", "eventGuild", "talkGuild", "memberOverlap"]) {
            expect(guildRoles[name]).toBeUndefined();
        }
    });

    it("has no configured server on a blank install", () => {
        expect(guildRoles.configuredGuildIds({})).toEqual([]);
        expect(guildRoles.eventGuildCards({})).toEqual([]);
    });

    it("reads a server's label", () => {
        const config = { discordServers: block({ servers: [server(E1, "PvE"), server(E2)] }) };
        expect(guildRoles.serverLabel(E1, config)).toBe("PvE");
        expect(guildRoles.serverLabel(E2, config)).toBe("");
        expect(guildRoles.serverLabel(X, config)).toBe("");
    });
});

// A block handed in directly in the old shape is read the way configSchema migrates it.
describe("services/discord/roles/guildRoles readers on an old block", () => {
    it("the old talk server becomes an ordinary server after the event servers", () => {
        const config = { guildId: HOME, discordServers: legacy({ eventGuilds: [eventGuild(E1)], talkGuildId: T }) };
        expect(guildRoles.serverIds(config)).toEqual([E1, T]);
        expect(guildRoles.guildRole(E1, config)).toBe("event");
        expect(guildRoles.guildRole(T, config)).toBe("event");
    });

    it("only the old guildId", () => {
        const config = { guildId: HOME, discordServers: legacy() };
        expect(guildRoles.serverIds(config)).toEqual([HOME]);
    });

    it("the overview target becomes the link of its server", () => {
        const config = { discordServers: legacy({ eventGuilds: [eventGuild(E1, { overviewGuildId: T, overviewChannelId: C1 })], talkGuildId: T }) };
        expect(guildRoles.linkedTargets(E1, config)).toEqual([{ from: E1, to: T, channelId: C1, lang: "", versions: [] }]);
    });
});

describe("services/discord/roles/guildRoles links", () => {
    const config = {
        discordServers: block({
            servers: [server(E1), server(E2), server(T)],
            links: [{ from: E1, to: T, channelId: C1 }, { from: E2, to: T, channelId: "90200" }, { from: E1, to: E1, channelId: "90300" }],
        }),
    };

    it("lists the stored links", () => {
        expect(guildRoles.links(config)).toHaveLength(3);
        expect(guildRoles.links({ discordServers: block() })).toEqual([]);
    });

    it("tells which raid lists a server shows and where a server's list goes", () => {
        expect(guildRoles.linkedSources(T, config).map((l) => l.from)).toEqual([E1, E2]);
        expect(guildRoles.linkedSources(E1, config).map((l) => l.from)).toEqual([E1]);
        expect(guildRoles.linkedTargets(E1, config).map((l) => l.to)).toEqual([T, E1]);
        expect(guildRoles.linkedTargets(T, config)).toEqual([]);
        expect(guildRoles.linkedSources("", config)).toEqual([]);
    });
});


describe("services/discord/roles/guildRoles cards", () => {
    it("describes a connected server with its missing rights", () => {
        discord.getGuild.mockReturnValue({ name: "Pulse Events", memberCount: 212, iconURL: () => "https://cdn/icon.png" });
        discord.botPermissionsIn.mockReturnValue([
            { key: "SendMessages", label: "Nachrichten senden", ok: true },
            { key: "ManageRoles", label: "Rollen verwalten", ok: false },
        ]);
        const [card] = guildRoles.eventGuildCards({ discordServers: block({ servers: [server(E1)] }) });
        expect(card).toMatchObject({
            role: "event", id: E1, name: "Pulse Events", connected: true, memberCount: 212,
            iconUrl: "https://cdn/icon.png", missing: ["Rollen verwalten"],
        });
        expect(discord.botPermissionsIn).toHaveBeenCalledWith(E1);
    });

    // A server the bot is not on: nothing is known, so nothing reads as missing.
    it("describes a server the bot is not on as not connected, rights unknown", () => {
        discord.getGuild.mockReturnValue(null);
        expect(guildRoles.describeGuild(T, "event")).toEqual({
            role: "event", id: T, name: "", connected: false, memberCount: null, iconUrl: "", permissions: null, missing: [],
        });
        expect(guildRoles.describeGuild("", "event")).toBeNull();
        expect(discord.botPermissionsIn).not.toHaveBeenCalled();
    });

    it("lists a card per server, with its first own link as the overview target", () => {
        discord.getGuild.mockImplementation((id) => ({ id, name: id === E1 ? "PvE" : id === E2 ? "PvP" : "Talk", memberCount: 1, iconURL: () => "" }));
        discord.botPermissionsIn.mockReturnValue([]);
        const config = {
            discordServers: block({
                servers: [server(E1, "PvE"), server(E2, "PvP"), server(T)],
                links: [{ from: E1, to: T, channelId: C1 }],
            }),
        };
        expect(guildRoles.eventGuildCards(config)).toEqual([
            expect.objectContaining({ id: E1, label: "PvE", overviewGuildId: T, overviewChannelId: C1, overviewGuildName: "Talk" }),
            expect.objectContaining({ id: E2, label: "PvP", overviewGuildId: "", overviewChannelId: "", overviewGuildName: "" }),
            expect.objectContaining({ id: T, label: "", overviewGuildId: "", overviewChannelId: "" }),
        ]);
    });

    it("has no card without a server", () => {
        expect(guildRoles.eventGuildCards({ discordServers: block() })).toEqual([]);
    });
});

describe("services/discord/roles/guildRoles server pick (#895)", () => {
    const cfg = { guildId: "", discordServers: block({ servers: [server(E1), server(T, "Talk")] }) };

    it("takes a guildId of the list, refuses one outside it", () => {
        expect(guildRoles.resolveServer({ guildId: T }, cfg)).toBe(T);
        expect(guildRoles.resolveServer({ guildId: X }, cfg)).toBeNull();
    });

    // #897: an old ?side=talk link has no talk server to go to any more.
    it("falls back to the first server, an old side too", () => {
        expect(guildRoles.resolveServer({}, cfg)).toBe(E1);
        expect(guildRoles.resolveServer({ side: "talk" }, cfg)).toBe(E1);
        expect(guildRoles.resolveServer({}, { guildId: "", discordServers: block() })).toBe("");
    });

    it("lists the servers with Discord name, label, icon and whether the bot is there", () => {
        discord.getGuild.mockImplementation((id) => (id === E1 ? { id, name: "Gilde", iconURL: () => "https://cdn/i.png" } : null));
        expect(guildRoles.serverChoices(cfg)).toEqual([
            { guildId: E1, name: "Gilde", label: "", online: true, iconUrl: "https://cdn/i.png" },
            { guildId: T, name: "", label: "Talk", online: false, iconUrl: "" },
        ]);
    });

    it("places a role message by its guildId, one without by the first server", () => {
        expect(guildRoles.roleMessageGuild({ guildId: X }, cfg)).toBe(X);
        expect(guildRoles.roleMessageGuild({ guildSide: "talk" }, cfg)).toBe(E1);
        expect(guildRoles.roleMessageGuild(null, cfg)).toBe(E1);
        expect(guildRoles.roleMessageGuild(null, { guildId: "", discordServers: block() })).toBe("");
    });
});

// #896: the overlap of any two servers, per role-sync pair.
describe("services/discord/roles/guildRoles guildOverlap", () => {
    it("is null without two different servers", async () => {
        expect(await guildRoles.guildOverlap(E1, "")).toBeNull();
        expect(await guildRoles.guildOverlap(E1, E1)).toBeNull();
        expect(discord.fetchGuildMembersCached).not.toHaveBeenCalled();
    });

    it("counts the humans on both of the two servers it is given", async () => {
        discord.getGuild.mockImplementation((id) => ({ id }));
        discord.fetchGuildMembersCached.mockImplementation(async (id) => (id === T
            ? [member("a"), member("b"), member("bot", true)]
            : [member("b")]));
        expect(await guildRoles.guildOverlap(T, "900077")).toEqual({ fromCount: 2, toCount: 1, both: 1, error: null });
    });

    // took over from the removed memberOverlap() (#897): a failed member list comes back as error, never thrown
    it("returns a failed member list as error", async () => {
        discord.getGuild.mockImplementation((id) => ({ id }));
        discord.fetchGuildMembersCached.mockRejectedValue(new Error("Missing Access"));
        expect(await guildRoles.guildOverlap(T, "900077")).toEqual({ fromCount: null, toCount: null, both: null, error: "Missing Access" });
        discord.fetchGuildMembersCached.mockRejectedValue({});
        expect((await guildRoles.guildOverlap(T, "900077")).error).toMatch(/GuildMembers-Intent/);
    });

    it("says so when the bot is not on both servers", async () => {
        discord.getGuild.mockImplementation((id) => (id === T ? { id } : null));
        expect(await guildRoles.guildOverlap(T, "900077")).toEqual({ fromCount: null, toCount: null, both: null, error: "Der Bot ist nicht auf beiden Servern." });
        expect(discord.fetchGuildMembersCached).not.toHaveBeenCalled();
    });
});
