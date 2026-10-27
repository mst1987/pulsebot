jest.mock("../../../src/services/discord/discord", () => ({
    getGuild: jest.fn(),
    botPermissionsIn: jest.fn(),
    fetchGuildMembersCached: jest.fn(),
}));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn() }));

const discord = require("../../../src/services/discord/discord");
const { getConfig } = require("../../../src/stores/settingsStore");
const guildRoles = require("../../../src/services/discord/guildRoles");

// Ids must look like snowflakes (5+ digits): the old-shape blocks are migrated by configSchema.
const HOME = "10000";
const E1 = "20000";
const E2 = "30000";
const T = "40000";
const X = "90000";
const C1 = "90100";

// The server federation (#890) as getConfig() hands it over.
const block = (over = {}) => ({ servers: [], links: [], talkGuildId: "", talkPingChannelId: "", ...over });
const server = (guildId, label = "") => ({ guildId, label });
// An old event-server block (before #890).
const legacy = (over = {}) => ({ eventGuilds: [], talkGuildId: "", talkPingChannelId: "", ...over });
const eventGuild = (guildId, extra = {}) => ({ guildId, label: "", overviewGuildId: "", overviewChannelId: "", ...extra });
const member = (id, bot = false) => ({ id, user: { bot } });

beforeEach(() => {
    jest.resetAllMocks();
    getConfig.mockReturnValue({ guildId: "", discordServers: block() });
});

describe("services/discord/guildRoles ids", () => {
    it("falls back to the old guildId when no server is set", () => {
        getConfig.mockReturnValue({ guildId: HOME, discordServers: block() });
        expect(guildRoles.serverIds()).toEqual([HOME]);
        expect(guildRoles.eventGuildId()).toBe(HOME);
        expect(guildRoles.talkGuildId()).toBe("");
        expect(guildRoles.configuredGuildIds()).toEqual([HOME]);
    });

    it("lists every server, deduped, in order; eventGuildIds is the same list", () => {
        const config = { guildId: HOME, discordServers: block({ servers: [server(E1), server(E2), server(E1)] }) };
        expect(guildRoles.serverIds(config)).toEqual([E1, E2]);
        expect(guildRoles.eventGuildIds(config)).toEqual([E1, E2]);
        expect(guildRoles.eventGuildId(config)).toBe(E1);
        expect(guildRoles.isEventGuild(E2, config)).toBe(true);
        expect(guildRoles.isEventGuild(X, config)).toBe(false);
    });

    it("tells the role of a server, the talk server first", () => {
        getConfig.mockReturnValue({ guildId: "", discordServers: block({ servers: [server(E1), server(T)], talkGuildId: T }) });
        expect(guildRoles.guildRole(E1)).toBe("event");
        expect(guildRoles.guildRole(T)).toBe("talk");
        expect(guildRoles.guildRole(X)).toBe("");
        expect(guildRoles.guildRole("")).toBe("");
        expect(guildRoles.isTalkGuild(T)).toBe(true);
        expect(guildRoles.isTalkGuild(E1)).toBe(false);
    });

    it("keeps a server that holds raids and is the talk server at once (#890)", () => {
        const config = { discordServers: block({ servers: [server(E1)], talkGuildId: E1 }) };
        expect(guildRoles.talkGuildId(config)).toBe(E1);
        expect(guildRoles.eventGuildId(config)).toBe(E1);
        expect(guildRoles.isEventGuild(E1, config)).toBe(true);
        expect(guildRoles.isTalkGuild(E1, config)).toBe(true);
        expect(guildRoles.configuredGuildIds(config)).toEqual([E1]);
    });

    it("has no configured server on a blank install", () => {
        expect(guildRoles.configuredGuildIds({})).toEqual([]);
        expect(guildRoles.eventGuild({})).toBeNull();
        expect(guildRoles.talkGuild({})).toBeNull();
    });

    it("reads a server's label", () => {
        const config = { discordServers: block({ servers: [server(E1, "PvE"), server(E2)] }) };
        expect(guildRoles.serverLabel(E1, config)).toBe("PvE");
        expect(guildRoles.serverLabel(E2, config)).toBe("");
        expect(guildRoles.serverLabel(X, config)).toBe("");
    });
});

describe("services/discord/guildRoles links", () => {
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

// Every reader returns for an old block what it returned before #890.
describe("services/discord/guildRoles readers on an old block (same values as before #890)", () => {
    it("event servers + talk server", () => {
        const config = { guildId: HOME, discordServers: legacy({ eventGuilds: [eventGuild(E1)], talkGuildId: T }) };
        expect(guildRoles.eventGuildId(config)).toBe(E1);
        expect(guildRoles.talkGuildId(config)).toBe(T);
        expect(guildRoles.configuredGuildIds(config)).toEqual([E1, T]);
        expect(guildRoles.guildRole(E1, config)).toBe("event");
        expect(guildRoles.guildRole(T, config)).toBe("talk");
    });

    it("only the old guildId", () => {
        const config = { guildId: HOME, discordServers: legacy() };
        expect(guildRoles.eventGuildId(config)).toBe(HOME);
        expect(guildRoles.talkGuildId(config)).toBe("");
        expect(guildRoles.configuredGuildIds(config)).toEqual([HOME]);
    });

    it("a talk server without event server keeps the old guildId as the event server", () => {
        const config = { guildId: HOME, discordServers: legacy({ talkGuildId: T }) };
        expect(guildRoles.eventGuildId(config)).toBe(HOME);
        expect(guildRoles.talkGuildId(config)).toBe(T);
    });

    it("the overview target becomes the link of its server", () => {
        const config = { discordServers: legacy({ eventGuilds: [eventGuild(E1, { overviewGuildId: T, overviewChannelId: C1 })], talkGuildId: T }) };
        expect(guildRoles.linkedTargets(E1, config)).toEqual([{ from: E1, to: T, channelId: C1, lang: "", versions: [] }]);
    });
});

describe("services/discord/guildRoles transition format until #891", () => {
    it("shows every server but the talk server as an old event-server entry, the first own link as its target", () => {
        const config = {
            discordServers: block({
                servers: [server(E1, "PvE"), server(E2, "PvP"), server(T)],
                links: [{ from: E1, to: T, channelId: C1 }, { from: E1, to: E1, channelId: "90300" }],
                talkGuildId: T,
            }),
        };
        expect(guildRoles.legacyEventGuilds(config)).toEqual([
            { guildId: E1, label: "PvE", overviewGuildId: T, overviewChannelId: C1 },
            { guildId: E2, label: "PvP", overviewGuildId: "", overviewChannelId: "" },
        ]);
    });

    it("keeps the talk server in the list when it posts a raid list of its own", () => {
        const config = { discordServers: block({ servers: [server(E1)], links: [{ from: E1, to: E1, channelId: C1 }], talkGuildId: E1 }) };
        expect(guildRoles.legacyEventGuilds(config)).toEqual([{ guildId: E1, label: "", overviewGuildId: E1, overviewChannelId: C1 }]);
    });
});

describe("services/discord/guildRoles cards", () => {
    it("describes a connected server with its missing rights", () => {
        discord.getGuild.mockReturnValue({ name: "Pulse Events", memberCount: 212, iconURL: () => "https://cdn/icon.png" });
        discord.botPermissionsIn.mockReturnValue([
            { key: "SendMessages", label: "Nachrichten senden", ok: true },
            { key: "ManageRoles", label: "Rollen verwalten", ok: false },
        ]);
        const card = guildRoles.eventGuild({ discordServers: block({ servers: [server(E1)] }) });
        expect(card).toMatchObject({
            role: "event", id: E1, name: "Pulse Events", connected: true, memberCount: 212,
            iconUrl: "https://cdn/icon.png", missing: ["Rollen verwalten"],
        });
        expect(discord.botPermissionsIn).toHaveBeenCalledWith(E1);
    });

    // A server the bot is not on: nothing is known, so nothing reads as missing.
    it("describes a server the bot is not on as not connected, rights unknown", () => {
        discord.getGuild.mockReturnValue(null);
        const card = guildRoles.talkGuild({ discordServers: block({ servers: [server(E1), server(T)], talkGuildId: T }) });
        expect(card).toEqual({
            role: "talk", id: T, name: "", connected: false, memberCount: null, iconUrl: "", permissions: null, missing: [],
        });
        expect(discord.botPermissionsIn).not.toHaveBeenCalled();
    });

    it("lists a card per event server, with its overview target", () => {
        discord.getGuild.mockImplementation((id) => ({ id, name: id === E1 ? "PvE" : id === E2 ? "PvP" : "Talk", memberCount: 1, iconURL: () => "" }));
        discord.botPermissionsIn.mockReturnValue([]);
        const config = {
            discordServers: block({
                servers: [server(E1, "PvE"), server(E2, "PvP"), server(T)],
                links: [{ from: E1, to: T, channelId: C1 }],
                talkGuildId: T,
            }),
        };
        expect(guildRoles.eventGuildCards(config)).toEqual([
            expect.objectContaining({ id: E1, label: "PvE", overviewGuildId: T, overviewChannelId: C1, overviewGuildName: "Talk" }),
            expect.objectContaining({ id: E2, label: "PvP", overviewGuildId: "", overviewChannelId: "", overviewGuildName: "" }),
        ]);
    });

    it("has no card without a server", () => {
        expect(guildRoles.eventGuildCards({ discordServers: block() })).toEqual([]);
    });
});

describe("services/discord/guildRoles memberOverlap", () => {
    const two = { discordServers: block({ servers: [server(E1), server(T)], talkGuildId: T }) };

    it("is null without a second server", async () => {
        expect(await guildRoles.memberOverlap({ guildId: E1, discordServers: block() })).toBeNull();
    });

    it("is null when the talk server is the event server (#890)", async () => {
        expect(await guildRoles.memberOverlap({ discordServers: block({ servers: [server(E1)], talkGuildId: E1 }) })).toBeNull();
        expect(discord.fetchGuildMembersCached).not.toHaveBeenCalled();
    });

    it("counts the human members that are on both servers", async () => {
        discord.getGuild.mockImplementation((id) => ({ id }));
        discord.fetchGuildMembersCached.mockImplementation(async (id) => (id === E1
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
        discord.getGuild.mockImplementation((id) => (id === E1 ? { id } : null));
        const out = await guildRoles.memberOverlap(two);
        expect(out.both).toBeNull();
        expect(out.error).toMatch(/nicht auf beiden/);
        expect(discord.fetchGuildMembersCached).not.toHaveBeenCalled();
    });
});

// #896: the overlap of any two servers, per role-sync pair.
describe("services/discord/guildRoles guildOverlap", () => {
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
});
