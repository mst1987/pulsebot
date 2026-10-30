// The members of a server for the web (src/services/discord/servers/serverMembers.js): the list with
// roles, rosters, characters and the "role but not in the roster" hint; one member with the
// channels it can see; the tab count; offline and a member list that fails or takes too long.
const { PermissionsBitField } = require("discord.js");

jest.mock("../../../../src/stores/configStore", () => ({ getConfig: () => ({}) }));
jest.mock("../../../../src/services/discord/roles/guildRoles", () => {
    const actual = jest.requireActual("../../../../src/services/discord/roles/guildRoles");
    const cfg = { discordServers: { servers: [{ guildId: "900000000000000001" }, { guildId: "900000000000000002" }], links: [] } };
    return {
        ...actual,
        serverIds: () => actual.serverIds(cfg),
        roleMessageGuild: (entry) => actual.roleMessageGuild(entry, cfg),
    };
});
jest.mock("../../../../src/services/categories/categoryNames", () => ({ listKnownCategories: () => [] }));
const mockDiscord = {
    getGuild: jest.fn(),
    fetchGuildMembersCached: jest.fn(async () => []),
    avatarUrlOf: jest.fn((m) => `https://cdn/${m.id}.png`),
    NAME_FETCH_MS: 5000,
};
jest.mock("../../../../src/services/discord/discord", () => mockDiscord);
const mockRelation = { rosters: [], of: jest.fn(() => ({ rosters: [], characters: [] })) };
const mockRelationIndex = jest.fn(() => mockRelation);
jest.mock("../../../../src/services/discord/members/memberRelation", () => ({
    relationIndex: () => mockRelationIndex(),
    relationOf: (uid, opts) => mockRelation.of(uid, opts),
    openRosters: () => mockRelation.rosters,
}));

const { listServerMembers, serverMemberDetail, memberCount, visibleChannels } = require("../../../../src/services/discord/servers/serverMembers");

const F = PermissionsBitField.Flags;
const GUILD = "900000000000000001";
const OFFIZIER = "200000000000000001";
const RAIDER = "200000000000000002";
const TRIAL = "200000000000000003";

const role = (id, name, position, extra = {}) => ({ id, name, position, color: 0, hexColor: "#000000", ...extra });

/** A channel whose permissionsFor says yes for the members in `seen`. */
const channel = (id, name, type, rawPosition, parent, seen = []) => ({
    id, name, type, rawPosition, parent,
    permissionsFor: (m) => ({ has: (f) => f === F.ViewChannel && seen.includes(m.id) }),
});

function makeGuild() {
    const roles = new Map([
        [GUILD, role(GUILD, "@everyone", 0)],
        [OFFIZIER, role(OFFIZIER, "Offizier", 10, { color: 0x3366ff, hexColor: "#3366ff" })],
        [RAIDER, role(RAIDER, "TBC-Raider", 5)],
        [TRIAL, role(TRIAL, "Probe", 3)],
    ]);
    const raids = { id: "300000000000000001", name: "Raids", type: 4, rawPosition: 1, parent: null };
    const orga = { id: "300000000000000002", name: "Orga", type: 4, rawPosition: 2, parent: null };
    const channels = [
        raids, orga,
        channel("300000000000000010", "willkommen", 0, 0, null, ["1", "2"]),
        channel("300000000000000011", "raid-chat", 0, 0, raids, ["1", "2"]),
        channel("300000000000000012", "Raid-Sprache", 2, 1, raids, ["1"]),
        channel("300000000000000013", "taktik", 15, 2, raids, ["1"]),
        channel("300000000000000014", "thread", 11, 3, raids, ["1", "2"]),
        channel("300000000000000015", "offiziere", 0, 0, orga, ["1"]),
    ];
    return {
        id: GUILD,
        name: "Test-Server",
        memberCount: 186,
        roles: { cache: roles },
        channels: { cache: new Map(channels.map((c) => [c.id, c])) },
        members: { me: { permissions: { has: () => true }, roles: { highest: roles.get(OFFIZIER) } }, cache: new Map() },
    };
}

const member = (id, displayName, roleIds, extra = {}) => ({
    id, displayName, joinedTimestamp: 1760000000000, roles: { cache: new Map(roleIds.map((r) => [r, {}])) },
    user: { username: displayName.toLowerCase(), bot: false }, ...extra,
});

beforeEach(() => {
    jest.clearAllMocks();
    mockRelation.rosters = [{ id: "r1", name: "TBC Main", roleIds: [RAIDER], trialRoleId: TRIAL }];
    mockRelation.of.mockImplementation((uid) => (uid === "1"
        ? { rosters: [{ id: "r1", name: "TBC Main", categoryId: "c1", versionId: "tbc", status: "core" }], characters: [{ name: "Ostrava", className: "Shaman", versionId: "tbc" }] }
        : { rosters: [], characters: [] }));
    mockDiscord.getGuild.mockReturnValue(makeGuild());
    mockDiscord.fetchGuildMembersCached.mockResolvedValue([
        member("1", "Zora", [RAIDER, OFFIZIER, GUILD]),
        member("2", "Anna", [TRIAL, GUILD]),
        member("3", "PulseBot", [GUILD], { user: { username: "pulsebot", bot: true }, joinedTimestamp: null }),
    ]);
});

describe("serverMembers listServerMembers", () => {
    it("lists the members by name with roles highest first, relation and hints", async () => {
        const out = await listServerMembers(GUILD);
        expect(out).toMatchObject({ online: true, guildId: GUILD, guildName: "Test-Server", membersError: null, total: 3 });
        expect(out.roles).toEqual([
            { id: OFFIZIER, name: "Offizier", color: "#3366ff", position: 10 },
            { id: RAIDER, name: "TBC-Raider", color: "", position: 5 },
            { id: TRIAL, name: "Probe", color: "", position: 3 },
        ]);
        expect(out.members.map((m) => m.name)).toEqual(["Anna", "PulseBot", "Zora"]);
        const [anna, bot, zora] = out.members;
        expect(zora).toEqual({
            id: "1", name: "Zora", username: "zora", avatarUrl: "https://cdn/1.png", bot: false, joinedAt: 1760000000000,
            roleIds: [OFFIZIER, RAIDER],
            rosters: [{ id: "r1", name: "TBC Main", categoryId: "c1", versionId: "tbc", status: "core" }],
            characters: [{ name: "Ostrava", className: "Shaman", versionId: "tbc" }],
            missingRosters: [],
        });
        // the trial role of a roster she is not in
        expect(anna.missingRosters).toEqual([{ id: "r1", name: "TBC Main" }]);
        expect(bot).toMatchObject({ bot: true, joinedAt: null, roleIds: [], rosters: [], characters: [], missingRosters: [] });
        expect(mockRelation.of).not.toHaveBeenCalledWith("3");
    });

    it("is empty with the reason when the member list takes too long or fails", async () => {
        mockDiscord.fetchGuildMembersCached.mockReturnValue(new Promise(() => {}));
        const slow = await listServerMembers(GUILD, { waitMs: 5 });
        expect(slow).toMatchObject({ online: true, membersError: "timeout", total: 0, members: [] });
        expect(slow.roles).toHaveLength(3);
        mockDiscord.fetchGuildMembersCached.mockRejectedValue(new Error("Missing intent"));
        expect(await listServerMembers(GUILD)).toMatchObject({ membersError: "Missing intent", members: [] });
    });

    it("is empty offline and without a server", async () => {
        mockDiscord.getGuild.mockReturnValue(null);
        expect(await listServerMembers(GUILD)).toMatchObject({ online: false, guildId: GUILD, total: 0, roles: [], members: [] });
        expect(await listServerMembers("")).toMatchObject({ online: false, guildId: "", members: [] });
    });
});

describe("serverMembers serverMemberDetail", () => {
    it("gives the member, its roles and the channels it sees, by category", async () => {
        const out = await serverMemberDetail(GUILD, "2");
        expect(out.member).toMatchObject({ id: "2", name: "Anna", missingRosters: [{ id: "r1", name: "TBC Main" }] });
        // one account: its relation alone, with the open rosters read once, never the whole index
        expect(mockRelationIndex).not.toHaveBeenCalled();
        expect(mockRelation.of).toHaveBeenCalledWith("2", { rosters: mockRelation.rosters });
        expect(out.roles).toEqual([{ id: TRIAL, name: "Probe", color: "", position: 3 }]);
        expect(out.channels).toEqual([
            { id: "", name: "", visible: 1, total: 1, channels: [{ id: "300000000000000010", name: "willkommen", kind: "text" }] },
            { id: "300000000000000001", name: "Raids", visible: 1, total: 3, channels: [{ id: "300000000000000011", name: "raid-chat", kind: "text" }] },
            { id: "300000000000000002", name: "Orga", visible: 0, total: 1, channels: [] },
        ]);
    });

    it("names voice and forum channels as such", async () => {
        const out = await serverMemberDetail(GUILD, "1");
        expect(out.channels[1].channels.map((c) => c.kind)).toEqual(["text", "voice", "forum"]);
    });

    it("finds a member in the guild cache when the list timed out, gone when unknown", async () => {
        const guild = makeGuild();
        guild.members.cache.set("7", member("7", "Gast", []));
        mockDiscord.getGuild.mockReturnValue(guild);
        mockDiscord.fetchGuildMembersCached.mockReturnValue(new Promise(() => {}));
        expect((await serverMemberDetail(GUILD, "7", { waitMs: 5 })).member.name).toBe("Gast");
        const gone = await serverMemberDetail(GUILD, "8", { waitMs: 5 });
        expect(gone).toMatchObject({ online: true, guildId: GUILD, gone: true, member: null, roles: [], channels: [] });
        expect(await serverMemberDetail(GUILD, "", { waitMs: 5 })).toMatchObject({ gone: true, member: null });
        expect((await serverMemberDetail(GUILD, "7", { waitMs: 5 })).gone).toBeUndefined();
    });

    it("is empty offline", async () => {
        mockDiscord.getGuild.mockReturnValue(null);
        expect(await serverMemberDetail(GUILD, "1")).toMatchObject({ online: false, member: null, roles: [], channels: [] });
    });
});

describe("serverMembers visibleChannels / memberCount", () => {
    it("treats a channel whose permissions throw as not seen, and a guild without channels as none", () => {
        const guild = makeGuild();
        guild.channels.cache.get("300000000000000010").permissionsFor = () => { throw new Error("partial"); };
        expect(visibleChannels(guild, { id: "1" })[0]).toMatchObject({ visible: 0, total: 1 });
        expect(visibleChannels({}, { id: "1" })).toEqual([]);
    });

    it("counts the people without bots, null offline or without a server", () => {
        // nothing cached: Discord's own count
        expect(memberCount(GUILD)).toBe(186);
        expect(memberCount("")).toBeNull();
        mockDiscord.getGuild.mockReturnValue(null);
        expect(memberCount()).toBeNull();
    });

    it("leaves the bots out: the whole cache counted, a partial cache minus its bots", () => {
        const full = makeGuild();
        full.memberCount = 3;
        full.members.cache = new Map([
            ["1", member("1", "Zora", [])],
            ["2", member("2", "Anna", [])],
            ["3", member("3", "PulseBot", [], { user: { username: "pulsebot", bot: true } })],
        ]);
        mockDiscord.getGuild.mockReturnValue(full);
        expect(memberCount(GUILD)).toBe(2);
        const partial = makeGuild();
        partial.members.cache = new Map([["3", member("3", "PulseBot", [], { user: { username: "pulsebot", bot: true } })]]);
        mockDiscord.getGuild.mockReturnValue(partial);
        expect(memberCount(GUILD)).toBe(185);
        // no count from Discord: the cache alone
        partial.memberCount = undefined;
        partial.members.cache.set("1", member("1", "Zora", []));
        expect(memberCount(GUILD)).toBe(1);
    });
});
