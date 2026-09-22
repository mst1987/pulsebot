jest.mock("../../src/web/discord", () => ({
    getClient: jest.fn(),
    getGuild: jest.fn(),
    createChannel: jest.fn(async (guildId, opts) => ({ id: "plain", name: opts.name })),
}));

const { ChannelType } = require("discord.js");
const discord = require("../../src/web/discord");
const dc = require("../../src/web/discordChannels");

function makeChannel(fields = {}) {
    const channel = {
        id: "c1", name: "mi-kara", type: ChannelType.GuildText, parentId: "cat1", parent: { name: "Mittwoch" },
        topic: "", rateLimitPerUser: 0, guildId: "g1",
        guild: { id: "g1", roles: { everyone: { id: "g1" } }, members: { me: { id: "bot" } } },
        permissionOverwrites: { cache: new Map([["role-raider", {}], ["bot", {}]]), edit: jest.fn(async () => {}) },
        ...fields,
    };
    channel.edit = jest.fn(async (payload) => Object.assign(channel, payload.name ? { name: payload.name } : {}, payload.parent !== undefined ? { parentId: payload.parent || "" } : {}));
    channel.delete = jest.fn(async () => {});
    channel.clone = jest.fn(async (opts) => ({ id: "clone", name: opts.name }));
    return channel;
}

function withChannels(...channels) {
    const cache = new Map(channels.map((c) => [c.id, c]));
    discord.getClient.mockReturnValue({ channels: { cache, fetch: jest.fn(async (id) => cache.get(id) || null) } });
}

beforeEach(() => jest.clearAllMocks());

describe("web/discordChannels", () => {
    describe("pickChanges", () => {
        it("takes only the fields that are set, normalised", () => {
            expect(dc.pickChanges({ topic: "Flasks Pflicht" })).toEqual({ topic: "Flasks Pflicht" });
            expect(dc.pickChanges({ name: "Mi 24 SSC", parentId: undefined, rateLimitPerUser: null })).toEqual({ name: "mi-24-ssc" });
            expect(dc.pickChanges({ parentId: "", rateLimitPerUser: "30" })).toEqual({ parentId: "", rateLimitPerUser: 30 });
        });

        it("refuses what Discord would refuse", () => {
            expect(() => dc.pickChanges({ name: " !! " })).toThrow("Name ist leer");
            expect(() => dc.pickChanges({ rateLimitPerUser: 99999 })).toThrow("Slowmode");
            expect(() => dc.pickChanges({ topic: "x".repeat(1025) })).toThrow("Thema");
        });
    });

    describe("editChannel", () => {
        it("sends only what actually changes, and keeps permissions when moving", async () => {
            const channel = makeChannel({ topic: "alt" });
            withChannels(channel);
            const result = await dc.editChannel("c1", { name: "mi-kara", topic: "neu", parentId: "cat2" });
            expect(channel.edit).toHaveBeenCalledWith({ topic: "neu", parent: "cat2", lockPermissions: false });
            expect(result.changed).toEqual(["topic", "parent"]);
        });

        it("does not call Discord when nothing changes", async () => {
            const channel = makeChannel();
            withChannels(channel);
            await dc.editChannel("c1", { name: "mi-kara" });
            expect(channel.edit).not.toHaveBeenCalled();
        });

        it("fails for an unknown channel and without the bot", async () => {
            withChannels();
            await expect(dc.editChannel("nope", { topic: "x" })).rejects.toThrow("Kanal nicht gefunden");
            discord.getClient.mockReturnValue(null);
            await expect(dc.editChannel("c1", {})).rejects.toThrow("Bot nicht verbunden");
        });
    });

    describe("archiveChannel", () => {
        it("moves into the archive and takes writing away from everyone but the bot", async () => {
            const channel = makeChannel();
            withChannels(channel);
            const result = await dc.archiveChannel("c1", "arch");
            expect(channel.edit).toHaveBeenCalledWith({ parent: "arch", lockPermissions: false });
            const targets = channel.permissionOverwrites.edit.mock.calls.map((c) => c[0]);
            expect(targets.sort()).toEqual(["g1", "role-raider"]);
            expect(channel.permissionOverwrites.edit.mock.calls[0][1]).toMatchObject({ SendMessages: false });
            expect(result).toMatchObject({ fromParentId: "cat1", fromCategory: "Mittwoch", guildId: "g1" });
        });

        it("needs an archive category", async () => {
            await expect(dc.archiveChannel("c1", "")).rejects.toThrow("Keine Archiv-Kategorie");
        });
    });

    describe("deleteChannel", () => {
        it("refuses a channel outside the archive category", async () => {
            const channel = makeChannel({ parentId: "cat1" });
            withChannels(channel);
            await expect(dc.deleteChannel("c1", "arch")).rejects.toThrow("Nur Kanäle im Archiv");
            expect(channel.delete).not.toHaveBeenCalled();
            await expect(dc.deleteChannel("c1", "")).rejects.toThrow("Keine Archiv-Kategorie");
        });

        it("deletes a channel in the archive", async () => {
            const channel = makeChannel({ parentId: "arch" });
            withChannels(channel);
            await expect(dc.deleteChannel("c1", "arch")).resolves.toEqual({ id: "c1", name: "mi-kara" });
            expect(channel.delete).toHaveBeenCalled();
        });

        it("from the channel list (anywhere) deletes any channel, also without an archive — never a category", async () => {
            const channel = makeChannel({ parentId: "cat1" });
            withChannels(channel);
            await expect(dc.deleteChannel("c1", "", { anywhere: true })).resolves.toEqual({ id: "c1", name: "mi-kara" });
            expect(channel.delete).toHaveBeenCalledWith("EventHelper: in der Kanalübersicht gelöscht");
            const category = makeChannel({ id: "cat1", type: ChannelType.GuildCategory, parentId: "" });
            withChannels(category);
            // a category is no channel to fetchChannel(): refused before anything is deleted
            await expect(dc.deleteChannel("cat1", "arch", { anywhere: true })).rejects.toThrow("Kanal nicht gefunden");
            expect(category.delete).not.toHaveBeenCalled();
        });
    });

    describe("createCategory / createFromTemplate", () => {
        it("creates a category", async () => {
            const create = jest.fn(async (p) => ({ id: "newcat", name: p.name }));
            discord.getGuild.mockReturnValue({ channels: { create } });
            await expect(dc.createCategory("g1", " Archiv ")).resolves.toEqual({ id: "newcat", name: "Archiv" });
            expect(create).toHaveBeenCalledWith({ name: "Archiv", type: ChannelType.GuildCategory });
        });

        it("clones the template into the target category, or creates a plain channel", async () => {
            const template = makeChannel({ id: "tpl" });
            withChannels(template);
            await expect(dc.createFromTemplate("g1", { name: "mi-23-09-kara", parentId: "cat9", templateChannelId: "tpl" })).resolves.toEqual({ id: "clone", name: "mi-23-09-kara", copiedFrom: "tpl" });
            expect(template.clone).toHaveBeenCalledWith({ name: "mi-23-09-kara", parent: "cat9" });
            await dc.createFromTemplate("g1", { name: "x", parentId: "cat9" });
            expect(discord.createChannel).toHaveBeenCalledWith("g1", { name: "x", type: "text", parentId: "cat9" });
        });

        it("sorts the copy in right behind the previous date (#285)", async () => {
            const anchor = makeChannel({ id: "prev", parentId: "cat9", position: 2 });
            const template = makeChannel({ id: "prev-tpl", parentId: "cat9", position: 2 });
            const copy = { id: "clone", name: "mi-23-09-kara", parentId: "cat9", position: 5, setPosition: jest.fn(async () => {}) };
            template.clone = jest.fn(async () => copy);
            withChannels(anchor, template);
            const result = await dc.createFromTemplate("g1", { name: "mi-23-09-kara", parentId: "cat9", templateChannelId: "prev-tpl", afterChannelId: "prev" });
            expect(copy.setPosition).toHaveBeenCalledWith(3);
            expect(result).toEqual({ id: "clone", name: "mi-23-09-kara", copiedFrom: "prev-tpl", positioned: true });
        });
    });

    describe("positionTarget / placeChannel", () => {
        it("accounts for setPosition taking the channel out of the list first", () => {
            expect(dc.positionTarget({ anchor: 2, current: 5, after: true })).toBe(3);
            expect(dc.positionTarget({ anchor: 2, current: 0, after: true })).toBe(2);
            expect(dc.positionTarget({ anchor: 2, current: 5, after: false })).toBe(2);
            expect(dc.positionTarget({ anchor: 2, current: 0, after: false })).toBe(1);
        });

        it("moves only within the same category and never throws", async () => {
            const own = { id: "n", parentId: "cat1", position: 4, setPosition: jest.fn(async () => {}) };
            const before = makeChannel({ id: "b", parentId: "cat1", position: 1 });
            const elsewhere = makeChannel({ id: "e", parentId: "cat2", position: 0 });
            withChannels(before, elsewhere);
            await expect(dc.placeChannel(own, { beforeChannelId: "b" })).resolves.toBe(true);
            expect(own.setPosition).toHaveBeenCalledWith(1);
            await expect(dc.placeChannel(own, { afterChannelId: "e" })).resolves.toBe(false);
            await expect(dc.placeChannel(own, { afterChannelId: "unknown" })).resolves.toBe(false);
            await expect(dc.placeChannel(own, {})).resolves.toBe(false);
            own.setPosition.mockRejectedValue(new Error("Missing Permissions"));
            await expect(dc.placeChannel(own, { afterChannelId: "b" })).resolves.toBe(false);
        });
    });

    it("lists topic, slowmode and permission sync per channel", () => {
        discord.getGuild.mockReturnValue({
            channels: { cache: new Map([
                ["cat", { id: "cat", type: ChannelType.GuildCategory }],
                ["c1", { id: "c1", type: ChannelType.GuildText, topic: "Flasks", rateLimitPerUser: 5, permissionsLocked: true }],
            ]) },
        });
        expect(dc.listChannelDetails("g1")).toEqual({ c1: { topic: "Flasks", rateLimitPerUser: 5, permissionsLocked: true } });
    });

    it("turns Discord errors into short reasons", () => {
        expect(dc.discordErrorText({ code: 50013 })).toBe("fehlende Rechte");
        expect(dc.discordErrorText({ code: 10003 })).toBe("Kanal nicht gefunden");
        expect(dc.discordErrorText(new Error("kaputt"))).toBe("kaputt");
    });
});
