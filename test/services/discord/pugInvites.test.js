// Invites per link and the origin of each member (src/services/discord/pugInvites.js, #905).
jest.mock("../../../src/services/discord/discord", () => ({ getGuild: jest.fn() }));
jest.mock("../../../src/services/discord/guildRoles", () => ({ links: jest.fn(), serverIds: jest.fn() }));
jest.mock("../../../src/stores/eventStore", () => ({ listEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: jest.fn(() => []) }));

const { ChannelType, PermissionsBitField } = require("discord.js");
const discord = require("../../../src/services/discord/discord");
const guildRoles = require("../../../src/services/discord/guildRoles");
const eventStore = require("../../../src/stores/eventStore");
const signupStore = require("../../../src/stores/signupStore");
const inviteStore = require("../../../src/stores/discordInviteStore");
const originStore = require("../../../src/stores/memberOriginStore");
const pugInvites = require("../../../src/services/discord/pugInvites");
const { tempStoreFile } = require("../../helpers/tempStore");

const PUG = "900000000000000001";
const PARTNER = "900000000000000002";
const KEY = `${PUG}:${PARTNER}`;
const CHANNEL = "300000000000000001";

/** A fake guild with live invites; `perms` lists the flags the bot has. */
function makeGuild({ id = PUG, perms = ["CreateInstantInvite", "ManageGuild"], fetchFails = false } = {}) {
    const invites = new Map();
    let counter = 0;
    const addInvite = (code, uses = 0) => {
        const invite = {
            code, uses,
            delete: jest.fn(async () => { invites.delete(code); }),
        };
        invites.set(code, invite);
        return invite;
    };
    const channel = {
        id: CHANNEL, type: ChannelType.GuildText, rawPosition: 0,
        createInvite: jest.fn(async () => addInvite(`new${++counter}`)),
    };
    const flags = perms.map((p) => PermissionsBitField.Flags[p]);
    const guild = {
        id,
        systemChannelId: null,
        channels: { cache: new Map([[CHANNEL, channel]]) },
        members: { me: { permissions: { has: (f) => flags.includes(f) } } },
        invites: {
            fetch: jest.fn(async () => {
                if (guild.fetchFails) throw new Error("Missing Permissions");
                return new Map(invites);
            }),
        },
        fetchFails,
    };
    return { guild, channel, invites, addInvite };
}

const member = (guild, id = "100000000000000001", bot = false) => ({ id, guild, user: { bot } });

let fake;
beforeEach(() => {
    inviteStore.useFile(tempStoreFile("discord-invites.json"));
    originStore.useFile(tempStoreFile("member-origins.json"));
    pugInvites.resetForTests();
    fake = makeGuild();
    discord.getGuild.mockImplementation((id) => (id === PUG ? fake.guild : null));
    guildRoles.links.mockReturnValue([{ from: PUG, to: PARTNER }]);
    guildRoles.serverIds.mockReturnValue([PUG, PARTNER]);
    eventStore.listEvents.mockReturnValue([]);
    signupStore.listSignups.mockReturnValue([]);
});
afterAll(() => {
    inviteStore.useFile(null);
    originStore.useFile(null);
});

describe("creating the invites", () => {
    it("creates a link's invite once and reuses it while it exists", async () => {
        const first = await pugInvites.ensureLinkInvite(KEY);
        expect(first).toEqual(expect.objectContaining({ code: "new1", channelId: CHANNEL, error: "" }));
        expect(fake.channel.createInvite).toHaveBeenCalledWith(expect.objectContaining({ maxAge: 0, maxUses: 0, unique: true }));
        await pugInvites.ensureLinkInvite(KEY);
        expect(fake.channel.createInvite).toHaveBeenCalledTimes(1);
        expect(pugInvites.inviteUrlForLink(KEY)).toBe("https://discord.gg/new1");
    });

    it("creates the invite again when the stored one is gone", async () => {
        await pugInvites.ensureLinkInvite(KEY);
        fake.invites.clear();
        await pugInvites.ensureLinkInvite(KEY);
        expect(pugInvites.inviteUrlForLink(KEY)).toBe("https://discord.gg/new2");
    });

    it("regenerate replaces the invite and deletes the old one", async () => {
        await pugInvites.ensureLinkInvite(KEY);
        const old = fake.invites.get("new1");
        await pugInvites.regenerateLinkInvite(KEY);
        expect(old.delete).toHaveBeenCalled();
        expect(pugInvites.inviteUrlForLink(KEY)).toBe("https://discord.gg/new2");
        expect(fake.invites.has("new1")).toBe(false);
    });

    it("keeps one general invite per server apart from the link invites", async () => {
        await pugInvites.ensureAllInvites();
        expect(pugInvites.inviteUrlForLink(KEY)).toBe("https://discord.gg/new1");
        expect(pugInvites.generalInviteUrl(PUG)).toBe("https://discord.gg/new2");
        expect(pugInvites.generalInviteUrl(PARTNER)).toBe("");
        await pugInvites.regenerateGeneralInvite(PUG);
        expect(pugInvites.generalInviteUrl(PUG)).toBe("https://discord.gg/new3");
        expect(pugInvites.inviteUrlForLink(KEY)).toBe("https://discord.gg/new1");
    });

    it("stores a missing bot right as the link's error instead of creating", async () => {
        fake = makeGuild({ perms: ["CreateInstantInvite"] });
        const rec = await pugInvites.ensureLinkInvite(KEY);
        expect(rec.error).toBe("Dem Bot fehlt das Recht „Server verwalten“.");
        expect(fake.channel.createInvite).not.toHaveBeenCalled();
        expect(pugInvites.inviteUrlForLink(KEY)).toBe("");
    });

    it("names a missing server and refuses an unknown link", async () => {
        discord.getGuild.mockReturnValue(null);
        expect((await pugInvites.ensureLinkInvite(KEY)).error).toBe("Der Bot ist nicht auf diesem Server.");
        expect(await pugInvites.ensureLinkInvite("1:2")).toBeNull();
        expect(await pugInvites.regenerateLinkInvite("1:2")).toBeNull();
        expect(await pugInvites.ensureGeneralInvite("")).toBeNull();
    });

    it("uses the configured invite channel when it is a text channel", () => {
        const other = { id: "300000000000000002", type: ChannelType.GuildText, rawPosition: 5 };
        fake.guild.channels.cache.set(other.id, other);
        expect(pugInvites.inviteChannelOf(fake.guild)).toBe(fake.channel);
        inviteStore.setInviteChannel(PUG, other.id);
        expect(pugInvites.inviteChannelOf(fake.guild)).toBe(other);
    });

    it("creates a link's invite again when somebody deletes it by hand", async () => {
        await pugInvites.ensureLinkInvite(KEY);
        fake.invites.delete("new1");
        pugInvites.onInviteDelete({ code: "new1", guild: { id: PUG } });
        await new Promise((r) => setImmediate(r));
        expect(pugInvites.inviteUrlForLink(KEY)).toBe("https://discord.gg/new2");
    });
});

describe("the origin of a member", () => {
    async function warmWith(codes) {
        await pugInvites.ensureLinkInvite(KEY);
        for (const [code, uses] of Object.entries(codes)) fake.addInvite(code, uses);
        await pugInvites.warmUses();
    }

    it("names the one invite whose counter rose", async () => {
        await warmWith({ other: 3 });
        fake.invites.get("new1").uses = 1;
        const origin = await pugInvites.onMemberAdd(member(fake.guild));
        expect(origin).toEqual(expect.objectContaining({ guildId: PUG, inviteCode: "new1", linkKey: KEY }));
        expect(originStore.originsOfLink(KEY)).toHaveLength(1);
    });

    it("keeps a foreign invite's code without a link", async () => {
        await warmWith({ other: 3 });
        fake.invites.get("other").uses = 4;
        const origin = await pugInvites.onMemberAdd(member(fake.guild));
        expect(origin).toEqual(expect.objectContaining({ inviteCode: "other", linkKey: "" }));
    });

    it("leaves the origin unknown when no counter rose", async () => {
        await warmWith({});
        const origin = await pugInvites.onMemberAdd(member(fake.guild));
        expect(origin).toEqual(expect.objectContaining({ inviteCode: "", linkKey: "" }));
    });

    it("leaves the origin unknown when two counters rose", async () => {
        await warmWith({ other: 3 });
        fake.invites.get("new1").uses = 1;
        fake.invites.get("other").uses = 4;
        const origin = await pugInvites.onMemberAdd(member(fake.guild));
        expect(origin.inviteCode).toBe("");
    });

    it("leaves the origin unknown, without an error, when the invites are unreadable", async () => {
        await warmWith({});
        fake.guild.fetchFails = true;
        const origin = await pugInvites.onMemberAdd(member(fake.guild));
        expect(origin).toEqual(expect.objectContaining({ inviteCode: "", linkKey: "" }));
    });

    it("attributes two joins one after another", async () => {
        await warmWith({});
        fake.invites.get("new1").uses = 1;
        const first = pugInvites.onMemberAdd(member(fake.guild, "100000000000000001"));
        const second = pugInvites.onMemberAdd(member(fake.guild, "100000000000000002"));
        expect((await first).inviteCode).toBe("new1");
        expect((await second).inviteCode).toBe("");
    });

    it("counts a new invite from its creation on", async () => {
        await warmWith({});
        pugInvites.onInviteCreate({ code: "fresh", uses: 0, guild: { id: PUG } });
        fake.addInvite("fresh", 1);
        const origin = await pugInvites.onMemberAdd(member(fake.guild));
        expect(origin.inviteCode).toBe("fresh");
    });

    it("skips bots and servers that are no link source", async () => {
        await warmWith({});
        expect(await pugInvites.onMemberAdd(member(fake.guild, "100000000000000001", true))).toBeNull();
        expect(await pugInvites.onMemberAdd(member({ id: PARTNER }))).toBeNull();
        expect(await pugInvites.onMemberAdd(null)).toBeNull();
        expect(originStore.listOrigins()).toEqual([]);
    });
});

describe("inviteOverview", () => {
    it("counts per link who joined and who of them signed up", async () => {
        await pugInvites.ensureLinkInvite(KEY);
        originStore.recordOrigin({ guildId: PUG, userId: "100000000000000001", inviteCode: "new1", linkKey: KEY });
        originStore.recordOrigin({ guildId: PUG, userId: "100000000000000002", inviteCode: "new1", linkKey: KEY });
        originStore.recordOrigin({ guildId: PUG, userId: "100000000000000003", inviteCode: "new1", linkKey: KEY });
        eventStore.listEvents.mockReturnValue([{ id: "e1" }]);
        signupStore.listSignups.mockReturnValue([
            { userId: "100000000000000001", status: "primary" },
            { userId: "100000000000000002", status: "absence" },
        ]);
        const view = pugInvites.inviteOverview();
        expect(eventStore.listEvents).toHaveBeenCalledWith(PUG);
        expect(view.links).toEqual([expect.objectContaining({
            key: KEY, from: PUG, to: PARTNER, url: "https://discord.gg/new1", error: "", joined: 3, signedUp: 1,
        })]);
        expect(view.servers).toEqual([
            expect.objectContaining({ guildId: PUG, source: true, url: "", error: "" }),
            expect.objectContaining({ guildId: PARTNER, source: false, error: "" }),
        ]);
    });

    it("shows a missing bot right as the link's error", () => {
        fake = makeGuild({ perms: [] });
        const view = pugInvites.inviteOverview();
        expect(view.links[0].error).toBe("Dem Bot fehlen die Rechte „Einladung erstellen“ und „Server verwalten“.");
        expect(view.servers[0].error).toBe(view.links[0].error);
    });
});
