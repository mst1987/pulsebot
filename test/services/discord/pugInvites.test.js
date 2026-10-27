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
            delete: jest.fn(async (code) => { invites.delete(code); }),
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
        expect(first).toEqual(expect.objectContaining({ code: "new1", channelId: CHANNEL, error: "", deleted: false }));
        expect(fake.channel.createInvite).toHaveBeenCalledWith(expect.objectContaining({ maxAge: 0, maxUses: 0, unique: true }));
        await pugInvites.ensureLinkInvite(KEY);
        expect(fake.channel.createInvite).toHaveBeenCalledTimes(1);
        expect(pugInvites.inviteUrlForLink(KEY)).toBe("https://discord.gg/new1");
    });

    it("makes one invite when the button is pressed twice at once", async () => {
        const [a, b] = await Promise.all([pugInvites.ensureLinkInvite(KEY), pugInvites.ensureLinkInvite(KEY)]);
        expect(fake.channel.createInvite).toHaveBeenCalledTimes(1);
        expect(a).toEqual(b);
        await Promise.all([pugInvites.regenerateGeneralInvite(PUG), pugInvites.regenerateGeneralInvite(PUG)]);
        expect(fake.channel.createInvite).toHaveBeenCalledTimes(2);
    });

    it("creates the invite again on a click when the stored one is gone", async () => {
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
        await pugInvites.ensureLinkInvite(KEY);
        await pugInvites.ensureGeneralInvite(PUG);
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
        expect(rec.error).toMatch(/Server verwalten/);
        expect(fake.channel.createInvite).not.toHaveBeenCalled();
        expect(pugInvites.inviteUrlForLink(KEY)).toBe("");
    });

    it("names a missing server and refuses an unknown link or a server not in the list", async () => {
        discord.getGuild.mockReturnValue(null);
        expect((await pugInvites.ensureLinkInvite(KEY)).error).toBe("Der Bot ist nicht auf diesem Server.");
        expect(await pugInvites.ensureLinkInvite("1:2")).toBeNull();
        expect(await pugInvites.regenerateLinkInvite("1:2")).toBeNull();
        expect(await pugInvites.ensureGeneralInvite("")).toBeNull();
        expect(await pugInvites.ensureGeneralInvite("900000000000000009")).toBeNull();
        expect(await pugInvites.regenerateGeneralInvite("900000000000000009")).toBeNull();
        expect(inviteStore.generalGuildIds()).toEqual([]);
    });

    it("uses the configured invite channel when it is a text channel", () => {
        const other = { id: "300000000000000002", type: ChannelType.GuildText, rawPosition: 5 };
        fake.guild.channels.cache.set(other.id, other);
        expect(pugInvites.inviteChannelOf(fake.guild)).toBe(fake.channel);
        inviteStore.setInviteChannel(PUG, other.id);
        expect(pugInvites.inviteChannelOf(fake.guild)).toBe(other);
    });
});

describe("the check against Discord", () => {
    it("marks an invite deleted by hand as deleted and does not make it again", async () => {
        await pugInvites.ensureLinkInvite(KEY);
        fake.invites.clear();
        await pugInvites.reconcileInvites();
        expect(inviteStore.getLinkInvite(KEY)).toEqual(expect.objectContaining({ code: "new1", deleted: true }));
        expect(pugInvites.inviteUrlForLink(KEY)).toBe("");
        expect(fake.channel.createInvite).toHaveBeenCalledTimes(1);
        expect(pugInvites.inviteOverview().links[0]).toEqual(expect.objectContaining({ deleted: true, url: "" }));
        // A click creates it anew.
        const rec = await pugInvites.ensureLinkInvite(KEY);
        expect(rec).toEqual(expect.objectContaining({ code: "new2", deleted: false }));
    });

    it("leaves the record alone when the invites cannot be read", async () => {
        await pugInvites.ensureLinkInvite(KEY);
        fake.guild.fetchFails = true;
        await pugInvites.reconcileInvites();
        expect(pugInvites.inviteUrlForLink(KEY)).toBe("https://discord.gg/new1");
    });

    it("onInviteDelete only marks the invite deleted", async () => {
        await pugInvites.ensureLinkInvite(KEY);
        fake.invites.delete("new1");
        pugInvites.onInviteDelete({ code: "new1", guild: { id: PUG } });
        await new Promise((r) => setImmediate(r));
        expect(pugInvites.inviteUrlForLink(KEY)).toBe("");
        expect(inviteStore.getLinkInvite(KEY).deleted).toBe(true);
        expect(fake.channel.createInvite).toHaveBeenCalledTimes(1);
        pugInvites.onInviteDelete({ code: "other", guild: { id: PUG } });
        pugInvites.onInviteDelete(null);
    });

    it("deletes the invite of a removed link on Discord and drops its record", async () => {
        await pugInvites.ensureLinkInvite(KEY);
        guildRoles.links.mockReturnValue([]);
        await pugInvites.reconcileInvites();
        expect(fake.guild.invites.delete).toHaveBeenCalledWith("new1", expect.any(String));
        expect(inviteStore.linkKeys()).toEqual([]);
        expect(pugInvites.inviteUrlForLink(KEY)).toBe("");
    });

    it("drops the record of a removed link even when Discord refuses the delete", async () => {
        await pugInvites.ensureLinkInvite(KEY);
        fake.guild.invites.delete.mockRejectedValueOnce(new Error("Missing Permissions"));
        guildRoles.links.mockReturnValue([]);
        await pugInvites.reconcileInvites();
        expect(inviteStore.linkKeys()).toEqual([]);
    });

    it("does not delete again an invite that is already gone", async () => {
        await pugInvites.ensureLinkInvite(KEY);
        inviteStore.setLinkInvite(KEY, { deleted: true });
        guildRoles.links.mockReturnValue([]);
        await pugInvites.reconcileInvites();
        expect(fake.guild.invites.delete).not.toHaveBeenCalled();
        expect(inviteStore.linkKeys()).toEqual([]);
    });

    it("deletes the general invite of a removed server and clears its invite channel", async () => {
        await pugInvites.ensureGeneralInvite(PUG);
        inviteStore.setInviteChannel(PUG, CHANNEL);
        guildRoles.links.mockReturnValue([]);
        guildRoles.serverIds.mockReturnValue([PARTNER]);
        await pugInvites.reconcileInvites();
        expect(fake.guild.invites.delete).toHaveBeenCalledWith("new1", expect.any(String));
        expect(inviteStore.generalGuildIds()).toEqual([]);
        expect(inviteStore.getInviteChannel(PUG)).toBe("");
        // The server is no longer tracked.
        expect(await pugInvites.onMemberAdd(member(fake.guild))).toBeNull();
    });

    it("runs one check at a time", async () => {
        await pugInvites.ensureLinkInvite(KEY);
        const a = pugInvites.reconcileInvites();
        const b = pugInvites.reconcileInvites();
        expect(a).toBe(b);
        await a;
    });

    it("starts the periodic check once and stops it", async () => {
        await pugInvites.ensureLinkInvite(KEY);
        await pugInvites.warmUses();
        fake.guild.invites.fetch.mockClear();
        const timer = pugInvites.startInviteCheck({ intervalMs: 60000 });
        expect(pugInvites.startInviteCheck()).toBe(timer);
        await pugInvites.reconcileInvites();
        expect(fake.guild.invites.fetch).toHaveBeenCalled();
        pugInvites.stopInviteCheck();
        pugInvites.stopInviteCheck();
        expect(pugInvites.startInviteCheck({ intervalMs: 60000 })).not.toBe(timer);
        pugInvites.stopInviteCheck();
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

    it("stores nothing for a join through a foreign invite", async () => {
        await warmWith({ other: 3 });
        fake.invites.get("other").uses = 4;
        expect(await pugInvites.onMemberAdd(member(fake.guild))).toBeNull();
        expect(originStore.listOrigins()).toEqual([]);
    });

    it("stores nothing when no counter rose", async () => {
        await warmWith({});
        expect(await pugInvites.onMemberAdd(member(fake.guild))).toBeNull();
        expect(originStore.listOrigins()).toEqual([]);
    });

    it("stores nothing when two counters rose", async () => {
        await warmWith({ other: 3 });
        fake.invites.get("new1").uses = 1;
        fake.invites.get("other").uses = 4;
        expect(await pugInvites.onMemberAdd(member(fake.guild))).toBeNull();
        expect(originStore.listOrigins()).toEqual([]);
    });

    it("stores nothing, without an error, when the invites are unreadable", async () => {
        await warmWith({});
        fake.guild.fetchFails = true;
        expect(await pugInvites.onMemberAdd(member(fake.guild))).toBeNull();
    });

    it("leaves both unknown when two join at once but the counter rose only once", async () => {
        await warmWith({});
        fake.invites.get("new1").uses = 1;
        const first = pugInvites.onMemberAdd(member(fake.guild, "100000000000000001"));
        const second = pugInvites.onMemberAdd(member(fake.guild, "100000000000000002"));
        expect(await first).toBeNull();
        expect(await second).toBeNull();
        expect(originStore.listOrigins()).toEqual([]);
    });

    it("names the invite for both when two join at once through it", async () => {
        await warmWith({});
        fake.invites.get("new1").uses = 2;
        const first = pugInvites.onMemberAdd(member(fake.guild, "100000000000000001"));
        const second = pugInvites.onMemberAdd(member(fake.guild, "100000000000000002"));
        expect((await first).inviteCode).toBe("new1");
        expect((await second).inviteCode).toBe("new1");
        expect(originStore.originsOfLink(KEY)).toHaveLength(2);
    });

    it("attributes two joins one after another", async () => {
        await warmWith({});
        fake.invites.get("new1").uses = 1;
        expect((await pugInvites.onMemberAdd(member(fake.guild, "100000000000000001"))).inviteCode).toBe("new1");
        fake.invites.get("new1").uses = 2;
        expect((await pugInvites.onMemberAdd(member(fake.guild, "100000000000000002"))).inviteCode).toBe("new1");
    });

    it("counts a new invite from its creation on", async () => {
        await warmWith({});
        inviteStore.setGeneralInvite(PUG, { code: "fresh" });
        pugInvites.onInviteCreate({ code: "fresh", uses: 0, guild: { id: PUG } });
        fake.addInvite("fresh", 1);
        const origin = await pugInvites.onMemberAdd(member(fake.guild));
        expect(origin).toEqual(expect.objectContaining({ inviteCode: "fresh", linkKey: "" }));
    });

    it("skips bots and servers without an invite of the bot", async () => {
        expect(await pugInvites.onMemberAdd(member(fake.guild))).toBeNull();
        expect(fake.guild.invites.fetch).not.toHaveBeenCalled();
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
