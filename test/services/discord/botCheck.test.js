// Bot-Check of the Discord overview (src/services/discord/botCheck.js): the
// function table against the bot's rights on one server of the list (#895), only
// for what is set up there, the configured channels of that server, and the roles
// it hands out that stand above its own.
const { PermissionsBitField } = require("discord.js");

let mockOnline = true;
let mockGuild = null;
let mockClient = null;
const mockRosters = [];
const mockRoleMessages = [];
jest.mock("../../../src/services/discord/discord", () => ({
    isOnline: () => mockOnline,
    getGuild: () => mockGuild,
    getClient: () => mockClient,
}));
jest.mock("../../../src/stores/rosterStore", () => ({ listRosters: () => mockRosters, isClosed: (r) => !!r.closedAt }));
jest.mock("../../../src/stores/roleMessageStore", () => ({ listMessages: () => mockRoleMessages }));
const mockCategories = {};
jest.mock("../../../src/services/discord/categoryNames", () => ({ listKnownCategories: (gid) => mockCategories[gid] || [] }));
const mockAddon = { channelId: "", roleId: "" };
jest.mock("../../../src/stores/addonCenterStore", () => ({ getSettings: () => ({ ...mockAddon }) }));

const { botCheck, channelPurposes, BOT_FUNCTIONS } = require("../../../src/services/discord/botCheck");

const EVENT = "900000000000000001";
const TALK = "900000000000000002";
const F = PermissionsBitField.Flags;
const perms = (...flags) => new PermissionsBitField(flags);

function guild({ rights = [], channels = {}, roles = [], top = 5 } = {}) {
    const me = { permissions: perms(...rights), roles: { highest: { position: top } } };
    const channelCache = new Map(Object.entries(channels).map(([id, c]) => [id, { id, name: c.name, permissionsFor: () => perms(...c.rights) }]));
    return {
        id: EVENT,
        members: { me },
        channels: { cache: channelCache },
        roles: { cache: new Map(roles.map((r) => [r.id, r])) },
    };
}

const ALL = [F.ViewChannel, F.ManageChannels, F.SendMessages, F.EmbedLinks, F.AddReactions, F.ReadMessageHistory, F.ManageRoles, F.ManageEvents, F.CreatePublicThreads, F.SendMessagesInThreads];
const POST = [F.ViewChannel, F.SendMessages, F.EmbedLinks];
const SERVERS = { servers: [{ guildId: EVENT }, { guildId: TALK }], talkGuildId: TALK, links: [] };
const SRV = { discordServers: SERVERS };

beforeEach(() => {
    mockOnline = true;
    mockClient = { options: { intents: { has: (k) => k === "GuildMembers" } }, channels: { cache: new Map() } };
    mockGuild = guild({ rights: ALL });
    mockRosters.length = 0;
    mockRoleMessages.length = 0;
    mockAddon.channelId = "";
    mockAddon.roleId = "";
    for (const k of Object.keys(mockCategories)) delete mockCategories[k];
});

describe("functions", () => {
    it("reads ok where the bot has every right and missing where an intent lacks", () => {
        const { functions, known, guildId } = botCheck(EVENT, SRV);
        expect(known).toBe(true);
        expect(guildId).toBe(EVENT);
        const byKey = Object.fromEntries(functions.map((f) => [f.key, f.state]));
        // the first server carries the raid functions; no role message stands there
        expect(byKey).toEqual(expect.objectContaining({ channels: "ok", posts: "ok", roles: "ok", members: "ok", events: "ok", logLinks: "missing", reactions: "not_needed" }));
        expect(functions).toHaveLength(BOT_FUNCTIONS.length);
    });

    it("marks a missing server right and the raid functions as not needed on a server without raids", () => {
        mockGuild = guild({ rights: [F.ViewChannel, F.SendMessages, F.EmbedLinks, F.ReadMessageHistory] });
        const byKey = Object.fromEntries(botCheck(TALK, SRV).functions.map((f) => [f.key, f]));
        expect(byKey.roles.state).toBe("missing");
        expect(byKey.roles.rights).toEqual([{ key: "ManageRoles", label: "Rollen verwalten", ok: false }]);
        expect(byKey.posts.state).toBe("ok");
        expect(byKey.events.state).toBe("not_needed");
        expect(byKey.channels.state).toBe("not_needed");
        expect(byKey.reactions.state).toBe("not_needed");
    });

    it("checks what is set up on a server: raid categories, role messages (also an old entry by its side)", () => {
        mockCategories[TALK] = [{ id: "c1", name: "Raids" }];
        mockRoleMessages.push({ guildSide: "talk", roles: [] });
        const byKey = Object.fromEntries(botCheck(TALK, SRV).functions.map((f) => [f.key, f.state]));
        expect(byKey).toEqual(expect.objectContaining({ events: "ok", channels: "ok", reactions: "ok" }));
        expect(Object.fromEntries(botCheck(EVENT, SRV).functions.map((f) => [f.key, f.state])).reactions).toBe("not_needed");
    });

    it("needs nothing raid-wise without a server", () => {
        const check = botCheck("", SRV);
        expect(check).toMatchObject({ guildId: "", known: false, channels: [], rolesAboveBot: [] });
        expect(check.functions.find((f) => f.key === "events").state).toBe("not_needed");
    });

    it("reads unknown while the bot is offline (intents still known)", () => {
        mockOnline = false;
        const check = botCheck(EVENT, SRV);
        expect(check.known).toBe(false);
        const byKey = Object.fromEntries(check.functions.map((f) => [f.key, f.state]));
        expect(byKey.roles).toBe("unknown");
        expect(byKey.members).toBe("ok");
    });
});

describe("channels", () => {
    const config = {
        applicationChannelId: "",
        logChannelIds: ["300000000000000001"],
        discordServers: { ...SERVERS, talkPingChannelId: "300000000000000002", guildBankChannelId: "300000000000000003" },
    };

    it("checks the configured channels of the server (a channel not found shows on the first server)", () => {
        mockGuild = guild({ rights: ALL, channels: { "300000000000000001": { name: "logs", rights: POST } } });
        const channels = botCheck(EVENT, config).channels;
        const byKey = Object.fromEntries(channels.map((c) => [c.key, c]));
        expect(byKey.applications.state).toBe("not_set");
        expect(byKey.logs).toEqual(expect.objectContaining({ state: "missing", channelName: "logs", missing: ["Nachrichtenverlauf lesen"], missingKeys: ["ReadMessageHistory"] }));
        expect(byKey.guildBank.missingKeys).toEqual([]);
        expect(byKey.guildBank.state).toBe("channel_missing");
        expect(byKey.talkPings).toBeUndefined();
    });

    it("puts the talk ping channel on the talk server and a channel by the server it lies on", () => {
        mockClient.channels.cache.set("300000000000000003", { guildId: TALK });
        const keys = botCheck(TALK, config).channels.map((c) => c.key);
        expect(keys).toEqual(["talkPings", "guildBank"]);
    });

    it("puts an overview channel on the target of its link", () => {
        const linked = { ...config, discordServers: { ...config.discordServers, links: [{ from: EVENT, to: TALK, channelId: "300000000000000004" }] } };
        expect(botCheck(TALK, linked).channels.map((c) => c.key)).toContain("overview");
        expect(botCheck(EVENT, linked).channels.map((c) => c.key)).not.toContain("overview");
    });

    it("leaves out a channel on a server outside the list", () => {
        const SECOND = "900000000000000003";
        mockClient.channels.cache.set("300000000000000003", { guildId: SECOND });
        const withOverview = { ...config, discordServers: { ...config.discordServers, links: [{ from: EVENT, to: SECOND, channelId: "300000000000000004" }] } };
        const eventKeys = botCheck(EVENT, withOverview).channels.map((c) => c.key);
        const talkKeys = botCheck(TALK, withOverview).channels.map((c) => c.key);
        expect(eventKeys).not.toContain("guildBank");
        expect(eventKeys).not.toContain("overview");
        expect(talkKeys).not.toContain("guildBank");
        expect(talkKeys).not.toContain("overview");
    });

    it("lists only purposes with a channel, plus the required applications channel", () => {
        expect(channelPurposes({}).map((p) => p.key)).toEqual(["applications"]);
        mockOnline = false;
        expect(botCheck(EVENT, config).channels.find((c) => c.key === "logs").state).toBe("unknown");
    });
});

describe("rolesAboveBot", () => {
    it("names roles the bot hands out that stand at or above its own", () => {
        mockRosters.push(
            { name: "TBC", roleIds: ["200000000000000001"], trialRoleId: "200000000000000002" },
            { name: "Alt", closedAt: 1, roleIds: ["200000000000000003"] },
        );
        mockRoleMessages.push(
            { guildSide: "event", roles: [{ roleId: "200000000000000004" }] },
            { guildSide: "talk", roles: [{ roleId: "200000000000000001" }] },
            { guildId: TALK, roles: [{ roleId: "200000000000000003" }] },
        );
        mockGuild = guild({
            rights: ALL,
            top: 5,
            roles: [
                { id: "200000000000000001", name: "Raider", position: 7 },
                { id: "200000000000000002", name: "Trial", position: 2 },
                { id: "200000000000000003", name: "Closed", position: 9 },
                { id: "200000000000000004", name: "Booster", position: 1, managed: true },
            ],
        });
        expect(botCheck(EVENT, { ...SRV, roleSync: [{ eventRoleId: "200000000000000002" }] }).rolesAboveBot).toEqual([
            { id: "200000000000000004", name: "Booster", usedBy: ["Rollen-Nachricht"] },
            { id: "200000000000000001", name: "Raider", usedBy: ["Roster TBC"] },
        ]);
    });

    it("counts the addon centre's ping role and compares by comparePositionTo", () => {
        mockAddon.roleId = "200000000000000005";
        const highest = { position: 5, comparePositionTo: (r) => (r.id === "200000000000000005" ? -1 : 1) };
        mockGuild = guild({ rights: ALL, roles: [{ id: "200000000000000005", name: "Addon-Ping", position: 5 }] });
        mockGuild.members.me.roles.highest = highest;
        expect(botCheck(EVENT, SRV).rolesAboveBot).toEqual([
            { id: "200000000000000005", name: "Addon-Ping", usedBy: ["Addon-Zentrale"] },
        ]);
    });

    it("is empty without the own member", () => {
        mockOnline = false;
        expect(botCheck(EVENT, SRV).rolesAboveBot).toEqual([]);
    });
});
