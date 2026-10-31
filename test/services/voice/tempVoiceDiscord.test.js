// The Discord side of the temporary raid voice channels (services/voice/tempVoiceDiscord.js),
// on a hand-built guild - no gateway, no REST.
const { ChannelType, OverwriteType, PermissionsBitField } = require("discord.js");

let mockGuild = null;
jest.mock("../../../src/services/discord/discord", () => ({ getGuild: jest.fn(() => mockGuild) }));
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

function makeChannel(guild, { id, name = "", members = [], overwrites = [], permissionsFor } = {}) {
    const ow = new Map(overwrites.map((o) => [o.id, o]));
    const ch = {
        id, name, guild,
        members: new Map(members.map((m) => [m.id, m])),
        permissionOverwrites: {
            cache: ow,
            delete: jest.fn(async (oid) => ow.delete(oid)),
            create: jest.fn(async (oid, p, o) => ow.set(oid, { id: oid, type: o.type })),
        },
        setName: jest.fn(async (n) => ({ ...ch, name: n })),
        delete: jest.fn(async () => guild.channels.cache.delete(id)),
    };
    if (permissionsFor) ch.permissionsFor = permissionsFor;
    return ch;
}

beforeEach(() => {
    mockGuild = makeGuild();
});

describe("services/voice/tempVoiceDiscord", () => {
    it("links a channel only through linkCheck (#537)", () => {
        expect(voice.channelUrl("g1", "c1")).toBe("link:g1/c1");
        expect(voice.channelUrl("g1", "")).toBe("");
    });

    describe("missingRights", () => {
        it("names what the bot lacks, checked in the Discord category", () => {
            mockGuild.channels.cache.set("p1", makeChannel(mockGuild, { id: "p1", permissionsFor: () => perms(F.ManageChannels) }));
            expect(voice.missingRights("g1", { parentId: "p1" })).toEqual(["Mitglieder verschieben"]);
            expect(voice.missingRights("g1", { parentId: "p1", onlyAssigned: true })).toEqual(["Mitglieder verschieben", "Berechtigungen verwalten"]);
            expect(voice.missingRights("g1", {})).toEqual([]);
        });

        it("knows nothing while the bot is not on the server", () => {
            mockGuild = null;
            expect(voice.missingRights("g1")).toBeNull();
        });
    });

    describe("createVoice", () => {
        it("creates a voice channel under the Discord category", async () => {
            mockGuild.channels.cache.set("p1", makeChannel(mockGuild, { id: "p1", name: "Raids" }));
            expect(await voice.createVoice("g1", { name: "SSC 2", parentId: "p1" })).toEqual({ id: "new", name: "SSC 2" });
            expect(mockGuild.channels.create).toHaveBeenCalledWith({ name: "SSC 2", type: ChannelType.GuildVoice, parent: "p1" });
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
            await voice.createVoice("g1", { name: "SSC", parentId: "p1", onlyAssigned: true, members: ["a", "stranger", "a"] });
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

        it("refuses without the server", async () => {
            mockGuild = null;
            await expect(voice.createVoice("g1", { name: "x" })).rejects.toMatchObject({ code: "bot_offline" });
        });
    });

    it("syncs who may join", async () => {
        const ch = makeChannel(mockGuild, {
            id: "v1",
            overwrites: [{ id: "bot", type: OverwriteType.Member }, { id: "b", type: OverwriteType.Member }, { id: "r", type: OverwriteType.Role }],
        });
        mockGuild.channels.cache.set("v1", ch);
        expect(await voice.syncMembers("g1", "v1", ["a"])).toBe(2);
        expect(ch.permissionOverwrites.delete).toHaveBeenCalledWith("b");
        expect(ch.permissionOverwrites.create).toHaveBeenCalledWith("a", { ViewChannel: true, Connect: true }, { type: OverwriteType.Member });
        expect(await voice.syncMembers("g1", "v1", ["a"])).toBe(0);
        expect(await voice.syncMembers("g1", "gone", ["a"])).toBe(0);
    });

    it("renames, counts and names channels", async () => {
        mockGuild.channels.cache.set("v1", makeChannel(mockGuild, { id: "v1", name: "SSC 1", members: [{ id: "a" }] }));
        expect(await voice.renameVoice("g1", "v1", "SSC")).toBe("SSC");
        expect(await voice.renameVoice("g1", "v1", "SSC 1")).toBe("SSC 1");
        expect(mockGuild.channels.cache.get("v1").setName).toHaveBeenCalledTimes(1);
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

        it("deletes without a target and counts a gone channel as deleted", async () => {
            const ch = makeChannel(mockGuild, { id: "v1", members: [{ id: "a", voice: { setChannel: jest.fn() } }] });
            mockGuild.channels.cache.set("v1", ch);
            expect(await voice.closeVoice("g1", "v1", { moveTo: "missing" })).toEqual({ moved: 0, deleted: true });
            expect(await voice.closeVoice("g1", "v1")).toEqual({ moved: 0, deleted: true });
        });
    });
});
