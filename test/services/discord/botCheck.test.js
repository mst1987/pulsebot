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
jest.mock("../../../src/stores/roster/rosterStore", () => ({ listRosters: () => mockRosters, isClosed: (r) => !!r.closedAt }));
jest.mock("../../../src/stores/discord/roleMessageStore", () => ({ listMessages: () => mockRoleMessages }));
const mockEvents = [];
jest.mock("../../../src/stores/events/eventStore", () => ({ listEvents: (gid) => mockEvents.filter((e) => !gid || e.guildId === gid) }));
// A plain Discord category must never count as a raid one: the check reads no category list.
jest.mock("../../../src/services/categories/categoryNames", () => ({
    listKnownCategories: () => { throw new Error("botCheck must not read the category list"); },
    rememberCategories: () => { throw new Error("botCheck must not write"); },
}));
const mockAddon = { channelId: "", roleId: "" };
jest.mock("../../../src/stores/settings/addonCenterStore", () => ({ getSettings: () => ({ ...mockAddon }) }));
const mockInviteCodes = [];
jest.mock("../../../src/stores/discord/discordInviteStore", () => ({ knownCodes: () => mockInviteCodes }));

const { botCheck, channelPurposes, raidServerIds, BOT_FUNCTIONS } = require("../../../src/services/discord/botCheck");

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
const SERVERS = { servers: [{ guildId: EVENT }, { guildId: TALK }], links: [] };
const SRV = { discordServers: SERVERS };

beforeEach(() => {
    mockOnline = true;
    mockClient = { options: { intents: { has: (k) => k === "GuildMembers" } }, channels: { cache: new Map() } };
    mockGuild = guild({ rights: ALL });
    mockRosters.length = 0;
    mockRoleMessages.length = 0;
    mockAddon.channelId = "";
    mockAddon.roleId = "";
    mockEvents.length = 0;
    mockInviteCodes.length = 0;
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

    it("checks what is set up on a server: raid events, role messages", () => {
        mockEvents.push({ id: "e1", guildId: TALK, categoryId: "700000000000000001" });
        mockRoleMessages.push({ guildId: TALK, roles: [] });
        const byKey = Object.fromEntries(botCheck(TALK, SRV).functions.map((f) => [f.key, f.state]));
        expect(byKey).toEqual(expect.objectContaining({ events: "ok", channels: "ok", reactions: "ok" }));
        expect(Object.fromEntries(botCheck(EVENT, SRV).functions.map((f) => [f.key, f.state])).reactions).toBe("not_needed");
    });

    it("needs no raid functions on a server with only a plain (non-raid) category", () => {
        // a Discord category on the server, but neither an event nor a setting names it
        mockGuild = guild({ rights: ALL, channels: { "700000000000000009": { name: "Allgemein", rights: [] } } });
        mockEvents.push({ id: "e1", guildId: TALK, categoryId: "" }, { id: "e2", guildId: EVENT, categoryId: "700000000000000001" });
        const byKey = Object.fromEntries(botCheck(TALK, SRV).functions.map((f) => [f.key, f.state]));
        expect(byKey.events).toBe("not_needed");
        expect(byKey.channels).toBe("not_needed");
    });

    it("counts a configured raid category lying on the server (category list or a per-category setting)", () => {
        mockGuild = guild({ rights: ALL, channels: { "700000000000000002": { name: "Raids", rights: [] } } });
        expect(botCheck(TALK, { ...SRV, categoryIds: ["700000000000000002"] }).functions.find((f) => f.key === "events").state).toBe("ok");
        expect(botCheck(TALK, { ...SRV, categoryLanguage: { "700000000000000002": "en" } }).functions.find((f) => f.key === "events").state).toBe("ok");
        // the same category on another server (client cache) does not count here
        mockGuild = guild({ rights: ALL });
        mockClient.channels.cache.set("700000000000000003", { id: "700000000000000003", guildId: EVENT });
        expect(botCheck(TALK, { ...SRV, categoryIds: ["700000000000000003"] }).functions.find((f) => f.key === "events").state).toBe("not_needed");
        mockClient.channels.cache.set("700000000000000004", { id: "700000000000000004", guildId: TALK });
        expect(botCheck(TALK, { ...SRV, categoryRoles: { "700000000000000004": [] } }).functions.find((f) => f.key === "events").state).toBe("ok");
    });

    // #897: the guild bank sends a new bank to the one raid server.
    it("lists the raid servers: the first one plus servers with a raid event or raid category", () => {
        expect(raidServerIds(SRV)).toEqual([EVENT]);
        mockEvents.push({ id: "e1", guildId: TALK, categoryId: "" });
        expect(raidServerIds(SRV)).toEqual([EVENT]);
        mockClient.channels.cache.set("700000000000000005", { id: "700000000000000005", guildId: TALK });
        expect(raidServerIds({ ...SRV, categoryIds: ["700000000000000005"] })).toEqual([EVENT, TALK]);
        mockEvents.push({ id: "e2", guildId: TALK, categoryId: "700000000000000006" });
        expect(raidServerIds(SRV)).toEqual([EVENT, TALK]);
        expect(raidServerIds({})).toEqual([]);
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
    it("asks for the invite rights only on a server where the bot made an invite (#905)", () => {
        const byKey = () => Object.fromEntries(botCheck(EVENT, SRV).functions.map((f) => [f.key, f]));
        expect(byKey().invites.state).toBe("not_needed");
        mockInviteCodes.push({ code: "abc", guildId: EVENT, linkKey: `${EVENT}:${TALK}` });
        const invites = byKey().invites;
        expect(invites.state).toBe("missing");
        expect(invites.rights.map((r) => r.label)).toEqual(["Einladung erstellen", "Server verwalten"]);
        mockGuild = guild({ rights: [...ALL, F.CreateInstantInvite, F.ManageGuild] });
        expect(byKey().invites.state).toBe("ok");
    });
    it("asks for the invite rights on a link's source server before its first invite (#905)", () => {
        const withLink = { discordServers: { ...SERVERS, links: [{ from: EVENT, to: TALK, channelId: "300000000000000001" }] } };
        expect(botCheck(EVENT, withLink).functions.find((f) => f.key === "invites").state).toBe("missing");
        // the target of the link hands the invite out, it needs no rights for it
        expect(botCheck(TALK, withLink).functions.find((f) => f.key === "invites").state).toBe("not_needed");
    });
});

describe("channels", () => {
    // #924: the applications and guild bank channels are per server (serverSettings)
    const config = {
        serverSettings: { [EVENT]: { guildBankChannelId: "300000000000000003", logChannels: [{ channelId: "300000000000000001", versionId: "tbc" }] } },
        discordServers: { ...SERVERS, talkPingChannelId: "300000000000000002" },
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

    // #921: until the bot has moved the old global list, its channels are checked where they lie, each once
    it("checks the old global log channel list until it is moved", () => {
        mockGuild = guild({ rights: ALL, channels: { "300000000000000005": { name: "alt-logs", rights: [...POST, "ReadMessageHistory"] } } });
        const legacy = { ...config, logChannelIds: ["300000000000000005", "300000000000000001", "300000000000000005"] };
        const logs = botCheck(EVENT, legacy).channels.filter((c) => c.key === "logs");
        expect(logs.map((c) => c.channelId).sort()).toEqual(["300000000000000001", "300000000000000005"]);
        expect(logs.find((c) => c.channelId === "300000000000000005").state).toBe("ok");
    });

    // #894: there is no talk ping channel any more - an old value is not checked
    it("puts a per-server channel on the server it was set for and checks no talk ping channel (#924)", () => {
        const onTalk = { ...config, serverSettings: { [TALK]: { guildBankChannelId: "300000000000000003", applicationChannelId: "300000000000000006" } } };
        // where the channel lies does not move it: it is the setting of that server
        mockClient.channels.cache.set("300000000000000003", { guildId: EVENT });
        expect(botCheck(TALK, onTalk).channels.map((c) => c.key)).toEqual(["applications", "guildBank"]);
        const eventKeys = botCheck(EVENT, onTalk).channels.map((c) => c.key);
        expect(eventKeys).not.toContain("guildBank");
        // the first server without an applications channel is told so
        expect(botCheck(EVENT, onTalk).channels.find((c) => c.key === "applications").state).toBe("not_set");
    });

    it("puts an overview channel on the target of its link", () => {
        const linked = { ...config, discordServers: { ...config.discordServers, links: [{ from: EVENT, to: TALK, channelId: "300000000000000004" }] } };
        expect(botCheck(TALK, linked).channels.map((c) => c.key)).toContain("overview");
        expect(botCheck(EVENT, linked).channels.map((c) => c.key)).not.toContain("overview");
    });

    it("leaves out a channel on a server outside the list", () => {
        const SECOND = "900000000000000003";
        mockClient.channels.cache.set("300000000000000003", { guildId: SECOND });
        const withOverview = {
            ...config,
            discordServers: { ...config.discordServers, links: [{ from: EVENT, to: SECOND, channelId: "300000000000000004" }] },
            serverSettings: { [SECOND]: { guildBankChannelId: "300000000000000003" } },
        };
        const eventKeys = botCheck(EVENT, withOverview).channels.map((c) => c.key);
        const talkKeys = botCheck(TALK, withOverview).channels.map((c) => c.key);
        expect(eventKeys).not.toContain("guildBank");
        expect(eventKeys).not.toContain("overview");
        expect(talkKeys).not.toContain("guildBank");
        expect(talkKeys).not.toContain("overview");
    });

    it("shows a link's overview channel on the link's target server only", () => {
        const withLink = { ...config, discordServers: { ...config.discordServers, links: [{ from: EVENT, to: TALK, channelId: "300000000000000005" }, { to: TALK }] } };
        expect(channelPurposes(withLink).filter((p) => p.key === "overview")).toEqual([
            expect.objectContaining({ channelId: "300000000000000005", guildId: TALK }),
        ]);
        expect(botCheck(TALK, withLink).channels.map((c) => c.key)).toContain("overview");
        expect(botCheck(EVENT, withLink).channels.map((c) => c.key)).not.toContain("overview");
    });

    it("lists only purposes with a channel, plus the required applications channel", () => {
        expect(channelPurposes(SRV).map((p) => p.key)).toEqual(["applications"]);
        expect(channelPurposes(SRV)[0]).toEqual(expect.objectContaining({ guildId: EVENT, channelId: "", required: true }));
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
            { guildId: TALK, roles: [{ roleId: "200000000000000001" }] },
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
        const roleSync = [{ fromGuildId: EVENT, fromRoleId: "200000000000000002", toGuildId: TALK, toRoleId: "200000000000000009", direction: "both" }];
        expect(botCheck(EVENT, { ...SRV, roleSync }).rolesAboveBot).toEqual([
            { id: "200000000000000004", name: "Booster", usedBy: ["Rollen-Nachricht"] },
            { id: "200000000000000001", name: "Raider", usedBy: ["Roster TBC"] },
        ]);
    });

    it("counts only this server's role of a role-sync pair (#896)", () => {
        mockGuild = guild({
            rights: ALL,
            top: 5,
            roles: [
                { id: "200000000000000006", name: "Gast", position: 8 },
                { id: "200000000000000007", name: "Mitglied", position: 9 },
            ],
        });
        const roleSync = [
            // this server is the target: its toRoleId counts
            { fromGuildId: TALK, fromRoleId: "200000000000000007", toGuildId: EVENT, toRoleId: "200000000000000006", direction: "toTarget" },
            // another pair between two other servers names a role id that exists here: no hint
            { fromGuildId: TALK, fromRoleId: "200000000000000007", toGuildId: "900000000000000003", toRoleId: "200000000000000008", direction: "both" },
        ];
        expect(botCheck(EVENT, { ...SRV, roleSync }).rolesAboveBot).toEqual([
            { id: "200000000000000006", name: "Gast", usedBy: ["Rollen-Abgleich"] },
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

describe("pugRolesGranting (#930)", () => {
    const VERSION_ROLE = "200000000000000011";
    const CLASS_ROLE = "200000000000000012";
    const pugRoles = { [EVENT]: { versions: { tbc: VERSION_ROLE }, classes: { Mage: CLASS_ROLE } } };

    it("names an onboarding role of this server that still unlocks something", () => {
        mockRosters.push({ id: "ro1", name: "Kara", guildId: EVENT, roleIds: [CLASS_ROLE] });
        mockGuild = guild({ rights: ALL, roles: [{ id: CLASS_ROLE, name: "Magier", position: 1 }] });
        expect(botCheck(EVENT, { ...SRV, pugRoles, orgaRoleIds: [VERSION_ROLE] }).pugRolesGranting).toEqual([
            { id: VERSION_ROLE, name: "", kind: "version", itemId: "tbc", label: "TBC Anniversary", uses: [{ code: "orga" }] },
            { id: CLASS_ROLE, name: "Magier", kind: "class", itemId: "Mage", label: "Magier", uses: [{ code: "roster", rosterId: "ro1", name: "Kara", kinds: ["member"] }] },
        ]);
    });

    it("leaves out clean roles, other servers and an unknown server", () => {
        mockRosters.push({ id: "ro2", name: "Alt", guildId: TALK, roleIds: [CLASS_ROLE] });
        expect(botCheck(EVENT, { ...SRV, pugRoles }).pugRolesGranting).toEqual([]);
        expect(botCheck(TALK, { ...SRV, pugRoles, orgaRoleIds: [VERSION_ROLE] }).pugRolesGranting).toEqual([]);
        expect(botCheck("", { ...SRV, pugRoles, orgaRoleIds: [VERSION_ROLE] }).pugRolesGranting).toEqual([]);
    });

    it("still reports while the bot is offline", () => {
        mockOnline = false;
        expect(botCheck(EVENT, { ...SRV, pugRoles, serverSettings: { "900000000000000009": { officerRoleId: VERSION_ROLE } } }).pugRolesGranting.map((r) => r.id)).toEqual([VERSION_ROLE]);
    });
});
