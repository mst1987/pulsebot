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
        expect(discord.extractTemplate(msg("apply:classic"))).toEqual({ content: "Wir suchen!", title: "", body: "", buttonLabel: "Bewerben", versionId: "classic" });
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
        expect(discord.extractTemplate(card("apply:classic"))).toEqual({ content: "Wir suchen!", title: "", body: "", buttonLabel: "Bewerben", versionId: "classic" });
    });
});

describe("services/discord/discord recruitment as forum post with a link button", () => {
    const { ChannelType } = require("discord.js");
    const perms = (allowed) => () => ({ has: (flag) => allowed.includes(flag) });
    const { SendMessages, SendMessagesInThreads, CreateInstantInvite } = require("discord.js").PermissionsBitField.Flags;

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

    it("wakes up an archived forum post and renames it when the title changed", async () => {
        const message = { author: { id: BOT }, url: "u", edit: jest.fn(async () => {}) };
        const thread = dc.makeChannel({
            id: "t1", name: "Alt", type: ChannelType.PublicThread, messages: [{ id: "t1", ...message }],
            isThread: () => true, archived: true, setArchived: jest.fn(async () => {}), setName: jest.fn(async () => {}),
        });
        discord.setClient(dc.makeClient({ channels: [thread], user: { id: BOT } }));
        await discord.editRecruitment("t1", "t1", { content: "Neu", forumTitle: "Neu" });
        expect(thread.setArchived).toHaveBeenCalledWith(false, expect.any(String));
        expect(thread.setName).toHaveBeenCalledWith("Neu", expect.any(String));
        thread.setName.mockClear();
        thread.archived = false;
        thread.name = "Neu";
        await discord.editRecruitment("t1", "t1", { content: "Neu", forumTitle: "Neu" });
        expect(thread.setName).not.toHaveBeenCalled();
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
                dc.makeChannel({ id: "c1", name: "willkommen", permissionsFor: perms([CreateInstantInvite]) }),
                dc.makeChannel({ id: "c2", name: "zu", permissionsFor: perms([]) }),
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
        await expect(discord.createRecruitmentInvite("c1", "Test")).resolves.toEqual({ code: "abc", url: "https://discord.gg/abc" });
        expect(createInvite).toHaveBeenCalledWith({ maxAge: 0, maxUses: 0, unique: true, reason: "Test" });
        createInvite.mockClear();
        await expect(discord.createRecruitmentInvite("c2")).rejects.toMatchObject({ code: "invite_permission" });
        expect(createInvite).not.toHaveBeenCalled();
    });
});
