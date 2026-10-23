// The roles of a server for the web (src/services/discord/serverRoles.js): list with counts,
// permissions, bot uses, assignability and hints; one role with its channel overwrites and
// members; the tab count; offline and a member list that fails or takes too long.
const { PermissionsBitField } = require("discord.js");

let mockConfig = {};
jest.mock("../../../src/stores/configStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/services/discord/guildRoles", () => ({
    eventGuildId: () => "900000000000000001",
    talkGuildId: () => "900000000000000002",
}));
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
const { listServerRoles, serverRoleDetail, roleCount, permissionKeys, SENSITIVE_PERMISSIONS } = require("../../../src/services/discord/serverRoles");

const F = PermissionsBitField.Flags;
const GUILD = "900000000000000001";
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
});

describe("serverRoles listServerRoles", () => {
    it("lists every role highest first with counts, uses, assignability and hints", async () => {
        const out = await listServerRoles("event");
        expect(out).toMatchObject({ online: true, side: "event", guildId: GUILD, guildName: "Test-Server", manageRoles: true, membersError: null, total: 7 });
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
        const out = await listServerRoles("event");
        expect(out.manageRoles).toBe(false);
        expect(out.roles.find((r) => r.id === RAIDER).assign).toEqual({ ok: false, reason: "noManageRoles" });
    });

    it("keeps the roles when the member list fails or takes too long", async () => {
        mockDiscord.fetchGuildMembersCached.mockRejectedValueOnce(new Error("Missing intent"));
        const failed = await listServerRoles("event");
        expect(failed.membersError).toBe("Missing intent");
        expect(failed.roles.every((r) => r.memberCount === null)).toBe(true);
        expect(failed.roles.find((r) => r.id === EMPTY).hints).toEqual([]);

        mockDiscord.fetchGuildMembersCached.mockReturnValueOnce(new Promise(() => {}));
        const slow = await listServerRoles("event", { waitMs: 5 });
        expect(slow.membersError).toBe("timeout");
        expect(slow.total).toBe(7);
    });

    it("is empty and offline without the server, and reads the talk side", async () => {
        mockDiscord.getGuild.mockReturnValue(null);
        expect(await listServerRoles("talk")).toEqual({ side: "talk", guildId: "900000000000000002", guildName: "", online: false, botRole: null, manageRoles: null, membersError: null, total: 0, roles: [] });
        expect(mockDiscord.getGuild).toHaveBeenCalledWith("900000000000000002");
    });

    it("counts only the role messages of its own side", async () => {
        mockDiscord.getGuild.mockReturnValue(makeGuild());
        const out = await listServerRoles("talk");
        expect(out.roles.find((r) => r.id === RAIDER).uses).toContainEqual({ code: "roleMessage", messageId: "rm-2", title: "Anderer Server" });
    });

    it("survives broken stores", async () => {
        roleMessageStore.listMessages.mockImplementation(() => { throw new Error("broken"); });
        addonCenterStore.getSettings.mockImplementation(() => { throw new Error("broken"); });
        const out = await listServerRoles("event");
        expect(out.roles.find((r) => r.id === EMPTY).uses).toEqual([]);
    });
});

describe("serverRoles serverRoleDetail", () => {
    it("lists the overwrites in Discord order and the members by name", async () => {
        const out = await serverRoleDetail("event", RAIDER);
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
        const out = await serverRoleDetail("event", GUILD);
        expect(out.members.map((m) => [m.name, m.bot])).toEqual([["Anna", false], ["PulseBot", true], ["Zora", false]]);
    });

    it("is null for an unknown role, empty offline, no members on a failed list", async () => {
        expect(await serverRoleDetail("event", "1")).toBeNull();
        expect(await serverRoleDetail("event", "")).toBeNull();
        mockDiscord.fetchGuildMembersCached.mockRejectedValueOnce(new Error("x"));
        const failed = await serverRoleDetail("event", RAIDER);
        expect(failed.members).toEqual([]);
        expect(failed.membersError).toBe("x");
        mockDiscord.getGuild.mockReturnValue(null);
        expect(await serverRoleDetail("event", RAIDER)).toMatchObject({ online: false, role: null, channels: [], members: [] });
    });

    it("falls back to the user name and the id", async () => {
        mockDiscord.fetchGuildMembersCached.mockResolvedValue([
            { id: "7", displayName: "", roles: { cache: new Set([RAIDER]) }, user: { globalName: "", username: "raidlead" } },
            { id: "8", roles: { cache: new Set([RAIDER]) } },
        ]);
        const out = await serverRoleDetail("event", RAIDER);
        expect(out.members.map((m) => m.name)).toEqual(["8", "raidlead"]);
    });
});

describe("serverRoles roleCount", () => {
    it("counts the roles without @everyone, null offline", () => {
        expect(roleCount("event")).toBe(6);
        mockDiscord.getGuild.mockReturnValue(null);
        expect(roleCount("talk")).toBeNull();
    });
});
