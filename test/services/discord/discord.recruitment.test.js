// The recruitment message's apply button carries the game version of its
// applications (#553): "apply:<versionId>", the bare "apply" of a message from
// before still counts, and a scan reads the version off the button.
const discord = require("../../../src/services/discord/discord.js");
const dc = require("../../helpers/discordClient");
const { asEmbed, cardButtons } = require("../../helpers/card");

const BOT = "bot-1";
const msg = (customId, over = {}) => ({
    author: { id: BOT },
    content: "Wir suchen!",
    embeds: [],
    components: [{ components: [{ customId, label: "Bewerben" }] }],
    ...over,
});

beforeEach(() => discord.setClient({ user: { id: BOT } }));
afterAll(() => discord.setClient(null));

describe("services/discord/discord recruitment messages (#553)", () => {
    it("knows the bot's apply button with and without a version", () => {
        expect(discord.isRecruitmentMessage(msg("apply"))).toBe(true);
        expect(discord.isRecruitmentMessage(msg("apply:classic"))).toBe(true);
        expect(discord.isRecruitmentMessage(msg("apply-class"))).toBe(false);
        expect(discord.isRecruitmentMessage(msg("apply:classic", { author: { id: "someone" } }))).toBe(false);
    });

    it("reads the version off the button, TBC for the bare one", () => {
        expect(discord.extractTemplate(msg("apply:classic"))).toEqual({ content: "Wir suchen!", title: "", body: "", buttonLabel: "Bewerben", versionId: "classic", buttonKind: "apply", linkUrl: "" });
        expect(discord.extractTemplate(msg("apply")).versionId).toBe("tbc");
        expect(discord.extractTemplate(msg("other")).versionId).toBe("");
    });

    it("posts the button with the template's version, the bare one without", async () => {
        const channel = dc.makeChannel({ id: "c1" });
        discord.setClient(dc.makeClient({ channels: [channel], user: { id: BOT } }));
        await discord.postRecruitment("c1", { content: "Hi", buttonLabel: "Los", versionId: "classic" });
        await discord.postRecruitment("c1", { content: "Hi", buttonLabel: "Los" });
        // one card each: the template's text and the button inside it
        const ids = channel.send.mock.calls.map((c) => cardButtons(c[0])[0].custom_id);
        expect(ids).toEqual(["apply:classic", "apply"]);
        expect(asEmbed(channel.send.mock.calls[0][0]).description).toBe("Hi");
    });

    it("finds a card post too: the button and the text inside the card (Oct 2026)", () => {
        const card = (customId) => msg(customId, {
            content: "",
            components: [{ type: 17, components: [{ type: 10, content: "Wir suchen!" }, { type: 1, components: [{ customId, label: "Bewerben" }] }] }],
        });
        expect(discord.isRecruitmentMessage(card("apply:classic"))).toBe(true);
        expect(discord.isRecruitmentMessage(card("other"))).toBe(false);
        expect(discord.extractTemplate(card("apply:classic"))).toEqual({ content: "Wir suchen!", title: "", body: "", buttonLabel: "Bewerben", versionId: "classic", buttonKind: "apply", linkUrl: "" });
    });
});

describe("services/discord/discord recruitment as forum post with a link button", () => {
    const { ChannelType } = require("discord.js");
    const perms = (allowed) => () => ({ has: (flag) => allowed.includes(flag) });
    const { SendMessages, SendMessagesInThreads, CreateInstantInvite, ViewChannel } = require("discord.js").PermissionsBitField.Flags;

    function forum(over = {}) {
        return dc.makeChannel({
            id: "f1", name: "recruitment", type: ChannelType.GuildForum, guildId: "g1",
            threads: { create: jest.fn(async ({ name }) => ({ id: "t-new", name, url: "https://discord.com/channels/g1/t-new" })) },
            ...over,
        });
    }

    it("builds a link button with its own label instead of the apply button", () => {
        const payload = discord.buildRecruitmentMessage({ content: "Hi", buttonKind: "link", linkUrl: "https://discord.gg/abc", buttonLabel: "Komm rein" });
        const [button] = cardButtons(payload);
        expect(button).toMatchObject({ style: 5, url: "https://discord.gg/abc", label: "Komm rein" });
        expect(button.custom_id).toBeUndefined();
        expect(cardButtons(discord.buildRecruitmentMessage({ buttonKind: "link", linkUrl: "https://discord.gg/abc" }))[0].label).toBe("Server beitreten");
    });

    it("opens a forum post titled by the template and stores the thread as channel and message", async () => {
        const f = forum();
        discord.setClient(dc.makeClient({ channels: [f], user: { id: BOT } }));
        const res = await discord.postRecruitment("f1", { content: "Hi", forumTitle: "  Wir suchen Heiler  ", buttonKind: "link", linkUrl: "https://discord.gg/abc" });
        expect(res).toEqual({ guildId: "g1", channelId: "t-new", messageId: "t-new", parentChannelId: "f1", url: "https://discord.com/channels/g1/t-new" });
        const args = f.threads.create.mock.calls[0][0];
        expect(args.name).toBe("Wir suchen Heiler");
        expect(cardButtons(args.message)[0].url).toBe("https://discord.gg/abc");
        expect(f.send).not.toHaveBeenCalled();
    });

    it("refuses a forum post without a title and cuts a long one to 100 characters", async () => {
        const f = forum();
        discord.setClient(dc.makeClient({ channels: [f], user: { id: BOT } }));
        await expect(discord.postRecruitment("f1", { content: "Hi", forumTitle: "  " })).rejects.toMatchObject({ code: "title_required" });
        await discord.postRecruitment("f1", { content: "Hi", forumTitle: "x".repeat(150) });
        expect(f.threads.create.mock.calls[0][0].name).toHaveLength(100);
    });

    it("keeps a text channel post without a parent channel", async () => {
        const channel = dc.makeChannel({ id: "c1" });
        discord.setClient(dc.makeClient({ channels: [channel], user: { id: BOT } }));
        const res = await discord.postRecruitment("c1", { content: "Hi" });
        expect(res.parentChannelId).toBe("");
        expect(res.channelId).toBe("c1");
    });

    describe("editing a forum post", () => {
        const { ManageThreads } = require("discord.js").PermissionsBitField.Flags;
        let calls;

        function thread({ edit, setName, ...over } = {}) {
            calls = [];
            const message = {
                id: "t1", author: { id: BOT }, url: "u",
                edit: jest.fn(edit || (async () => { calls.push("edit"); })),
            };
            return dc.makeChannel({
                id: "t1", name: "Alt", type: ChannelType.PublicThread, messages: [message],
                isThread: () => true, archived: false,
                setArchived: jest.fn(async () => { calls.push("setArchived"); }),
                setName: jest.fn(setName || (async () => { calls.push("setName"); })),
                ...over,
            });
        }

        afterEach(() => jest.useRealTimers());

        it("edits the text first and renames afterwards, only when the title changed", async () => {
            const t = thread();
            discord.setClient(dc.makeClient({ channels: [t], user: { id: BOT } }));
            const res = await discord.editRecruitment("t1", "t1", { content: "Neu", forumTitle: "Neu" });
            expect(calls).toEqual(["edit", "setName"]);
            expect(t.setArchived).not.toHaveBeenCalled();
            expect(res).toEqual({ channelId: "t1", messageId: "t1", url: "u", notice: "" });
            t.setName.mockClear();
            t.name = "Neu";
            await discord.editRecruitment("t1", "t1", { content: "Neu", forumTitle: "Neu" });
            expect(t.setName).not.toHaveBeenCalled();
        });

        it("reopens an archived post only when Discord refuses the edit, then edits again", async () => {
            let first = true;
            const t = thread({
                archived: true,
                edit: async () => {
                    calls.push("edit");
                    if (first) { first = false; throw Object.assign(new Error("archived"), { code: 50083 }); }
                },
            });
            discord.setClient(dc.makeClient({ channels: [t], user: { id: BOT } }));
            await discord.editRecruitment("t1", "t1", { content: "Neu", forumTitle: "Alt" });
            expect(calls).toEqual(["edit", "setArchived", "edit"]);
            expect(t.setArchived).toHaveBeenCalledWith(false, expect.any(String));
        });

        it("says so when a locked post cannot be reopened without Threads verwalten", async () => {
            const t = thread({
                locked: true, archived: true,
                guild: { members: { me: { id: BOT } } },
                permissionsFor: perms([SendMessages]),
                edit: async () => { throw Object.assign(new Error("locked"), { code: 160005 }); },
            });
            discord.setClient(dc.makeClient({ channels: [t], user: { id: BOT } }));
            await expect(discord.editRecruitment("t1", "t1", { content: "Neu" })).rejects.toMatchObject({ code: "thread_locked" });
            expect(t.setArchived).not.toHaveBeenCalled();
        });

        it("reopens a locked post when the bot may manage threads", async () => {
            let first = true;
            const t = thread({
                locked: true, archived: true,
                guild: { members: { me: { id: BOT } } },
                permissionsFor: perms([ManageThreads]),
                edit: async () => {
                    calls.push("edit");
                    if (first) { first = false; throw Object.assign(new Error("locked"), { code: 160005 }); }
                },
            });
            discord.setClient(dc.makeClient({ channels: [t], user: { id: BOT } }));
            await discord.editRecruitment("t1", "t1", { content: "Neu" });
            expect(calls).toEqual(["edit", "setArchived", "edit"]);
        });

        it("passes any other edit error on", async () => {
            const t = thread({ edit: async () => { throw Object.assign(new Error("boom"), { code: 50001 }); } });
            discord.setClient(dc.makeClient({ channels: [t], user: { id: BOT } }));
            await expect(discord.editRecruitment("t1", "t1", { content: "Neu" })).rejects.toThrow("boom");
            expect(t.setArchived).not.toHaveBeenCalled();
        });

        it("keeps the text and reports a rate-limited rename (429) as a notice", async () => {
            const t = thread({ setName: async () => { throw Object.assign(new Error("429"), { name: "RateLimitError" }); } });
            discord.setClient(dc.makeClient({ channels: [t], user: { id: BOT } }));
            const res = await discord.editRecruitment("t1", "t1", { content: "Neu", forumTitle: "Neu" });
            expect(res.notice).toBe("title_rate_limited");
            expect(t.messages.cache.get("t1").edit).toHaveBeenCalled();
        });

        it("rejects the 429 of this thread's rename at once through the REST manager, others as before", async () => {
            const previous = jest.fn(() => false);
            const rest = { options: { rejectOnRateLimit: previous } };
            let during = null;
            const t = thread({
                setName: async () => {
                    during = await rest.options.rejectOnRateLimit({ url: "https://discord.com/api/v10/channels/t1", route: "/channels/:id" });
                },
            });
            discord.setClient(dc.makeClient({ channels: [t], user: { id: BOT }, rest }));
            await discord.editRecruitment("t1", "t1", { content: "Neu", forumTitle: "Neu" });
            expect(during).toBe(true);
            expect(await rest.options.rejectOnRateLimit({ url: "https://discord.com/api/v10/channels/t1", route: "/channels/:id" })).toBe(false);
            expect(previous).toHaveBeenCalledTimes(1);
        });

        it("does not hang on a rename Discord never answers", async () => {
            jest.useFakeTimers();
            const t = thread({ setName: () => new Promise(() => {}) });
            discord.setClient(dc.makeClient({ channels: [t], user: { id: BOT } }));
            const pending = discord.editRecruitment("t1", "t1", { content: "Neu", forumTitle: "Neu" });
            await jest.advanceTimersByTimeAsync(10000);
            await expect(pending).resolves.toMatchObject({ notice: "title_rate_limited" });
        });

        it("reports another rename failure as title_failed", async () => {
            const t = thread({ setName: async () => { throw new Error("Missing Permissions"); } });
            discord.setClient(dc.makeClient({ channels: [t], user: { id: BOT } }));
            const res = await discord.editRecruitment("t1", "t1", { content: "Neu", forumTitle: "Neu" });
            expect(res.notice).toBe("title_failed");
        });

        it("cuts the title by characters, never inside an emoji", async () => {
            const t = thread();
            discord.setClient(dc.makeClient({ channels: [t], user: { id: BOT } }));
            await discord.editRecruitment("t1", "t1", { content: "Neu", forumTitle: `${"x".repeat(99)}\u{1F600}yz` });
            const name = t.setName.mock.calls[0][0];
            expect(Array.from(name)).toHaveLength(100);
            expect(name.endsWith("\u{1F600}")).toBe(true);
        });
    });

    it("lists forums (with both send rights) next to text channels, marked as forum", () => {
        const guild = dc.makeGuild({
            id: "g1",
            channels: [
                dc.makeChannel({ id: "c1", name: "allgemein", rawPosition: 2, permissionsFor: perms([SendMessages]) }),
                dc.makeChannel({ id: "f1", name: "recruitment", type: ChannelType.GuildForum, rawPosition: 1, permissionsFor: perms([SendMessages, SendMessagesInThreads]) }),
                dc.makeChannel({ id: "f2", name: "nur-lesen", type: ChannelType.GuildForum, rawPosition: 3, permissionsFor: perms([SendMessages]) }),
            ],
        });
        discord.setClient(dc.makeClient({ guilds: [guild], user: { id: BOT } }));
        expect(discord.listRecruitmentTargets("g1")).toEqual([
            { id: "f1", name: "recruitment", category: "", parentId: "", kind: "forum" },
            { id: "c1", name: "allgemein", category: "", parentId: "", kind: "text" },
        ]);
    });

    it("lists the invite channels with whether the bot may create an invite there", () => {
        const guild = dc.makeGuild({
            id: "g1",
            channels: [
                dc.makeChannel({ id: "c1", name: "willkommen", permissionsFor: perms([CreateInstantInvite, ViewChannel]) }),
                dc.makeChannel({ id: "c2", name: "zu", permissionsFor: perms([ViewChannel]) }),
            ],
        });
        discord.setClient(dc.makeClient({ guilds: [guild], user: { id: BOT } }));
        expect(discord.listInviteChannels("g1").map((c) => [c.id, c.canInvite])).toEqual([["c1", true], ["c2", false]]);
    });

    it("creates a permanent invite, or says the right is missing", async () => {
        const createInvite = jest.fn(async () => ({ code: "abc", url: "https://discord.gg/abc" }));
        const ok = dc.makeChannel({ id: "c1", guild: { members: { me: { id: BOT } } }, permissionsFor: perms([CreateInstantInvite]), createInvite });
        const no = dc.makeChannel({ id: "c2", guild: { members: { me: { id: BOT } } }, permissionsFor: perms([]), createInvite });
        discord.setClient(dc.makeClient({ channels: [ok, no], user: { id: BOT } }));
        await expect(discord.createRecruitmentInvite("c1", "Test")).resolves.toEqual({ code: "abc", url: "https://discord.gg/abc", reused: false });
        expect(createInvite).toHaveBeenCalledWith({ maxAge: 0, maxUses: 0, unique: true, reason: "Test" });
        createInvite.mockClear();
        await expect(discord.createRecruitmentInvite("c2")).rejects.toMatchObject({ code: "invite_permission" });
        expect(createInvite).not.toHaveBeenCalled();
    });

    it("reuses the bot's own permanent invite, unless a fresh one is asked for", async () => {
        const createInvite = jest.fn(async () => ({ code: "neu", url: "https://discord.gg/neu" }));
        const invites = new Map([
            ["tmp", { code: "tmp", maxAge: 86400, maxUses: 0, inviterId: BOT }],
            ["fremd", { code: "fremd", maxAge: 0, maxUses: 0, inviterId: "someone" }],
            ["alt", { code: "alt", url: "https://discord.gg/alt", maxAge: 0, maxUses: 0, temporary: false, inviter: { id: BOT } }],
        ]);
        const ch = dc.makeChannel({
            id: "c1", guild: { members: { me: { id: BOT } } }, permissionsFor: perms([CreateInstantInvite]),
            createInvite, fetchInvites: jest.fn(async () => invites),
        });
        discord.setClient(dc.makeClient({ channels: [ch], user: { id: BOT } }));
        await expect(discord.createRecruitmentInvite("c1")).resolves.toEqual({ code: "alt", url: "https://discord.gg/alt", reused: true });
        expect(createInvite).not.toHaveBeenCalled();
        await expect(discord.createRecruitmentInvite("c1", "Test", { fresh: true })).resolves.toEqual({ code: "neu", url: "https://discord.gg/neu", reused: false });
        expect(createInvite).toHaveBeenCalledTimes(1);
    });

    it("creates a new invite when the invites cannot be listed", async () => {
        const createInvite = jest.fn(async () => ({ code: "neu" }));
        const ch = dc.makeChannel({
            id: "c1", guild: { members: { me: { id: BOT } } }, permissionsFor: perms([CreateInstantInvite]),
            createInvite, fetchInvites: jest.fn(async () => { throw new Error("Missing Permissions"); }),
        });
        discord.setClient(dc.makeClient({ channels: [ch], user: { id: BOT } }));
        await expect(discord.createRecruitmentInvite("c1")).resolves.toEqual({ code: "neu", url: "https://discord.gg/neu", reused: false });
    });

    it("lists only invite channels @everyone may see", () => {
        // @everyone of g1 has the id "g1"; the bot may invite everywhere
        const view = (everyoneSees) => (who) => ({
            has: (flag) => (who.id === "g1" ? everyoneSees && flag === ViewChannel : true),
        });
        const guild = dc.makeGuild({
            id: "g1",
            channels: [
                dc.makeChannel({ id: "c1", name: "willkommen", permissionsFor: view(true) }),
                dc.makeChannel({ id: "c2", name: "orga", permissionsFor: view(false) }),
            ],
        });
        discord.setClient(dc.makeClient({ guilds: [guild], user: { id: BOT } }));
        expect(discord.listInviteChannels("g1").map((c) => c.id)).toEqual(["c1"]);
    });
});

describe("services/discord/discord recruitment mark and the forum scan", () => {
    const { ChannelType, PermissionsBitField } = require("discord.js");
    const { ViewChannel } = PermissionsBitField.Flags;
    const canView = () => ({ has: (flag) => flag === ViewChannel });

    const linkCard = (over = {}) => ({
        author: { id: BOT },
        content: "",
        embeds: [],
        components: [{
            id: 7291, type: 17,
            components: [{ type: 10, content: "Gilde X sucht" }, { type: 1, components: [{ type: 2, style: 5, url: "https://discord.gg/abc", label: "Beitreten" }] }],
        }],
        ...over,
    });

    // what discord.js sends is the builder's toJSON(), never a property set on the builder object
    const sent = (payload) => ({ author: { id: BOT }, content: "", embeds: [], components: payload.components.map((c) => (typeof c.toJSON === "function" ? c.toJSON() : c)) });

    it("marks both kinds of recruitment message with the hidden id in the JSON that is sent", () => {
        expect(sent(discord.buildRecruitmentMessage({ content: "Hi" })).components[0].id).toBe(7291);
        expect(sent(discord.buildRecruitmentMessage({ content: "Hi", buttonKind: "link", linkUrl: "https://discord.gg/abc" })).components[0].id).toBe(7291);
    });

    it("finds a link post it built itself once it comes back from Discord", () => {
        const msg = sent(discord.buildRecruitmentMessage({ content: "Gilde X sucht", buttonKind: "link", linkUrl: "https://discord.gg/abc", buttonLabel: "Beitreten" }));
        expect(discord.isRecruitmentMessage(msg)).toBe(true);
        expect(discord.extractTemplate(msg)).toMatchObject({ buttonKind: "link", linkUrl: "https://discord.gg/abc", buttonLabel: "Beitreten" });
    });

    it("counts a link post only with the mark, and reads link and label off it", () => {
        const unmarked = linkCard();
        unmarked.components[0] = { ...unmarked.components[0], id: undefined };
        expect(discord.isRecruitmentMessage(unmarked)).toBe(false);
        expect(discord.isRecruitmentMessage(linkCard())).toBe(true);
        expect(discord.isRecruitmentMessage(linkCard({ author: { id: "someone" } }))).toBe(false);
        expect(discord.extractTemplate(linkCard())).toEqual({
            content: "Gilde X sucht", title: "", body: "", buttonLabel: "Beitreten", versionId: "", buttonKind: "link", linkUrl: "https://discord.gg/abc",
        });
        // the mark in discord.js shape (component.data)
        const wrapped = linkCard();
        wrapped.components[0] = { data: { id: 7291, type: 17 }, components: wrapped.components[0].components };
        expect(discord.isRecruitmentMessage(wrapped)).toBe(true);
    });

    function forumGuild({ active = [], archived = [] } = {}) {
        const forum = dc.makeChannel({
            id: "f1", name: "partner", type: ChannelType.GuildForum, permissionsFor: canView,
            threads: { fetchArchived: jest.fn(async () => ({ threads: new Map(archived.map((t) => [t.id, t])) })) },
        });
        const guild = dc.makeGuild({ id: "g1", channels: [forum] });
        guild.channels.fetchActiveThreads = jest.fn(async () => ({ threads: new Map(active.map((t) => [t.id, t])) }));
        discord.setClient(dc.makeClient({ guilds: [guild], user: { id: BOT } }));
        return { guild, forum };
    }

    const post = (id, over = {}) => ({
        id, name: `Titel ${id}`, parentId: "f1", ownerId: BOT, createdTimestamp: Number(id.replace(/\D/g, "")) || 0,
        fetchStarterMessage: jest.fn(async () => ({ ...linkCard(), id, url: `https://discord.com/channels/g1/${id}/${id}` })),
        ...over,
    });

    it("finds the bot's forum posts, active and archived, with the forum fields", async () => {
        const { forum } = forumGuild({ active: [post("t1")], archived: [post("t2"), post("t1")] });
        const found = await discord.scanRecruitment("g1", { archivedLimit: 20 });
        expect(forum.threads.fetchArchived).toHaveBeenCalledWith({ limit: 20 });
        expect(found).toEqual([
            expect.objectContaining({ channelId: "t2", messageId: "t2", parentChannelId: "f1", forumTitle: "Titel t2", channelName: "partner", buttonKind: "link", linkUrl: "https://discord.gg/abc", buttonLabel: "Beitreten" }),
            expect.objectContaining({ channelId: "t1", parentChannelId: "f1", forumTitle: "Titel t1" }),
        ]);
    });

    it("skips foreign threads and unmarked posts, and fetches at most maxThreads starter messages", async () => {
        const foreign = post("t9", { ownerId: "someone" });
        const plain = post("t8", { fetchStarterMessage: jest.fn(async () => ({ ...linkCard(), id: "t8", components: [] })) });
        const old = post("t1");
        forumGuild({ active: [foreign, plain, old] });
        const found = await discord.scanRecruitment("g1", { maxThreads: 1 });
        expect(foreign.fetchStarterMessage).not.toHaveBeenCalled();
        expect(plain.fetchStarterMessage).toHaveBeenCalled();
        expect(old.fetchStarterMessage).not.toHaveBeenCalled();
        expect(found).toEqual([]);
    });

    it("keeps scanning when Discord refuses the thread lists", async () => {
        const { guild, forum } = forumGuild();
        guild.channels.fetchActiveThreads.mockRejectedValue(new Error("Missing Access"));
        forum.threads.fetchArchived.mockRejectedValue(new Error("Missing Access"));
        await expect(discord.scanRecruitment("g1")).resolves.toEqual([]);
    });
});
