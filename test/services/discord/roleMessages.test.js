// The role messages (src/services/discord/roleMessages.js): checks, posting, editing,
// deleting, the editor's options, the button (toggle) and the reactions (give/take,
// partials of messages from before a restart). Discord is faked; the store is a temp file.
const { ComponentType, MessageFlags, PermissionsBitField } = require("discord.js");

const mockLog = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
jest.mock("../../../src/logger", () => ({ ...mockLog, child: () => mockLog }));
let mockConfig = {};
jest.mock("../../../src/stores/configStore", () => ({ getConfig: () => mockConfig }));
let mockLang = "de";
jest.mock("../../../src/services/discord/botLanguage", () => ({ langOfInteraction: () => mockLang }));
jest.mock("../../../src/services/discord/guildRoles", () => ({
    eventGuildId: () => "900000000000000001",
    talkGuildId: () => "900000000000000002",
}));
const mockDiscord = {
    getClient: jest.fn(() => ({ user: { id: "999999999999999999" } })),
    getGuild: jest.fn(),
    listTextChannels: jest.fn(() => [{ id: "100000000000000001", name: "rollen", category: "Info", parentId: "" }]),
    listEmojis: jest.fn(() => [{ id: "700000000000000007", name: "forever", animated: false, code: "<:forever:700000000000000007>", url: "https://cdn/e.png" }]),
    listRoles: jest.fn(() => []),
    postPayload: jest.fn(),
    editPayload: jest.fn(),
    deleteMessage: jest.fn(async () => true),
    fetchTextChannel: jest.fn(),
};
jest.mock("../../../src/services/discord/discord", () => mockDiscord);

const rosterStore = require("../../../src/stores/rosterStore");
const store = require("../../../src/stores/roleMessageStore");
const svc = require("../../../src/services/discord/roleMessages");
const { tempStoreFile } = require("../../helpers/tempStore");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { cardText, cardButtons } = require("../../helpers/cardText");

const EVENT_GUILD = "900000000000000001";
const CHANNEL = "100000000000000001";
const ROLE = "200000000000000002";
const ROLE2 = "200000000000000003";
const ADMIN_ROLE = "200000000000000004";
const MANAGE = PermissionsBitField.Flags.ManageRoles;

/** A fake server: roles, the bot (Manage Roles, highest position 50) and members. */
function makeGuild({ manage = true } = {}) {
    const roles = new Map([
        [ROLE, { id: ROLE, name: "WoW Forever", position: 1, managed: false, permissions: { bitfield: 0n } }],
        [ROLE2, { id: ROLE2, name: "TBC", position: 2, managed: false, permissions: { bitfield: 0n } }],
        [ADMIN_ROLE, { id: ADMIN_ROLE, name: "Mod", position: 3, managed: false, permissions: { bitfield: PermissionsBitField.Flags.KickMembers } }],
    ]);
    const members = new Map();
    const guild = {
        id: EVENT_GUILD,
        roles: { cache: roles, everyone: { permissions: { bitfield: 0n } }, fetch: jest.fn(async (id) => roles.get(id) || null) },
        channels: { cache: new Map() },
        members: {
            me: { permissions: { has: (f) => (f === MANAGE ? manage : true) }, roles: { highest: { position: 50 } } },
            fetch: jest.fn(async (id) => {
                if (!members.has(id)) throw new Error("Unknown Member");
                return members.get(id);
            }),
        },
    };
    guild.addMember = (id, has = []) => {
        const set = new Set(has);
        const member = {
            id,
            roles: {
                cache: set,
                add: jest.fn(async (r) => set.add(r)),
                remove: jest.fn(async (r) => set.delete(r)),
            },
        };
        members.set(id, member);
        return member;
    };
    return guild;
}

/** A posted Discord message with its reactions. */
function makeMessage(id, reactions = []) {
    const cache = new Map(reactions.map((r) => [r.emoji.id || r.emoji.name, { users: { remove: jest.fn(async () => {}) }, ...r }]));
    return { id, reactions: { cache }, react: jest.fn(async () => {}) };
}

const INPUT = {
    guildSide: "event",
    channelId: CHANNEL,
    title: "WoW Forever Role",
    body: "Reagiere auf diese Nachricht um über WoW Forever Infos gepingt zu werden",
    imageUrl: "https://cdn.example/forever.png",
    roles: [{ roleId: ROLE, emoji: "✅", label: "WoW Forever Role" }],
};

let guild;
let posted;
beforeEach(() => {
    jest.clearAllMocks();
    store.useFile(tempStoreFile("role-messages.json"));
    jest.spyOn(rosterStore, "listRosters").mockReturnValue([]);
    mockConfig = {};
    mockLang = "de";
    guild = makeGuild();
    mockDiscord.getGuild.mockImplementation((id) => (id === EVENT_GUILD ? guild : null));
    posted = makeMessage("300000000000000003");
    mockDiscord.postPayload.mockImplementation(async (channelId) => ({ guildId: EVENT_GUILD, channelId, messageId: posted.id, url: `https://discord.com/channels/${EVENT_GUILD}/${channelId}/${posted.id}` }));
    mockDiscord.fetchTextChannel.mockImplementation(async () => ({ messages: { fetch: async () => posted } }));
});
afterAll(() => store.useFile(null));

const codeOf = async (promise) => promise.then(() => "ok", (e) => e.code);

describe("validate", () => {
    it("takes a complete input and fills an empty label with the role's name", async () => {
        const { guildId, entry } = await svc.validate({ ...INPUT, roles: [{ roleId: ROLE, emoji: "<:forever:700000000000000007>", label: "" }] });
        expect(guildId).toBe(EVENT_GUILD);
        expect(entry.roles).toEqual([{ roleId: ROLE, emoji: "<:forever:700000000000000007>", label: "WoW Forever" }]);
    });

    it("refuses a role with rights, with its code and reason (Discord permissions and bot rights)", async () => {
        const err = await svc.validate({ ...INPUT, roles: [{ roleId: ADMIN_ROLE, emoji: "✅" }] }).catch((e) => e);
        expect(err).toMatchObject({ code: "privileged_role", status: 400, details: { roleId: ADMIN_ROLE, reason: "the role carries Discord permissions beyond @everyone" } });
        mockConfig = { orgaRoleIds: [ROLE] };
        const orga = await svc.validate(INPUT).catch((e) => e);
        expect(orga.details).toEqual({ roleId: ROLE, reason: "the role is an orga role" });
    });

    it("refuses a role the bot cannot hand out (no Manage Roles), with a German hint", async () => {
        guild = makeGuild({ manage: false });
        const err = await svc.validate(INPUT).catch((e) => e);
        expect(err).toMatchObject({ code: "role_unusable", details: { reason: "missing Manage Roles" } });
        expect(err.message).toContain("Rollen verwalten");
    });

    it("keeps Discord's limits: 25 buttons, 20 reactions", async () => {
        const many = (n, emoji) => Array.from({ length: n }, (_, i) => ({ roleId: String(210000000000000000 + i), emoji: emoji ? emoji(i) : "" }));
        expect(await codeOf(svc.validate({ ...INPUT, roles: many(26) }))).toBe("too_many_roles");
        const flags = ["🇦🇹", "🇧🇪", "🇨🇭", "🇩🇪", "🇪🇸", "🇫🇷", "🇬🇧", "🇮🇹", "🇳🇱", "🇵🇱", "🇸🇪", "🇳🇴", "🇩🇰", "🇫🇮", "🇮🇪", "🇵🇹", "🇨🇿", "🇭🇺", "🇬🇷", "🇺🇸", "🇨🇦"];
        expect(await codeOf(svc.validate({ ...INPUT, roles: many(21, (i) => flags[i]) }))).toBe("too_many_reactions");
        expect(svc.LIMITS).toMatchObject({ roles: 25, reactions: 20 });
    });

    it("names what is wrong: channel, title, roles, emojis, picture, server", async () => {
        expect(await codeOf(svc.validate({ ...INPUT, channelId: "100000000000000099" }))).toBe("unknown_channel");
        expect(await codeOf(svc.validate({ ...INPUT, title: " " }))).toBe("missing_title");
        expect(await codeOf(svc.validate({ ...INPUT, roles: [] }))).toBe("no_roles");
        expect(await codeOf(svc.validate({ ...INPUT, roles: [{ roleId: "200000000000000099" }] }))).toBe("unknown_role");
        expect(await codeOf(svc.validate({ ...INPUT, roles: [{ roleId: EVENT_GUILD }] }))).toBe("unknown_role");
        expect(await codeOf(svc.validate({ ...INPUT, roles: [{ roleId: ROLE }, { roleId: ROLE }] }))).toBe("duplicate_role");
        expect(await codeOf(svc.validate({ ...INPUT, roles: [{ roleId: ROLE, emoji: "✅" }, { roleId: ROLE2, emoji: "✅️" }] }))).toBe("duplicate_emoji");
        expect(await codeOf(svc.validate({ ...INPUT, roles: [{ roleId: ROLE, emoji: "ab" }] }))).toBe("bad_emoji");
        expect(await codeOf(svc.validate({ ...INPUT, roles: [{ roleId: ROLE, emoji: "<:other:700000000000000099>" }] }))).toBe("unknown_emoji");
        expect(await codeOf(svc.validate({ ...INPUT, imageUrl: "http://x/y.png" }))).toBe("bad_image");
        expect(await codeOf(svc.validate({ ...INPUT, guildSide: "nope" }))).toBe("bad_side");
        expect(await codeOf(svc.validate({ ...INPUT, guildSide: "talk" }))).toBe("bot_offline");
    });

    it("allows a role without emoji (a button only)", async () => {
        const { entry } = await svc.validate({ ...INPUT, roles: [{ roleId: ROLE, emoji: "" }] });
        expect(entry.roles[0]).toMatchObject({ roleId: ROLE, emoji: "" });
    });
});

describe("rolePayload", () => {
    it("is a card with the title, the text, the big picture and one button per role", () => {
        const p = svc.rolePayload({ id: "abc123abc123", color: null, ...INPUT });
        expect(cardText(p)).toContain("WoW Forever Role");
        const comps = p.components[0].components;
        expect(comps.some((c) => c.type === ComponentType.MediaGallery)).toBe(true);
        const [button] = cardButtons(p);
        expect(button).toMatchObject({ custom_id: `rolemsg:abc123abc123:${ROLE}`, label: "WoW Forever Role", emoji: { name: "✅" } });
        expect(p.allowedMentions).toEqual({ parse: [] });
    });
});

describe("create, update, delete", () => {
    it("posts, stores the message id and sets the reactions", async () => {
        const res = await svc.createRoleMessage(INPUT, { userId: "u1" });
        expect(res.entry).toMatchObject({ messageId: posted.id, createdBy: "u1", title: "WoW Forever Role" });
        expect(res.warnings).toEqual([]);
        expect(posted.react).toHaveBeenCalledWith("✅");
        expect(store.findByMessageId(posted.id).id).toBe(res.entry.id);
    });

    it("keeps nothing when posting fails", async () => {
        mockDiscord.postPayload.mockRejectedValueOnce(new Error("Missing Access"));
        expect(await codeOf(svc.createRoleMessage(INPUT))).toBe("post_failed");
        expect(store.listMessages()).toEqual([]);
    });

    it("saves anyway and warns when a reaction fails", async () => {
        posted.react.mockRejectedValueOnce(new Error("Missing Permissions"));
        const res = await svc.createRoleMessage(INPUT);
        expect(res.warnings[0]).toContain("Reaktionen hinzufügen");
        expect(store.listMessages()).toHaveLength(1);
    });

    it("edits in place and syncs the reactions: adds the new, takes back its own old ones", async () => {
        const { entry } = await svc.createRoleMessage(INPUT);
        posted = makeMessage(posted.id, [{ emoji: { name: "✅" }, me: true }]);
        mockDiscord.editPayload.mockResolvedValue({ url: "u" });
        const res = await svc.updateRoleMessage(entry.id, { ...INPUT, roles: [{ roleId: ROLE2, emoji: "🔥", label: "TBC" }] });
        expect(res.reposted).toBe(false);
        expect(mockDiscord.editPayload).toHaveBeenCalledWith(CHANNEL, posted.id, expect.any(Object));
        expect(posted.reactions.cache.get("✅").users.remove).toHaveBeenCalledWith("999999999999999999");
        expect(posted.react).toHaveBeenCalledWith("🔥");
        expect(store.getMessage(entry.id).roles).toEqual([{ roleId: ROLE2, emoji: "🔥", label: "TBC" }]);
    });

    it("posts anew in another channel and deletes the old message", async () => {
        const { entry } = await svc.createRoleMessage(INPUT);
        mockDiscord.listTextChannels.mockReturnValue([{ id: CHANNEL }, { id: "100000000000000002" }]);
        const old = posted.id;
        posted = makeMessage("300000000000000004");
        const res = await svc.updateRoleMessage(entry.id, { ...INPUT, channelId: "100000000000000002" });
        expect(res.reposted).toBe(true);
        expect(res.entry).toMatchObject({ channelId: "100000000000000002", messageId: "300000000000000004" });
        expect(mockDiscord.deleteMessage).toHaveBeenCalledWith(CHANNEL, old);
        expect(mockDiscord.editPayload).not.toHaveBeenCalled();
    });

    it("posts anew in the same channel when the old message is gone", async () => {
        const { entry } = await svc.createRoleMessage(INPUT);
        mockDiscord.editPayload.mockRejectedValue(Object.assign(new Error("Unknown Message"), { code: 10008 }));
        posted = makeMessage("300000000000000005");
        const res = await svc.updateRoleMessage(entry.id, INPUT);
        expect(res).toMatchObject({ reposted: true, entry: { messageId: "300000000000000005" } });
    });

    it("answers 404 for an unknown entry", async () => {
        const err = await svc.updateRoleMessage("nope", INPUT).catch((e) => e);
        expect(err).toMatchObject({ code: "not_found", status: 404 });
        expect(await codeOf(svc.deleteRoleMessage("nope"))).toBe("not_found");
    });

    it("deletes the entry even when the message is gone already", async () => {
        const { entry } = await svc.createRoleMessage(INPUT);
        mockDiscord.deleteMessage.mockResolvedValueOnce(false);
        expect(await svc.deleteRoleMessage(entry.id)).toEqual({ id: entry.id, messageDeleted: false });
        expect(store.listMessages()).toEqual([]);
    });
});

describe("roleMessageOptions", () => {
    it("lists roles with why they are privileged and whether the bot can hand them out, channels, emojis, Manage Roles", () => {
        mockDiscord.listRoles.mockReturnValue([{ id: ROLE, name: "WoW Forever", color: 0, managed: false }, { id: ADMIN_ROLE, name: "Mod", color: 0, managed: false }]);
        const o = svc.roleMessageOptions("event");
        expect(o).toMatchObject({ guildSide: "event", guildId: EVENT_GUILD, online: true, manageRoles: true });
        expect(o.roles[0]).toMatchObject({ id: ROLE, privileged: "", editable: true });
        expect(o.roles[1].privileged).toBe("the role carries Discord permissions beyond @everyone");
        expect(o.channels[0]).toMatchObject({ id: CHANNEL, canReact: true });
        expect(o.emojis).toHaveLength(1);
    });

    it("says offline when the bot is not on the server", () => {
        expect(svc.roleMessageOptions("talk")).toMatchObject({ guildSide: "talk", online: false, roles: [], channels: [], emojis: [] });
    });
});

describe("the role button", () => {
    async function click(entry, roleId, extra = {}) {
        const interaction = mockInteraction({ userId: "500000000000000005", customId: svc.buttonId(entry.id, roleId), guild, message: { id: entry.messageId }, ...extra });
        await svc.handleRoleButton(interaction);
        return interaction;
    }

    it("defers first, then toggles the role and answers in the clicker's language, pinging nobody", async () => {
        const { entry } = await svc.createRoleMessage(INPUT);
        const member = guild.addMember("500000000000000005");
        const first = await click(entry, ROLE);
        expect(first.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        expect(first.deferReply.mock.invocationCallOrder[0]).toBeLessThan(member.roles.add.mock.invocationCallOrder[0]);
        expect(member.roles.cache.has(ROLE)).toBe(true);
        const reply = first.editReply.mock.calls[0][0];
        expect(cardText(reply)).toContain(`Du hast jetzt die Rolle <@&${ROLE}>.`);
        expect(reply.allowedMentions).toEqual({ parse: [] });

        mockLang = "en";
        const second = await click(entry, ROLE);
        expect(member.roles.cache.has(ROLE)).toBe(false);
        expect(cardText(second.editReply.mock.calls[0][0])).toContain(`The role <@&${ROLE}> was removed.`);
    });

    it("never touches a role that got rights later, and logs it", async () => {
        const { entry } = await svc.createRoleMessage(INPUT);
        const member = guild.addMember("500000000000000005", [ROLE]);
        mockConfig = { adminRoleIds: [ROLE] };
        const i = await click(entry, ROLE);
        expect(member.roles.remove).not.toHaveBeenCalled();
        expect(cardText(i.editReply.mock.calls[0][0])).toContain("Sag bitte der Orga Bescheid");
        expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("full-admin"));
    });

    it("answers a button of a deleted entry, a removed role or an old message as no longer in use", async () => {
        const { entry } = await svc.createRoleMessage(INPUT);
        expect(cardText((await click({ id: "gone00000000", messageId: entry.messageId }, ROLE)).editReply.mock.calls[0][0])).toContain("nicht mehr aktiv");
        expect(cardText((await click(entry, ROLE2)).editReply.mock.calls[0][0])).toContain("nicht mehr aktiv");
        expect(cardText((await click(entry, ROLE, { message: { id: "300000000000000099" } })).editReply.mock.calls[0][0])).toContain("nicht mehr aktiv");
    });

    it("logs a member it cannot find and a deleted role", async () => {
        const { entry } = await svc.createRoleMessage(INPUT);
        await click(entry, ROLE);
        expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("not found"));
        guild.roles.cache.delete(ROLE);
        await click(entry, ROLE);
        expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("missing"));
    });
});

describe("reactions", () => {
    const reactionOn = (messageId, emoji, extra = {}) => ({ emoji, message: { id: messageId, guild }, ...extra });

    it("gives the role on a reaction and takes it when the reaction goes", async () => {
        const { entry } = await svc.createRoleMessage(INPUT);
        const member = guild.addMember("500000000000000005");
        const user = { id: "500000000000000005", bot: false };
        expect(await svc.handleReaction(reactionOn(entry.messageId, { name: "✅" }), user, true)).toBe("given");
        expect(member.roles.cache.has(ROLE)).toBe(true);
        expect(await svc.handleReaction(reactionOn(entry.messageId, { name: "✅" }), user, true)).toBe("unchanged");
        expect(await svc.handleReaction(reactionOn(entry.messageId, { name: "✅" }), user, false)).toBe("taken");
        expect(member.roles.cache.has(ROLE)).toBe(false);
    });

    it("matches a server emoji by its id", async () => {
        const { entry } = await svc.createRoleMessage({ ...INPUT, roles: [{ roleId: ROLE, emoji: "<:forever:700000000000000007>" }] });
        guild.addMember("500000000000000005");
        expect(await svc.handleReaction(reactionOn(entry.messageId, { id: "700000000000000007", name: "forever" }), { id: "500000000000000005" }, true)).toBe("given");
    });

    it("fetches the partials of a message from before a restart", async () => {
        const { entry } = await svc.createRoleMessage(INPUT);
        guild.addMember("500000000000000005");
        const fullMessage = { id: entry.messageId, guild, partial: false };
        const reaction = {
            partial: true,
            message: { id: entry.messageId, partial: true },
            fetch: jest.fn(async () => ({ emoji: { name: "✅" }, message: { id: entry.messageId, partial: true, fetch: async () => fullMessage } })),
        };
        const user = { id: "500000000000000005", partial: true, fetch: jest.fn(async () => ({ id: "500000000000000005", bot: false })) };
        expect(await svc.handleReaction(reaction, user, true)).toBe("given");
        expect(reaction.fetch).toHaveBeenCalled();
        expect(user.fetch).toHaveBeenCalled();
    });

    it("ignores bots, other messages, other emojis and partials Discord cannot give", async () => {
        const { entry } = await svc.createRoleMessage(INPUT);
        expect(await svc.handleReaction(reactionOn(entry.messageId, { name: "✅" }), { id: "1", bot: true }, true)).toBe("ignored");
        expect(await svc.handleReaction(reactionOn("300000000000000099", { name: "✅" }), { id: "1" }, true)).toBe("ignored");
        expect(await svc.handleReaction(reactionOn(entry.messageId, { name: "🔥" }), { id: "1" }, true)).toBe("ignored");
        const gone = { partial: true, message: { id: entry.messageId }, fetch: jest.fn(async () => { throw new Error("Unknown Message"); }) };
        expect(await svc.handleReaction(gone, { id: "1" }, true)).toBe("ignored");
    });

    it("never touches a privileged role by reaction (either way) and logs it", async () => {
        const { entry } = await svc.createRoleMessage(INPUT);
        const member = guild.addMember("500000000000000005", [ROLE]);
        mockConfig = { categoryRoles: { c1: [ROLE] } };
        expect(await svc.handleReaction(reactionOn(entry.messageId, { name: "✅" }), { id: "500000000000000005" }, false)).toBe("failed");
        expect(member.roles.remove).not.toHaveBeenCalled();
        expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("raider role"));
    });
});

describe("ids and keys", () => {
    it("reads its customId and keys emojis without the variation selector", () => {
        expect(svc.parseButtonId("rolemsg:abc:123")).toEqual({ entryId: "abc", roleId: "123" });
        expect(svc.parseButtonId("other:abc:123")).toEqual({ entryId: "", roleId: "" });
        expect(svc.emojiKey("✅️")).toBe("✅");
        expect(svc.emojiKey("<a:xy:700000000000000007>")).toBe("700000000000000007");
        expect(svc.reactionKey({ id: null, name: "✅" })).toBe("✅");
    });
});
