// Bot-Check of the Discord overview (src/services/discord/botCheck.js): the
// function table against the bot's rights, the configured channels of one side,
// and the roles it hands out that stand above its own.
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
const GUILDS = { event: EVENT, talk: TALK };

beforeEach(() => {
    mockOnline = true;
    mockClient = { options: { intents: { has: (k) => k === "GuildMembers" } }, channels: { cache: new Map() } };
    mockGuild = guild({ rights: ALL });
    mockRosters.length = 0;
    mockRoleMessages.length = 0;
    mockAddon.channelId = "";
    mockAddon.roleId = "";
});

describe("functions", () => {
    it("reads ok where the bot has every right and missing where an intent lacks", () => {
        const { functions, known } = botCheck("event", EVENT, {}, GUILDS);
        expect(known).toBe(true);
        const byKey = Object.fromEntries(functions.map((f) => [f.key, f.state]));
        expect(byKey).toEqual(expect.objectContaining({ channels: "ok", posts: "ok", roles: "ok", members: "ok", events: "ok", logLinks: "missing" }));
        expect(functions).toHaveLength(BOT_FUNCTIONS.length);
    });

    it("marks a missing server right and event-only functions on the talk side", () => {
        mockGuild = guild({ rights: [F.ViewChannel, F.SendMessages, F.EmbedLinks, F.ReadMessageHistory] });
        const byKey = Object.fromEntries(botCheck("talk", TALK, {}, GUILDS).functions.map((f) => [f.key, f]));
        expect(byKey.roles.state).toBe("missing");
        expect(byKey.roles.rights).toEqual([{ key: "ManageRoles", label: "Rollen verwalten", ok: false }]);
        expect(byKey.posts.state).toBe("ok");
        expect(byKey.events.state).toBe("not_needed");
    });

    it("reads unknown while the bot is offline (intents still known)", () => {
        mockOnline = false;
        const check = botCheck("event", EVENT, {}, GUILDS);
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
        discordServers: { talkPingChannelId: "300000000000000002", guildBankChannelId: "300000000000000003" },
    };

    it("checks the configured channels of the side", () => {
        mockGuild = guild({ rights: ALL, channels: { "300000000000000001": { name: "logs", rights: POST } } });
        const channels = botCheck("event", EVENT, config, GUILDS).channels;
        const byKey = Object.fromEntries(channels.map((c) => [c.key, c]));
        expect(byKey.applications.state).toBe("not_set");
        expect(byKey.logs).toEqual(expect.objectContaining({ state: "missing", channelName: "logs", missing: ["Nachrichtenverlauf lesen"], missingKeys: ["ReadMessageHistory"] }));
        expect(byKey.guildBank.missingKeys).toEqual([]);
        expect(byKey.guildBank.state).toBe("channel_missing");
        expect(byKey.talkPings).toBeUndefined();
    });

    // #894: there is no talk ping channel any more - an old value is not checked
    it("puts a channel by its server and checks no talk ping channel", () => {
        mockClient.channels.cache.set("300000000000000003", { guildId: TALK });
        const keys = botCheck("talk", TALK, config, GUILDS).channels.map((c) => c.key);
        expect(keys).toEqual(["guildBank"]);
    });

    it("leaves out a channel on a server that is neither side (a second event server)", () => {
        const SECOND = "900000000000000003";
        mockClient.channels.cache.set("300000000000000003", { guildId: SECOND });
        const withOverview = { ...config, discordServers: { ...config.discordServers, eventGuilds: [{ guildId: SECOND, overviewGuildId: SECOND, overviewChannelId: "300000000000000004" }] } };
        const eventKeys = botCheck("event", EVENT, withOverview, GUILDS).channels.map((c) => c.key);
        const talkKeys = botCheck("talk", TALK, withOverview, GUILDS).channels.map((c) => c.key);
        expect(eventKeys).not.toContain("guildBank");
        expect(eventKeys).not.toContain("overview");
        expect(talkKeys).not.toContain("guildBank");
        expect(talkKeys).not.toContain("overview");
    });

    it("shows a link's overview channel on the link's target server only", () => {
        const withLink = { ...config, discordServers: { links: [{ from: EVENT, to: TALK, channelId: "300000000000000005" }, { to: TALK }] } };
        expect(channelPurposes(withLink).filter((p) => p.key === "overview")).toEqual([
            expect.objectContaining({ channelId: "300000000000000005", guildId: TALK }),
        ]);
        expect(botCheck("talk", TALK, withLink, GUILDS).channels.map((c) => c.key)).toContain("overview");
        expect(botCheck("event", EVENT, withLink, GUILDS).channels.map((c) => c.key)).not.toContain("overview");
    });

    it("lists only purposes with a channel, plus the required applications channel", () => {
        expect(channelPurposes({}).map((p) => p.key)).toEqual(["applications"]);
        mockOnline = false;
        expect(botCheck("event", EVENT, config, GUILDS).channels.find((c) => c.key === "logs").state).toBe("unknown");
    });
});

describe("rolesAboveBot", () => {
    it("names roles the bot hands out that stand at or above its own", () => {
        mockRosters.push(
            { name: "TBC", roleIds: ["200000000000000001"], trialRoleId: "200000000000000002" },
            { name: "Alt", closedAt: 1, roleIds: ["200000000000000003"] },
        );
        mockRoleMessages.push({ guildSide: "event", roles: [{ roleId: "200000000000000004" }] }, { guildSide: "talk", roles: [{ roleId: "200000000000000001" }] });
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
        expect(botCheck("event", EVENT, { roleSync: [{ eventRoleId: "200000000000000002" }] }, GUILDS).rolesAboveBot).toEqual([
            { id: "200000000000000004", name: "Booster", usedBy: ["Rollen-Nachricht"] },
            { id: "200000000000000001", name: "Raider", usedBy: ["Roster TBC"] },
        ]);
    });

    it("counts the addon centre's ping role and compares by comparePositionTo", () => {
        mockAddon.roleId = "200000000000000005";
        const highest = { position: 5, comparePositionTo: (r) => (r.id === "200000000000000005" ? -1 : 1) };
        mockGuild = guild({ rights: ALL, roles: [{ id: "200000000000000005", name: "Addon-Ping", position: 5 }] });
        mockGuild.members.me.roles.highest = highest;
        expect(botCheck("event", EVENT, {}, GUILDS).rolesAboveBot).toEqual([
            { id: "200000000000000005", name: "Addon-Ping", usedBy: ["Addon-Zentrale"] },
        ]);
    });

    it("is empty without the own member", () => {
        mockOnline = false;
        expect(botCheck("event", EVENT, {}, GUILDS).rolesAboveBot).toEqual([]);
    });
});
