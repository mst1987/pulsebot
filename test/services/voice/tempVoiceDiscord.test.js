// The Discord side of the temporary raid voice channels (services/voice/tempVoiceDiscord.js),
// on a hand-built guild - no gateway, no REST.
const { ChannelType, OverwriteType, PermissionsBitField } = require("discord.js");

let mockGuild = null;
let mockAvailable = true;
jest.mock("../../../src/services/discord/discord", () => ({
    getGuild: jest.fn(() => mockGuild),
    isGuildAvailable: jest.fn(() => mockAvailable),
    failFastOnRateLimit: jest.fn((path, run) => run()),
    setChannelNameFast: jest.fn((channel, name) => channel.setName(name)),
}));
const discord = require("../../../src/services/discord/discord");
jest.mock("../../../src/services/discord/linkCheck", () => ({ channelLink: jest.fn((g, c) => (c === "c1" ? `link:${g}/${c}` : "")) }));

const voice = require("../../../src/services/voice/tempVoiceDiscord");

const F = PermissionsBitField.Flags;
const perms = (...flags) => new PermissionsBitField(flags);

function makeGuild({ botPerms = perms(F.ManageChannels, F.MoveMembers, F.ManageRoles) } = {}) {
    const channels = new Map();
    const guild = {
        id: "g1",
        roles: { everyone: { id: "g1" } },
        members: {
            me: { id: "bot", permissions: botPerms },
            cache: new Map([["a", { displayName: "Lahelo" }], ["b", { user: { username: "bee" } }]]),
            fetch: jest.fn(async () => new Map()),
        },
        channels: {
            cache: channels,
            create: jest.fn(async (payload) => {
                const ch = makeChannel(guild, { id: "new", ...payload });
                channels.set("new", ch);
                return ch;
            }),
        },
    };
    return guild;
}

function makeChannel(guild, { id, name = "", members = [], overwrites = [], permissionsFor, type, parentId = null, createdTimestamp = 0 } = {}) {
    const ow = new Map(overwrites.map((o) => [o.id, o]));
    const ch = {
        id, name, guild, type, parentId, createdTimestamp,
        lockPermissions: jest.fn(async () => ch),
        members: new Map(members.map((m) => [m.id, m])),
        permissionOverwrites: {
            cache: ow,
            delete: jest.fn(async (oid) => ow.delete(oid)),
            create: jest.fn(async (oid, p, o) => ow.set(oid, { id: oid, type: o.type })),
            set: jest.fn(async (list) => { ow.clear(); for (const o of list) ow.set(o.id, o); }),
        },
        setName: jest.fn(async (n) => ({ ...ch, name: n })),
        delete: jest.fn(async () => guild.channels.cache.delete(id)),
    };
    if (permissionsFor) ch.permissionsFor = permissionsFor;
    return ch;
}

beforeEach(() => {
    mockGuild = makeGuild();
    mockAvailable = true;
    jest.clearAllMocks();
});

describe("services/voice/tempVoiceDiscord", () => {
    it("links a channel only through linkCheck (#537)", () => {
        expect(voice.channelUrl("g1", "c1")).toBe("link:g1/c1");
        expect(voice.channelUrl("g1", "")).toBe("");
    });

    describe("missingRightKeys", () => {
        it("names what the bot lacks as Discord permission names, checked in the Discord category", () => {
            mockGuild.channels.cache.set("p1", makeChannel(mockGuild, { id: "p1", permissionsFor: () => perms(F.ManageChannels) }));
            expect(voice.missingRightKeys("g1", { parentId: "p1" })).toEqual(["MoveMembers"]);
            expect(voice.missingRightKeys("g1", { parentId: "p1", onlyAssigned: true })).toEqual(["MoveMembers", "ManageRoles"]);
            expect(voice.missingRightKeys("g1", {})).toEqual([]);
        });

        it("asks for managing permissions only with 'only assigned'", () => {
            mockGuild.channels.cache.set("p1", makeChannel(mockGuild, { id: "p1", permissionsFor: () => perms(F.MoveMembers) }));
            expect(voice.missingRightKeys("g1", { parentId: "p1", onlyAssigned: true })).toEqual(["ManageChannels", "ManageRoles"]);
            expect(voice.missingRightKeys("g1", { parentId: "p1" })).toEqual(["ManageChannels"]);
        });

        it("knows nothing while the bot is not on the server", () => {
            mockGuild = null;
            expect(voice.missingRightKeys("g1")).toBeNull();
        });
    });

    describe("createVoice", () => {
        it("creates a voice channel under the Discord category", async () => {
            mockGuild.channels.cache.set("p1", makeChannel(mockGuild, { id: "p1", name: "Raids" }));
            expect(await voice.createVoice("g1", { name: "SSC 2", parentId: "p1" })).toEqual({ id: "new", name: "SSC 2", granted: [] });
            expect(mockGuild.channels.create).toHaveBeenCalledWith({ name: "SSC 2", type: ChannelType.GuildVoice, parent: "p1" });
            expect(discord.failFastOnRateLimit).toHaveBeenCalledWith("/guilds/g1/channels", expect.any(Function));
        });

        it("lets only the assigned on the server connect, keeping the category's roles", async () => {
            const parent = makeChannel(mockGuild, {
                id: "p1",
                overwrites: [
                    { id: "g1", type: OverwriteType.Role, allow: 0n, deny: F.ViewChannel },
                    { id: "raider", type: OverwriteType.Role, allow: F.ViewChannel | F.Connect, deny: 0n },
                ],
            });
            mockGuild.channels.cache.set("p1", parent);
            const made = await voice.createVoice("g1", { name: "SSC", parentId: "p1", onlyAssigned: true, members: ["a", "stranger", "a"] });
            expect(made.granted).toEqual(["a"]);
            expect(mockGuild.members.fetch).toHaveBeenCalledWith({ user: ["stranger"] });
            const list = mockGuild.channels.create.mock.calls[0][0].permissionOverwrites;
            const by = (id) => list.find((o) => o.id === id);
            expect(by("raider").allow.has(F.ViewChannel)).toBe(true);
            expect(by("raider").allow.has(F.Connect)).toBe(false);
            expect(by("raider").deny.has(F.Connect)).toBe(true);
            expect(by("g1").deny.has(F.ViewChannel)).toBe(true);
            expect(by("g1").deny.has(F.Connect)).toBe(true);
            expect(by("bot").allow).toContain(F.MoveMembers);
            expect(by("a")).toEqual({ id: "a", type: OverwriteType.Member, allow: [F.ViewChannel, F.Connect] });
            expect(by("stranger")).toBeUndefined();
        });

        it("fetches the assigned the cache does not know before granting", async () => {
            mockGuild.members.fetch.mockImplementation(async ({ user }) => {
                for (const id of user) if (id === "late") mockGuild.members.cache.set(id, { displayName: "Late" });
            });
            const made = await voice.createVoice("g1", { name: "SSC", onlyAssigned: true, members: ["a", "late", "stranger"] });
            expect(made.granted).toEqual(["a", "late"]);
        });

        it("falls back to the cache when fetching fails", async () => {
            mockGuild.members.fetch.mockRejectedValue(new Error("gateway"));
            const made = await voice.createVoice("g1", { name: "SSC", onlyAssigned: true, members: ["a", "late"] });
            expect(made.granted).toEqual(["a"]);
        });

        it("passes a rate limit through", async () => {
            discord.failFastOnRateLimit.mockRejectedValueOnce(Object.assign(new Error("rl"), { name: "RateLimitError" }));
            await expect(voice.createVoice("g1", { name: "x" })).rejects.toMatchObject({ name: "RateLimitError" });
        });

        it("refuses without the server", async () => {
            mockGuild = null;
            await expect(voice.createVoice("g1", { name: "x" })).rejects.toMatchObject({ code: "bot_offline" });
        });
    });

    describe("syncMembers", () => {
        it("gives the newly assigned a seat and takes only the bot's own seats", async () => {
            const ch = makeChannel(mockGuild, {
                id: "v1",
                overwrites: [
                    { id: "bot", type: OverwriteType.Member }, { id: "b", type: OverwriteType.Member },
                    { id: "hand", type: OverwriteType.Member }, { id: "r", type: OverwriteType.Role },
                ],
            });
            mockGuild.channels.cache.set("v1", ch);
            expect(await voice.syncMembers("g1", "v1", ["a"], ["b"])).toEqual({ granted: ["a"], changed: 2 });
            expect(ch.permissionOverwrites.delete).toHaveBeenCalledWith("b");
            expect(ch.permissionOverwrites.delete).not.toHaveBeenCalledWith("hand");
            expect(ch.permissionOverwrites.create).toHaveBeenCalledWith("a", { ViewChannel: true, Connect: true }, { type: OverwriteType.Member });
            expect(await voice.syncMembers("g1", "v1", ["a"], ["a"])).toEqual({ granted: ["a"], changed: 0 });
        });

        it("does not claim a seat that was set by hand", async () => {
            const ch = makeChannel(mockGuild, { id: "v1", overwrites: [{ id: "b", type: OverwriteType.Member }] });
            mockGuild.channels.cache.set("v1", ch);
            expect(await voice.syncMembers("g1", "v1", ["b"], [])).toEqual({ granted: [], changed: 0 });
            expect(await voice.syncMembers("g1", "v1", [], [])).toEqual({ granted: [], changed: 0 });
            expect(ch.permissionOverwrites.delete).not.toHaveBeenCalled();
        });

        it("knows nothing of a channel that is gone", async () => {
            expect(await voice.syncMembers("g1", "gone", ["a"], [])).toBeNull();
        });
    });

    describe("setAccess", () => {
        it("locks the channel to the assigned when switched on", async () => {
            const ch = makeChannel(mockGuild, { id: "v1" });
            mockGuild.channels.cache.set("v1", ch);
            expect(await voice.setAccess("g1", "v1", { onlyAssigned: true, members: ["a"] })).toEqual({ granted: ["a"] });
            const ids = ch.permissionOverwrites.set.mock.calls[0][0].map((o) => o.id);
            expect(ids).toEqual(["g1", "bot", "a"]);
        });

        it("follows the Discord category again when switched off", async () => {
            const ch = makeChannel(mockGuild, { id: "v1", parentId: "p1" });
            mockGuild.channels.cache.set("p1", makeChannel(mockGuild, { id: "p1" }));
            mockGuild.channels.cache.set("v1", ch);
            expect(await voice.setAccess("g1", "v1", { onlyAssigned: false })).toEqual({ granted: [] });
            expect(ch.lockPermissions).toHaveBeenCalled();
        });

        it("drops the @everyone lock without a Discord category", async () => {
            const ch = makeChannel(mockGuild, { id: "v1", overwrites: [{ id: "g1", type: OverwriteType.Role }, { id: "hand", type: OverwriteType.Member }] });
            mockGuild.channels.cache.set("v1", ch);
            await voice.setAccess("g1", "v1", { onlyAssigned: false });
            expect(ch.permissionOverwrites.delete).toHaveBeenCalledWith("g1");
            expect(ch.permissionOverwrites.cache.has("hand")).toBe(true);
            expect(await voice.setAccess("g1", "gone", {})).toBeNull();
        });
    });

    describe("channelGone", () => {
        it("is proven only by Discord's Unknown Channel", async () => {
            mockGuild.channels.fetch = jest.fn().mockRejectedValue(Object.assign(new Error("Unknown Channel"), { code: 10003 }));
            expect(await voice.channelGone("g1", "v9")).toBe(true);
            expect(mockGuild.channels.fetch).toHaveBeenCalledWith("v9", { force: true });
        });

        it("is not proven by other errors, a cached channel or an unavailable server", async () => {
            mockGuild.channels.fetch = jest.fn().mockRejectedValue(Object.assign(new Error("Missing Access"), { code: 50001 }));
            expect(await voice.channelGone("g1", "v9")).toBe(false);
            mockGuild.channels.cache.set("v1", makeChannel(mockGuild, { id: "v1" }));
            expect(await voice.channelGone("g1", "v1")).toBe(false);
            mockAvailable = false;
            mockGuild.channels.fetch = jest.fn().mockRejectedValue(Object.assign(new Error("Unknown Channel"), { code: 10003 }));
            expect(await voice.channelGone("g1", "v9")).toBe(false);
            expect(mockGuild.channels.fetch).not.toHaveBeenCalled();
        });
    });

    it("finds a channel created before its id was noted", () => {
        const at = 1800000000;
        mockGuild.channels.cache.set("old", makeChannel(mockGuild, { id: "old", name: "SSC", type: ChannelType.GuildVoice, parentId: "p1", createdTimestamp: (at - 3600) * 1000 }));
        mockGuild.channels.cache.set("txt", makeChannel(mockGuild, { id: "txt", name: "SSC", type: ChannelType.GuildText, parentId: "p1", createdTimestamp: at * 1000 }));
        mockGuild.channels.cache.set("v2", makeChannel(mockGuild, { id: "v2", name: "SSC", type: ChannelType.GuildVoice, parentId: "p1", createdTimestamp: (at + 2) * 1000 }));
        expect(voice.findCreatedVoice("g1", { name: "SSC", parentId: "p1", since: at }).id).toBe("v2");
        expect(voice.findCreatedVoice("g1", { name: "SSC", parentId: "", since: at })).toBeNull();
        expect(voice.findCreatedVoice("g1", { name: "TK", parentId: "p1", since: at })).toBeNull();
    });

    it("refuses to pick when several channels fit", () => {
        const at = 1800000000;
        mockGuild.channels.cache.set("v2", makeChannel(mockGuild, { id: "v2", name: "SSC", type: ChannelType.GuildVoice, parentId: "p1", createdTimestamp: (at + 2) * 1000 }));
        mockGuild.channels.cache.set("v3", makeChannel(mockGuild, { id: "v3", name: "SSC", type: ChannelType.GuildVoice, parentId: "p1", createdTimestamp: (at + 9) * 1000 }));
        expect(() => voice.findCreatedVoice("g1", { name: "SSC", parentId: "p1", since: at })).toThrow(expect.objectContaining({ code: "ambiguous" }));
    });

    it("renames, counts and names channels", async () => {
        mockGuild.channels.cache.set("v1", makeChannel(mockGuild, { id: "v1", name: "SSC 1", members: [{ id: "a" }] }));
        expect(await voice.renameVoice("g1", "v1", "SSC")).toBe("SSC");
        expect(await voice.renameVoice("g1", "v1", "SSC 1")).toBe("SSC 1");
        expect(mockGuild.channels.cache.get("v1").setName).toHaveBeenCalledTimes(1);
        expect(discord.setChannelNameFast).toHaveBeenCalledTimes(1);
        expect(await voice.renameVoice("g1", "gone", "x")).toBe("");
        expect(voice.memberCount("g1", "v1")).toBe(1);
        expect(voice.memberCount("g1", "gone")).toBeNull();
        expect(voice.channelName("g1", "v1")).toBe("SSC 1");
        expect(voice.memberName("g1", "a")).toBe("Lahelo");
        expect(voice.memberName("g1", "b")).toBe("bee");
        expect(voice.memberName("g1", "x")).toBe("");
    });

    describe("closeVoice", () => {
        it("moves whoever is left to the fixed channel, then deletes", async () => {
            const target = makeChannel(mockGuild, { id: "f1" });
            const stuck = { id: "c", voice: { setChannel: jest.fn().mockRejectedValue(new Error("no")) } };
            const ok = { id: "a", voice: { setChannel: jest.fn().mockResolvedValue({}) } };
            const ch = makeChannel(mockGuild, { id: "v1", members: [ok, stuck] });
            mockGuild.channels.cache.set("f1", target);
            mockGuild.channels.cache.set("v1", ch);
            expect(await voice.closeVoice("g1", "v1", { moveTo: "f1" })).toEqual({ moved: 1, deleted: true });
            expect(ok.voice.setChannel).toHaveBeenCalledWith(target);
            expect(ch.delete).toHaveBeenCalled();
        });

        it("deletes without a target and counts a channel Discord proves gone as deleted", async () => {
            const ch = makeChannel(mockGuild, { id: "v1", members: [{ id: "a", voice: { setChannel: jest.fn() } }] });
            mockGuild.channels.cache.set("v1", ch);
            expect(await voice.closeVoice("g1", "v1", { moveTo: "missing" })).toEqual({ moved: 0, deleted: true });
            mockGuild.channels.fetch = jest.fn().mockRejectedValue(Object.assign(new Error("Unknown Channel"), { code: 10003 }));
            expect(await voice.closeVoice("g1", "v1")).toEqual({ moved: 0, deleted: true });
            expect(mockGuild.channels.fetch).toHaveBeenCalledWith("v1", { force: true });
        });

        it("asks Discord for a channel not in the cache and deletes it when it is there", async () => {
            const ch = makeChannel(mockGuild, { id: "v1" });
            mockGuild.channels.fetch = jest.fn().mockResolvedValue(ch);
            expect(await voice.closeVoice("g1", "v1")).toEqual({ moved: 0, deleted: true });
            expect(ch.delete).toHaveBeenCalled();
        });

        it("throws instead of counting it deleted on other errors or an unavailable server", async () => {
            mockGuild.channels.fetch = jest.fn().mockRejectedValue(Object.assign(new Error("Service Unavailable"), { status: 503 }));
            await expect(voice.closeVoice("g1", "v1")).rejects.toThrow("Service Unavailable");
            mockAvailable = false;
            await expect(voice.closeVoice("g1", "v1")).rejects.toMatchObject({ code: "bot_offline" });
            mockAvailable = true;
            mockGuild = null;
            await expect(voice.closeVoice("g1", "v1")).rejects.toMatchObject({ code: "bot_offline" });
        });
    });
});
