const { ChannelType } = require("discord.js");
const discord = require("../../src/web/discord.js");

// Build a fake channel as it appears in guild.channels.cache.
function chan(id, name, type, { parent = null, parentId = "", rawPosition = 0 } = {}) {
    return { id, name, type, parent, parentId, rawPosition };
}

// Build a fake guild with a channel cache and a jest-mocked create().
function makeGuild(channels) {
    return {
        members: { me: null },
        channels: {
            cache: new Map(channels.map((c) => [c.id, c])),
            create: jest.fn(async (payload) => ({ id: "new-chan", name: payload.name, __payload: payload })),
        },
    };
}

function setClientWithGuild(guild, channelsFetch) {
    const client = {
        guilds: { cache: new Map(guild ? [["g1", guild]] : []) },
        channels: { fetch: channelsFetch || jest.fn() },
        user: { id: "bot" },
    };
    discord.setClient(client);
    return client;
}

afterEach(() => {
    discord.setClient(null);
    jest.clearAllMocks();
});

describe("web/discord channel management", () => {
    describe("listCategories", () => {
        it("returns only category channels, ordered by position", () => {
            const guild = makeGuild([
                chan("t1", "text", ChannelType.GuildText, { rawPosition: 1 }),
                chan("c2", "Zweite", ChannelType.GuildCategory, { rawPosition: 2 }),
                chan("c1", "Erste", ChannelType.GuildCategory, { rawPosition: 1 }),
            ]);
            setClientWithGuild(guild);
            expect(discord.listCategories("g1")).toEqual([
                { id: "c1", name: "Erste" },
                { id: "c2", name: "Zweite" },
            ]);
        });

        it("returns [] when the guild is unknown or the bot is not connected", () => {
            discord.setClient(null);
            expect(discord.listCategories("g1")).toEqual([]);
            setClientWithGuild(null);
            expect(discord.listCategories("nope")).toEqual([]);
        });
    });

    describe("listAllChannels", () => {
        it("returns non-category channels with type label and parent category", () => {
            const category = chan("cat", "Raids", ChannelType.GuildCategory);
            const guild = makeGuild([
                category,
                chan("t1", "kara-signup", ChannelType.GuildText, { parent: category, parentId: "cat", rawPosition: 1 }),
                chan("v1", "voice", ChannelType.GuildVoice, { rawPosition: 2 }),
            ]);
            setClientWithGuild(guild);
            const result = discord.listAllChannels("g1");
            expect(result).toEqual([
                { id: "t1", name: "kara-signup", type: ChannelType.GuildText, typeLabel: "Text", category: "Raids", parentId: "cat" },
                { id: "v1", name: "voice", type: ChannelType.GuildVoice, typeLabel: "Voice", category: "", parentId: "" },
            ]);
        });
    });

    describe("createChannel", () => {
        it("creates a text channel with a parent category", async () => {
            const guild = makeGuild([]);
            setClientWithGuild(guild);
            const res = await discord.createChannel("g1", { name: "  neu ", type: "text", parentId: "cat" });
            expect(res).toEqual({ id: "new-chan", name: "neu" });
            expect(guild.channels.create).toHaveBeenCalledWith({ name: "neu", type: ChannelType.GuildText, parent: "cat" });
        });

        it("maps the voice type and omits the parent when none is given", async () => {
            const guild = makeGuild([]);
            setClientWithGuild(guild);
            await discord.createChannel("g1", { name: "sprich", type: "voice" });
            expect(guild.channels.create).toHaveBeenCalledWith({ name: "sprich", type: ChannelType.GuildVoice });
        });

        it("defaults an unknown type to text", async () => {
            const guild = makeGuild([]);
            setClientWithGuild(guild);
            await discord.createChannel("g1", { name: "x", type: "weird" });
            expect(guild.channels.create.mock.calls[0][0].type).toBe(ChannelType.GuildText);
        });

        it("throws on a blank name", async () => {
            const guild = makeGuild([]);
            setClientWithGuild(guild);
            await expect(discord.createChannel("g1", { name: "   " })).rejects.toThrow("Kanalname fehlt");
        });

        it("throws when the guild is not found", async () => {
            setClientWithGuild(null);
            await expect(discord.createChannel("nope", { name: "x" })).rejects.toThrow("Server nicht gefunden");
        });
    });

    describe("listEmojis", () => {
        function emoji(id, name, { animated = false, available = true, imageURL, url } = {}) {
            return { id, name, animated, available, imageURL, url };
        }
        function guildWithEmojis(emojis) {
            return { emojis: { cache: new Map(emojis.map((e) => [e.id, e])) } };
        }

        it("returns custom emojis sorted by name with Discord codes and preview URLs", () => {
            const guild = guildWithEmojis([
                emoji("2", "zug", { imageURL: () => "https://cdn/zug.png" }),
                emoji("1", "apfel", { imageURL: () => "https://cdn/apfel.png" }),
                emoji("3", "wave", { animated: true, imageURL: () => "https://cdn/wave.gif" }),
            ]);
            setClientWithGuild(guild);
            expect(discord.listEmojis("g1")).toEqual([
                { id: "1", name: "apfel", animated: false, code: "<:apfel:1>", url: "https://cdn/apfel.png" },
                { id: "3", name: "wave", animated: true, code: "<a:wave:3>", url: "https://cdn/wave.gif" },
                { id: "2", name: "zug", animated: false, code: "<:zug:2>", url: "https://cdn/zug.png" },
            ]);
        });

        it("skips unavailable emojis and falls back to .url when imageURL is missing", () => {
            const guild = guildWithEmojis([
                emoji("1", "gone", { available: false, imageURL: () => "https://cdn/gone.png" }),
                emoji("2", "keep", { url: "https://cdn/keep.png" }),
            ]);
            setClientWithGuild(guild);
            expect(discord.listEmojis("g1")).toEqual([
                { id: "2", name: "keep", animated: false, code: "<:keep:2>", url: "https://cdn/keep.png" },
            ]);
        });

        it("returns [] when the guild is unknown or the bot is not connected", () => {
            discord.setClient(null);
            expect(discord.listEmojis("g1")).toEqual([]);
            setClientWithGuild(null);
            expect(discord.listEmojis("nope")).toEqual([]);
        });
    });

    describe("duplicateChannel", () => {
        it("clones the source channel with a new name (same category)", async () => {
            const source = {
                id: "src", name: "kara-signup",
                clone: jest.fn(async (opts) => ({ id: "clone-1", name: (opts && opts.name) || "kara-signup" })),
            };
            const fetch = jest.fn(async () => source);
            setClientWithGuild(makeGuild([]), fetch);

            const res = await discord.duplicateChannel("src", "  kara-signup-2 ");
            expect(fetch).toHaveBeenCalledWith("src");
            expect(source.clone).toHaveBeenCalledWith({ name: "kara-signup-2" });
            expect(res).toEqual({ id: "clone-1", name: "kara-signup-2" });
        });

        it("falls back to the original's name when no new name is given", async () => {
            const source = {
                id: "src", name: "orig",
                clone: jest.fn(async (opts) => ({ id: "clone-1", name: (opts && opts.name) || "orig" })),
            };
            setClientWithGuild(makeGuild([]), jest.fn(async () => source));
            const res = await discord.duplicateChannel("src", "");
            expect(source.clone).toHaveBeenCalledWith({ name: "orig" });
            expect(res.name).toBe("orig");
        });

        it("throws when the source cannot be cloned", async () => {
            setClientWithGuild(makeGuild([]), jest.fn(async () => ({ id: "x", name: "y" })));
            await expect(discord.duplicateChannel("x", "z")).rejects.toThrow("nicht duplizierbar");
        });

        it("throws when the bot is not connected", async () => {
            discord.setClient(null);
            await expect(discord.duplicateChannel("x", "z")).rejects.toThrow("Bot nicht verbunden");
        });
    });
});
