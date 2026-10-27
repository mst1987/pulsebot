// The roles of a server for the web (src/services/discord/serverRoles.js): list with counts,
// permissions, bot uses, assignability and hints; one role with its channel overwrites and
// members; the tab count; offline and a member list that fails or takes too long.
const { PermissionsBitField } = require("discord.js");

let mockConfig = {};
jest.mock("../../../src/stores/configStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/services/discord/guildRoles", () => {
    const actual = jest.requireActual("../../../src/services/discord/guildRoles");
    const cfg = { discordServers: { servers: [{ guildId: "900000000000000001" }, { guildId: "900000000000000002" }], talkGuildId: "900000000000000002", links: [] } };
    return {
        ...actual,
        eventGuildId: () => "900000000000000001",
        talkGuildId: () => "900000000000000002",
        roleMessageGuild: (entry) => actual.roleMessageGuild(entry, cfg),
    };
});
jest.mock("../../../src/services/discord/categoryNames", () => ({
    listKnownCategories: () => [{ id: "cat-1", name: "WoW Forever" }],
}));
const mockDiscord = {
    getGuild: jest.fn(),
    fetchGuildMembersCached: jest.fn(async () => []),
    avatarUrlOf: jest.fn((m) => `https://cdn/${m.id}.png`),
    NAME_FETCH_MS: 5000,
};
jest.mock("../../../src/services/discord/discord", () => mockDiscord);

const rosterStore = require("../../../src/stores/rosterStore");
const roleMessageStore = require("../../../src/stores/roleMessageStore");
const addonCenterStore = require("../../../src/stores/addonCenterStore");
const { listServerRoles, serverRoleDetail, roleCount, permissionKeys, SENSITIVE_PERMISSIONS, EVERYONE_MEMBERS_MAX } = require("../../../src/services/discord/serverRoles");

const F = PermissionsBitField.Flags;
const GUILD = "900000000000000001";
const TALK = "900000000000000002";
const ADMIN = "200000000000000001";
const BOT = "200000000000000002";
const RAIDER = "200000000000000003";
const EMPTY = "200000000000000004";
const HIGH = "200000000000000005";
const INTEGRATION = "200000000000000006";

const role = (id, name, position, extra = {}) => ({ id, name, position, rawPosition: position, managed: false, color: 0, hexColor: "#000000", permissions: { bitfield: 0n }, ...extra });

function makeGuild({ manage = true } = {}) {
    const roles = new Map([
        [GUILD, role(GUILD, "@everyone", 0, { permissions: { bitfield: F.ViewChannel | F.SendMessages } })],
        [HIGH, role(HIGH, "Gildenrat", 20, { color: 0x3366ff, hexColor: "#3366ff", permissions: { bitfield: F.KickMembers | F.ViewChannel }, editable: false })],
        [ADMIN, role(ADMIN, "Admin", 15, { permissions: { bitfield: F.Administrator }, editable: false })],
        [BOT, role(BOT, "PulseBot", 10, { managed: true, permissions: { bitfield: F.ManageRoles } })],
        [INTEGRATION, role(INTEGRATION, "Raid-Helper", 8, { managed: true })],
        [RAIDER, role(RAIDER, "Raider", 5, { color: 0x22aa55, hexColor: "#22aa55", editable: true })],
        [EMPTY, role(EMPTY, "Alt", 2, { editable: true })],
    ]);
    const category = { id: "300000000000000001", name: "Raids", type: 4, rawPosition: 1, parent: null };
    const text = {
        id: "300000000000000002", name: "raid-chat", type: 0, rawPosition: 0, parent: category,
        permissionOverwrites: { cache: new Map([[RAIDER, { allow: { bitfield: F.ViewChannel | F.SendMessages }, deny: { bitfield: 0n } }]]) },
    };
    category.permissionOverwrites = { cache: new Map([[RAIDER, { allow: { bitfield: F.ViewChannel }, deny: { bitfield: F.MentionEveryone } }]]) };
    const voice = { id: "300000000000000003", name: "Lobby", type: 2, rawPosition: 0, parent: null, permissionOverwrites: { cache: new Map([[RAIDER, { allow: { bitfield: 0n }, deny: { bitfield: 0n } }]]) } };
    return {
        id: GUILD,
        name: "Test-Server",
        roles: { cache: roles },
        channels: { cache: new Map([[text.id, text], [category.id, category], [voice.id, voice]]) },
        members: {
            me: { permissions: { has: (f) => (f === F.ManageRoles ? manage : false) }, roles: { highest: roles.get(BOT) } },
        },
    };
}

const member = (id, displayName, roleIds, extra = {}) => ({ id, displayName, roles: { cache: new Set(roleIds) }, user: { username: displayName.toLowerCase(), bot: false }, ...extra });

beforeEach(() => {
    jest.clearAllMocks();
    mockConfig = { adminRoleIds: [ADMIN], categoryRoles: { "cat-1": [RAIDER, HIGH] } };
    jest.spyOn(rosterStore, "listRosters").mockReturnValue([]);
    jest.spyOn(roleMessageStore, "listMessages").mockReturnValue([
        { id: "rm-1", guildSide: "event", title: "Spiele", roles: [{ roleId: RAIDER }] },
        { id: "rm-2", guildSide: "talk", title: "Anderer Server", roles: [{ roleId: RAIDER }] },
    ]);
    jest.spyOn(addonCenterStore, "getSettings").mockReturnValue({ roleId: EMPTY });
    mockDiscord.getGuild.mockReturnValue(makeGuild());
    mockDiscord.fetchGuildMembersCached.mockResolvedValue([
        member("1", "Zora", [RAIDER, GUILD]),
        member("2", "Anna", [RAIDER, ADMIN, GUILD]),
        member("3", "PulseBot", [BOT, GUILD], { user: { username: "pulsebot", bot: true } }),
    ]);
});

afterEach(() => jest.restoreAllMocks());

describe("serverRoles permissionKeys", () => {
    it("names the set flags and nothing for none", () => {
        expect(permissionKeys(F.Administrator | F.KickMembers)).toEqual(["KickMembers", "Administrator"]);
        expect(permissionKeys(0n)).toEqual([]);
        expect(permissionKeys({ bitfield: F.SendMessages })).toEqual(["SendMessages"]);
        expect(permissionKeys(undefined)).toEqual([]);
        expect(SENSITIVE_PERMISSIONS).toContain("Administrator");
    });

    it("names a bit with two flag names once, under the newer name", () => {
        expect(permissionKeys(F.ManageGuildExpressions)).toEqual(["ManageGuildExpressions"]);
    });
});

describe("serverRoles sensitive list", () => {
    it("is the one list of roleHygiene, and the web client's copy matches it", () => {
        const { SENSITIVE } = require("../../../src/services/discord/roleHygiene");
        expect(SENSITIVE_PERMISSIONS).toEqual(SENSITIVE);
        const ts = require("fs").readFileSync(require("path").join(__dirname, "../../../src/web-client/src/lib/discord/permissions.ts"), "utf8");
        const block = ts.slice(ts.indexOf("export const SENSITIVE_PERMISSIONS"));
        const copy = [...block.slice(0, block.indexOf("]);")).matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
        expect([...copy].sort()).toEqual([...SENSITIVE].sort());
    });
});

describe("serverRoles listServerRoles", () => {
    it("lists every role highest first with counts, uses, assignability and hints", async () => {
        const out = await listServerRoles(GUILD);
        expect(out).toMatchObject({ online: true, guildId: GUILD, guildName: "Test-Server", manageRoles: true, membersError: null, total: 7 });
        expect(out.botRole).toEqual({ id: BOT, name: "PulseBot", position: 10 });
        expect(out.roles.map((r) => r.name)).toEqual(["Gildenrat", "Admin", "PulseBot", "Raid-Helper", "Raider", "Alt", "@everyone"]);
        const by = Object.fromEntries(out.roles.map((r) => [r.id, r]));

        expect(by[RAIDER]).toMatchObject({ color: "#22aa55", memberCount: 2, permissions: [], sensitive: [], assign: { ok: true, reason: "" }, hints: [] });
        expect(by[RAIDER].uses).toEqual([
            { code: "categoryRaider", categoryIds: ["cat-1"], categories: [{ id: "cat-1", name: "WoW Forever" }] },
            { code: "roleMessage", messageId: "rm-1", title: "Spiele" },
        ]);
        expect(by[ADMIN]).toMatchObject({ memberCount: 1, sensitive: ["Administrator"], uses: [{ code: "admin" }], assign: { ok: false, reason: "above" }, hints: ["sensitive"] });
        // a raider role the bot cannot hand out
        expect(by[HIGH]).toMatchObject({ color: "#3366ff", memberCount: 0, sensitive: ["KickMembers"], hints: ["empty", "sensitive", "aboveBot"] });
        expect(by[BOT]).toMatchObject({ isBotRole: true, managed: true, assign: { ok: false, reason: "botRole" }, hints: [] });
        expect(by[INTEGRATION]).toMatchObject({ assign: { ok: false, reason: "managed" }, memberCount: 0, hints: [] });
        expect(by[EMPTY]).toMatchObject({ color: "", uses: [{ code: "addonUpdates" }], hints: ["empty"] });
        expect(by[GUILD]).toMatchObject({ everyone: true, memberCount: 3, uses: [], assign: { ok: false, reason: "everyone" }, permissions: ["ViewChannel", "SendMessages"] });
    });

    it("says the bot lacks Manage Roles", async () => {
        mockDiscord.getGuild.mockReturnValue(makeGuild({ manage: false }));
        const out = await listServerRoles(GUILD);
        expect(out.manageRoles).toBe(false);
        expect(out.roles.find((r) => r.id === RAIDER).assign).toEqual({ ok: false, reason: "noManageRoles" });
    });

    it("keeps the roles when the member list fails or takes too long", async () => {
        mockDiscord.fetchGuildMembersCached.mockRejectedValueOnce(new Error("Missing intent"));
        const failed = await listServerRoles(GUILD);
        expect(failed.membersError).toBe("Missing intent");
        expect(failed.roles.every((r) => r.memberCount === null)).toBe(true);
        expect(failed.roles.find((r) => r.id === EMPTY).hints).toEqual([]);

        mockDiscord.fetchGuildMembersCached.mockReturnValueOnce(new Promise(() => {}));
        const slow = await listServerRoles(GUILD, { waitMs: 5 });
        expect(slow.membersError).toBe("timeout");
        expect(slow.total).toBe(7);
    });

    it("is empty and offline without the server, and reads another server of the list", async () => {
        mockDiscord.getGuild.mockReturnValue(null);
        expect(await listServerRoles(TALK)).toEqual({ guildId: "900000000000000002", guildName: "", online: false, botRole: null, manageRoles: null, membersError: null, total: 0, roles: [], commonSensitive: [] });
        expect(mockDiscord.getGuild).toHaveBeenCalledWith("900000000000000002");
    });

    it("counts only the role messages of its own server (an old guildSide entry by its side)", async () => {
        mockDiscord.getGuild.mockReturnValue(makeGuild());
        const out = await listServerRoles(TALK);
        const uses = out.roles.find((r) => r.id === RAIDER).uses;
        expect(uses).toContainEqual({ code: "roleMessage", messageId: "rm-2", title: "Anderer Server" });
        expect(uses.some((u) => u.messageId === "rm-1")).toBe(false);
        expect(out.side).toBeUndefined();
    });

    it("hints aboveBot for a roster's member or trial role, never for its manager role", async () => {
        const g = makeGuild();
        const MGR = "200000000000000010";
        const TRIAL = "200000000000000011";
        g.roles.cache.set(MGR, role(MGR, "Kader-Leitung", 30));
        g.roles.cache.set(TRIAL, role(TRIAL, "Probe", 31));
        mockDiscord.getGuild.mockReturnValue(g);
        rosterStore.listRosters.mockReturnValue([{ id: "r1", name: "Kern", roleIds: [], trialRoleId: TRIAL, managers: { roleIds: [MGR] } }]);
        const by = Object.fromEntries((await listServerRoles(GUILD)).roles.map((r) => [r.id, r]));
        expect(by[MGR].uses).toContainEqual({ code: "roster", rosterId: "r1", name: "Kern", kinds: ["manager"] });
        expect(by[MGR].hints).not.toContain("aboveBot");
        expect(by[TRIAL].hints).toContain("aboveBot");
    });

    it("gives the bot's own role botRole even when it is not managed", async () => {
        const g = makeGuild();
        g.roles.cache.get(BOT).managed = false;
        mockDiscord.getGuild.mockReturnValue(g);
        const out = await listServerRoles(GUILD);
        expect(out.roles.find((r) => r.id === BOT)).toMatchObject({ assign: { ok: false, reason: "botRole" }, hints: [] });
    });

    it("mutes the sensitive permissions most roles or @everyone have and hints only the outliers", async () => {
        const g = makeGuild();
        g.roles.cache.get(GUILD).permissions = { bitfield: F.ViewChannel | F.MentionEveryone };
        g.roles.cache.get(HIGH).permissions = { bitfield: F.ManageNicknames | F.KickMembers };
        g.roles.cache.get(RAIDER).permissions = { bitfield: F.ManageNicknames };
        g.roles.cache.get(EMPTY).permissions = { bitfield: F.ManageNicknames | F.MentionEveryone };
        g.roles.cache.get(INTEGRATION).permissions = { bitfield: F.ManageNicknames | F.BanMembers };
        mockDiscord.getGuild.mockReturnValue(g);
        const out = await listServerRoles(GUILD);
        expect(out.commonSensitive).toEqual([
            { key: "ManageNicknames", roles: 4, everyone: false },
            { key: "MentionEveryone", roles: 1, everyone: true },
        ]);
        const by = Object.fromEntries(out.roles.map((r) => [r.id, r]));
        expect(by[RAIDER]).toMatchObject({ sensitive: ["ManageNicknames"], unusual: [], hints: [] });
        expect(by[EMPTY]).toMatchObject({ unusual: [], hints: ["empty"] });
        expect(by[HIGH]).toMatchObject({ unusual: ["KickMembers"] });
        expect(by[HIGH].hints).toContain("sensitive");
        // an integration's role with an outlier stays visible under "only hints"
        expect(by[INTEGRATION]).toMatchObject({ unusual: ["BanMembers"], hints: ["sensitive"] });
        // the bot's own rights are no hint
        expect(by[BOT].hints).toEqual([]);
        expect(by[GUILD]).toMatchObject({ unusual: [], hints: [] });
    });

    it("survives broken stores", async () => {
        roleMessageStore.listMessages.mockImplementation(() => { throw new Error("broken"); });
        addonCenterStore.getSettings.mockImplementation(() => { throw new Error("broken"); });
        const out = await listServerRoles(GUILD);
        expect(out.roles.find((r) => r.id === EMPTY).uses).toEqual([]);
    });
});

describe("serverRoles serverRoleDetail", () => {
    it("lists the overwrites in Discord order and the members by name", async () => {
        const out = await serverRoleDetail(GUILD, RAIDER);
        expect(out.role).toMatchObject({ id: RAIDER, memberCount: 2 });
        expect(out.channels).toEqual([
            { id: "300000000000000003", name: "Lobby", kind: "voice", parentName: "", allow: [], deny: [] },
            { id: "300000000000000001", name: "Raids", kind: "category", parentName: "", allow: ["ViewChannel"], deny: ["MentionEveryone"] },
            { id: "300000000000000002", name: "raid-chat", kind: "text", parentName: "Raids", allow: ["ViewChannel", "SendMessages"], deny: [] },
        ].filter((c) => c.allow.length || c.deny.length));
        expect(out.members).toEqual([
            { id: "2", name: "Anna", avatarUrl: "https://cdn/2.png", bot: false },
            { id: "1", name: "Zora", avatarUrl: "https://cdn/1.png", bot: false },
        ]);
    });

    it("gives every member for @everyone and marks bots", async () => {
        const out = await serverRoleDetail(GUILD, GUILD);
        expect(out.members.map((m) => [m.name, m.bot])).toEqual([["Anna", false], ["PulseBot", true], ["Zora", false]]);
        expect(out.membersTotal).toBe(3);
    });

    it("cuts @everyone at EVERYONE_MEMBERS_MAX and says how many there are", async () => {
        const many = Array.from({ length: EVERYONE_MEMBERS_MAX + 5 }, (_, i) => member(String(1000 + i), `M${String(i).padStart(3, "0")}`, [GUILD]));
        mockDiscord.fetchGuildMembersCached.mockResolvedValue(many);
        const out = await serverRoleDetail(GUILD, GUILD);
        expect(out.members).toHaveLength(EVERYONE_MEMBERS_MAX);
        expect(out.membersTotal).toBe(EVERYONE_MEMBERS_MAX + 5);
    });

    it("is null for an unknown role, empty offline, no members on a failed list", async () => {
        expect(await serverRoleDetail(GUILD, "1")).toBeNull();
        expect(await serverRoleDetail(GUILD, "")).toBeNull();
        mockDiscord.fetchGuildMembersCached.mockRejectedValueOnce(new Error("x"));
        const failed = await serverRoleDetail(GUILD, RAIDER);
        expect(failed.members).toEqual([]);
        expect(failed.membersError).toBe("x");
        mockDiscord.getGuild.mockReturnValue(null);
        expect(await serverRoleDetail(GUILD, RAIDER)).toMatchObject({ online: false, role: null, channels: [], members: [] });
    });

    it("falls back to the user name and the id", async () => {
        mockDiscord.fetchGuildMembersCached.mockResolvedValue([
            { id: "7", displayName: "", roles: { cache: new Set([RAIDER]) }, user: { globalName: "", username: "raidlead" } },
            { id: "8", roles: { cache: new Set([RAIDER]) } },
        ]);
        const out = await serverRoleDetail(GUILD, RAIDER);
        expect(out.members.map((m) => m.name)).toEqual(["8", "raidlead"]);
    });
});

describe("serverRoles roleCount", () => {
    it("counts the roles without @everyone, null offline", () => {
        expect(roleCount(GUILD)).toBe(6);
        mockDiscord.getGuild.mockReturnValue(null);
        expect(roleCount(TALK)).toBeNull();
    });
});
