const { ChannelType, ComponentType } = require("discord.js");
const discord = require("../../../src/services/discord/discord.js");
const dc = require("../../helpers/discordClient");
const { KIND_COLORS } = require("../../../src/utils/discord/card");
const { asEmbed, cardButtons, isCardPayload } = require("../../helpers/card");

/** The text lines of a card payload (utils/discord/card.js): one per text display, in order. */
const cardTexts = (payload) => payload.components[0].components.filter((c) => c.type === ComponentType.TextDisplay).map((c) => c.content);

// Build a fake channel as it appears in guild.channels.cache.
function chan(id, name, type, { parent = null, parentId = "", rawPosition = 0 } = {}) {
    return dc.makeChannel({ id, name, type, parent, parentId, rawPosition });
}

// Build a fake guild "g1" with a channel cache and a create() that echoes the name.
function makeGuild(channels) {
    const guild = dc.makeGuild({ id: "g1", channels, me: null });
    guild.channels.create = jest.fn(async (payload) => ({ id: "new-chan", name: payload.name, __payload: payload }));
    return guild;
}

/** A guild "g1" whose members.fetch is `fetch` (and whose cache holds `cached`). */
function guildWithMemberFetch(fetch, cached = []) {
    const guild = dc.makeGuild({ id: "g1", members: cached });
    guild.members.fetch = fetch;
    return guild;
}

// The client on guild "g1" (or none); `channelsFetch` replaces its channels.fetch.
function setClientWithGuild(guild, channelsFetch) {
    const client = dc.makeClient({ guilds: guild ? [["g1", guild]] : [] });
    if (channelsFetch) client.channels.fetch = channelsFetch;
    discord.setClient(client);
    return client;
}

// The client on an empty guild "g1" with exactly these channels.
function setClientWithChannels(...channels) {
    const client = dc.makeClient({ guilds: [makeGuild([])], channels });
    discord.setClient(client);
    return client;
}

afterEach(() => {
    discord.setClient(null);
    jest.clearAllMocks();
});

describe("services/discord/discord client access", () => {
    describe("isOnline", () => {
        it("is false without a client", () => {
            expect(discord.isOnline()).toBe(false);
        });

        it("asks the client whether it is logged in, when it can say so", () => {
            let ready = false;
            discord.setClient(dc.makeClient({ isReady: () => ready }));
            expect(discord.isOnline()).toBe(false);
            ready = true;
            expect(discord.isOnline()).toBe(true);
        });

        it("counts a client without isReady() as there", () => {
            discord.setClient(dc.makeClient({ isReady: undefined }));
            expect(discord.isOnline()).toBe(true);
        });
    });

    describe("fetchTextChannel", () => {
        const textChannel = dc.makeChannel({ id: "c1" });

        it("throws 'Bot nicht verbunden.' without a client", async () => {
            await expect(discord.fetchTextChannel("c1")).rejects.toMatchObject({ message: "Bot nicht verbunden.", code: "bot_offline" });
        });

        it("returns the text channel the client fetches, the id as a string", async () => {
            const channel = dc.makeChannel({ id: "12345" });
            const { fetch } = setClientWithChannels(channel).channels;
            await expect(discord.fetchTextChannel(12345)).resolves.toBe(channel);
            expect(fetch).toHaveBeenCalledWith("12345");
        });

        it("refuses a missing channel and one that holds no messages, with the caller's text", async () => {
            discord.setClient(dc.makeClient({
                missing: "null",
                channels: [
                    dc.makeChannel({ id: "v1", type: ChannelType.GuildVoice }),
                    dc.makeChannel({ id: "cat", type: ChannelType.GuildCategory }),
                ],
            }));
            await expect(discord.fetchTextChannel("x")).rejects.toMatchObject({ message: "Kanal nicht gefunden oder kein Textkanal.", code: "channel_not_found" });
            await expect(discord.fetchTextChannel("v1", "Übersichts-Kanal fehlt.")).rejects.toThrow("Übersichts-Kanal fehlt.");
            await expect(discord.fetchTextChannel("cat")).rejects.toMatchObject({ code: "channel_not_found" });
        });

        it("passes Discord's own errors through", async () => {
            const unknown = dc.discordError("channel");
            const client = dc.makeClient();
            client.channels.fetch.mockRejectedValue(unknown);
            discord.setClient(client);
            await expect(discord.fetchTextChannel("gone")).rejects.toBe(unknown);
        });

        it("textChannelOf works on any client handed in", async () => {
            await expect(discord.textChannelOf(null, "c1")).rejects.toThrow("Bot nicht verbunden.");
            await expect(discord.textChannelOf(dc.makeClient({ channels: [textChannel] }), "c1")).resolves.toBe(textChannel);
        });
    });
});

describe("services/discord/discord channel management", () => {
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
                { id: "t1", name: "kara-signup", type: ChannelType.GuildText, typeLabel: "Text", category: "Raids", parentId: "cat", isThread: false, botCanView: true, botCanSend: true },
                { id: "v1", name: "voice", type: ChannelType.GuildVoice, typeLabel: "Voice", category: "", parentId: "", isThread: false, botCanView: true, botCanSend: true },
            ]);
        });

        it("marks threads and keeps their parent channel (not a category) as parentId, #361", () => {
            const appChannel = chan("app", "bewerbungen", ChannelType.GuildText, { rawPosition: 1 });
            const guild = makeGuild([
                appChannel,
                chan("th1", "Bewerbung Fatigatus", ChannelType.PublicThread, { parent: appChannel, parentId: "app", rawPosition: 2 }),
                chan("th2", "geheimer Thread", ChannelType.PrivateThread, { parent: appChannel, parentId: "app", rawPosition: 3 }),
            ]);
            setClientWithGuild(guild);
            const result = discord.listAllChannels("g1");
            expect(result).toEqual([
                { id: "app", name: "bewerbungen", type: ChannelType.GuildText, typeLabel: "Text", category: "", parentId: "", isThread: false, botCanView: true, botCanSend: true },
                { id: "th1", name: "Bewerbung Fatigatus", type: ChannelType.PublicThread, typeLabel: "Thread", category: "bewerbungen", parentId: "app", isThread: true, botCanView: true, botCanSend: true },
                { id: "th2", name: "geheimer Thread", type: ChannelType.PrivateThread, typeLabel: "Privater Thread", category: "bewerbungen", parentId: "app", isThread: true, botCanView: true, botCanSend: true },
            ]);
        });

        it("reports what the bot may see and post per channel", () => {
            const { PermissionsBitField } = require("discord.js");
            const F = PermissionsBitField.Flags;
            const withPerms = (id, flags) => ({
                ...chan(id, id, ChannelType.GuildText),
                permissionsFor: () => (flags === null ? null : { has: (f) => flags.includes(f) }),
            });
            const guild = makeGuild([
                withPerms("all", [F.ViewChannel, F.SendMessages]),
                withPerms("read", [F.ViewChannel]),
                withPerms("hidden", [F.SendMessages]),
                withPerms("none", null),
            ]);
            guild.members.me = { id: "bot" };
            setClientWithGuild(guild);
            const rights = Object.fromEntries(discord.listAllChannels("g1").map((c) => [c.id, [c.botCanView, c.botCanSend]]));
            expect(rights).toEqual({
                all: [true, true],
                read: [true, false],
                // Sending into a channel the bot cannot see is not possible either.
                hidden: [false, false],
                none: [false, false],
            });
        });
    });

    // #305: the picker for the raid's voice channel, and the right to make Discord events
    describe("listVoiceChannels", () => {
        it("returns voice and stage channels, ordered by position, with their category", () => {
            const category = chan("cat", "Raids", ChannelType.GuildCategory);
            const guild = makeGuild([
                category,
                chan("t1", "kara-signup", ChannelType.GuildText, { rawPosition: 1 }),
                chan("v2", "Raid 2", ChannelType.GuildVoice, { rawPosition: 3 }),
                chan("v1", "Raid 1", ChannelType.GuildVoice, { parent: category, parentId: "cat", rawPosition: 2 }),
                chan("s1", "Bühne", ChannelType.GuildStageVoice, { rawPosition: 4 }),
            ]);
            setClientWithGuild(guild);
            expect(discord.listVoiceChannels("g1").map((c) => c.id)).toEqual(["v1", "v2", "s1"]);
            expect(discord.listVoiceChannels("g1")[0]).toEqual({ id: "v1", name: "Raid 1", category: "Raids", parentId: "cat" });
            expect(discord.listVoiceChannels("nope")).toEqual([]);
        });
    });

    describe("botCanManageEvents", () => {
        it("says true, false or — while nothing is known — null", () => {
            const { PermissionsBitField } = require("discord.js");
            const guild = makeGuild([]);
            setClientWithGuild(guild);
            // no resolved own member: unknown, never "the right is missing"
            expect(discord.botCanManageEvents("g1")).toBeNull();
            guild.members.me = { permissions: { has: (f) => f === PermissionsBitField.Flags.ManageEvents } };
            expect(discord.botCanManageEvents("g1")).toBe(true);
            guild.members.me = { permissions: { has: () => false } };
            expect(discord.botCanManageEvents("g1")).toBe(false);
            expect(discord.botCanManageEvents("nope")).toBeNull();
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
            return dc.makeGuild({ id: "g1", emojis: { cache: new Map(emojis.map((e) => [e.id, e])) } });
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

    describe("listMembersWithRoles", () => {
        // A fake member with a roles.cache keyed by role id.
        function member(id, displayName, roleIds) {
            return dc.makeMember({ id, displayName, roleIds });
        }
        function guildWithMembers(members) {
            return guildWithMemberFetch(jest.fn(async () => new Map(members.map((m) => [m.id, m]))));
        }

        // The member list is cached per guild across calls, so every test starts
        // from a clean slate instead of inheriting the previous one's fetch.
        beforeEach(() => discord._resetMembersCacheForTests());

        it("returns members holding at least one wanted role, sorted by name", async () => {
            const guild = guildWithMembers([
                member("1", "Bob", ["r1"]),
                member("2", "Alice", ["r2", "r9"]),
                member("3", "Cara", ["r9"]),
            ]);
            setClientWithGuild(guild);
            const { members, error } = await discord.listMembersWithRoles("g1", ["r1", "r2"]);
            expect(error).toBeNull();
            expect(members).toEqual([
                { id: "2", displayName: "Alice" },
                { id: "1", displayName: "Bob" },
            ]);
        });

        it("returns an empty list without fetching when no roleIds are given", async () => {
            const guild = guildWithMembers([member("1", "Bob", ["r1"])]);
            setClientWithGuild(guild);
            const res = await discord.listMembersWithRoles("g1", []);
            expect(res).toEqual({ members: [], error: null });
            expect(guild.members.fetch).not.toHaveBeenCalled();
        });

        it("degrades gracefully with an error when the fetch fails (missing intent)", async () => {
            const guild = guildWithMemberFetch(jest.fn(async () => { throw new Error("Used disallowed intents"); }));
            setClientWithGuild(guild);
            const res = await discord.listMembersWithRoles("g1", ["r1"]);
            expect(res.members).toEqual([]);
            expect(res.error).toMatch(/disallowed intents/i);
        });

        it("returns an error when the guild is unknown", async () => {
            setClientWithGuild(null);
            const res = await discord.listMembersWithRoles("nope", ["r1"]);
            expect(res.members).toEqual([]);
            expect(res.error).toMatch(/Server nicht gefunden/);
        });

        // Fetching the full member list is the expensive part of the raid detail
        // page; the ping that follows it seconds later must not pay for it again
        // (that second fetch is what pushed ping-missing past the proxy's 60s).
        it("reuses the fetched member list for a follow-up call", async () => {
            const guild = guildWithMembers([member("1", "Bob", ["r1"]), member("2", "Alice", ["r2"])]);
            setClientWithGuild(guild);

            const first = await discord.listMembersWithRoles("g1", ["r1"]);
            const second = await discord.listMembersWithRoles("g1", ["r2"]);

            expect(guild.members.fetch).toHaveBeenCalledTimes(1);
            expect(first.members).toEqual([{ id: "1", displayName: "Bob" }]);
            // Still filtered per call — only the fetch is shared, not the result.
            expect(second.members).toEqual([{ id: "2", displayName: "Alice" }]);
        });

        it("caps the fetch so it cannot outlive the reverse proxy", async () => {
            const guild = guildWithMembers([member("1", "Bob", ["r1"])]);
            setClientWithGuild(guild);
            await discord.listMembersWithRoles("g1", ["r1"]);
            expect(guild.members.fetch).toHaveBeenCalledWith({ time: 25000 });
        });

        it("does not cache a failed fetch", async () => {
            const guild = guildWithMemberFetch(jest.fn(async () => { throw new Error("Used disallowed intents"); }));
            setClientWithGuild(guild);

            await discord.listMembersWithRoles("g1", ["r1"]);
            const retry = await discord.listMembersWithRoles("g1", ["r1"]);

            expect(guild.members.fetch).toHaveBeenCalledTimes(2);
            expect(retry.error).toMatch(/disallowed intents/i);
        });
    });

    describe("listHumanMembers", () => {
        beforeEach(() => discord._resetMembersCacheForTests());
        const guildWith = (members) => guildWithMemberFetch(jest.fn(async () => new Map(members.map((m) => [m.id, m]))));

        it("lists every non-bot member with name, avatar and roles, sorted by name", async () => {
            const bot = dc.makeMember({ id: "9", displayName: "EventHelper" });
            bot.user.bot = true;
            const guild = guildWith([
                // the guild's own id is its @everyone role: never a role to import from
                dc.makeMember({ id: "1", displayName: "Bob", roleIds: ["g1", "r-raider"], displayAvatarURL: jest.fn(() => "https://cdn/1.png") }),
                dc.makeMember({ id: "2", displayName: "Alice" }),
                bot,
            ]);
            setClientWithGuild(guild);
            const { members, error } = await discord.listHumanMembers("g1");
            expect(error).toBeNull();
            expect(members).toEqual([
                { id: "2", displayName: "Alice", avatarUrl: null, roleIds: [] },
                { id: "1", displayName: "Bob", avatarUrl: "https://cdn/1.png", roleIds: ["r-raider"] },
            ]);
        });

        it("shares the member cache with listMembersWithRoles", async () => {
            const guild = guildWith([dc.makeMember({ id: "1", displayName: "Bob", roleIds: ["r1"] })]);
            setClientWithGuild(guild);
            await discord.listMembersWithRoles("g1", ["r1"]);
            await discord.listHumanMembers("g1");
            expect(guild.members.fetch).toHaveBeenCalledTimes(1);
        });

        it("keeps a member whose avatar lookup throws, without an avatar", async () => {
            const guild = guildWith([dc.makeMember({ id: "1", displayName: "Bob", displayAvatarURL: () => { throw new Error("x"); } })]);
            setClientWithGuild(guild);
            const { members } = await discord.listHumanMembers("g1");
            expect(members).toEqual([{ id: "1", displayName: "Bob", avatarUrl: null, roleIds: [] }]);
        });

        it("degrades to an empty list with an error when the fetch fails or the guild is unknown", async () => {
            setClientWithGuild(guildWithMemberFetch(jest.fn(async () => { throw new Error("Used disallowed intents"); })));
            expect(await discord.listHumanMembers("g1")).toEqual({ members: [], error: "Used disallowed intents" });
            setClientWithGuild(null);
            const res = await discord.listHumanMembers("nope");
            expect(res.members).toEqual([]);
            expect(res.error).toMatch(/Server nicht gefunden/);
        });
    });

    describe("resolveUserNames", () => {
        beforeEach(() => discord._resetAbsentNamesForTests());

        // A fake member as it appears in guild.members.cache / a fetch() result.
        function fakeMember(id, displayName) {
            return dc.makeMember({ id, displayName });
        }
        function guildWithCacheAndFetch(cached, fetchResult) {
            return guildWithMemberFetch(jest.fn(async () => new Map(fetchResult.map((m) => [m.id, m]))), cached);
        }

        it("resolves a cache hit without any fetch", async () => {
            const guild = guildWithCacheAndFetch([fakeMember("1", "Bob")], []);
            setClientWithGuild(guild);
            const names = await discord.resolveUserNames("g1", ["1"]);
            expect(names).toEqual({ 1: "Bob" });
            expect(guild.members.fetch).not.toHaveBeenCalled();
        });

        it("bulk-fetches every id missing from the cache in one call, not one per id", async () => {
            const guild = guildWithCacheAndFetch(
                [fakeMember("1", "Bob")],
                [fakeMember("2", "Alice"), fakeMember("3", "Cara")],
            );
            setClientWithGuild(guild);
            const names = await discord.resolveUserNames("g1", ["1", "2", "3", "2"]);
            expect(names).toEqual({ 1: "Bob", 2: "Alice", 3: "Cara" });
            expect(guild.members.fetch).toHaveBeenCalledTimes(1);
            // with a short time limit: without the members intent the gateway never answers, and the page would wait 2 minutes
            expect(guild.members.fetch).toHaveBeenCalledWith({ user: ["2", "3"], time: discord.NAME_FETCH_MS });
            expect(discord.NAME_FETCH_MS).toBeLessThanOrEqual(10000);
        });

        it("skips ids that Discord cannot resolve, without throwing", async () => {
            const guild = guildWithCacheAndFetch([], [fakeMember("1", "Bob")]);
            setClientWithGuild(guild);
            const names = await discord.resolveUserNames("g1", ["1", "2"]);
            expect(names).toEqual({ 1: "Bob" });
        });

        it("degrades to an empty map when the bulk fetch fails, never throws", async () => {
            const guild = guildWithMemberFetch(jest.fn(async () => { throw new Error("Used disallowed intents"); }));
            setClientWithGuild(guild);
            await expect(discord.resolveUserNames("g1", ["1"])).resolves.toEqual({});
        });

        it("does not ask again for an id Discord did not know, until ABSENT_MS has passed", async () => {
            jest.useFakeTimers({ now: 1_000_000, doNotFake: ["nextTick", "setImmediate"] });
            try {
                const guild = guildWithCacheAndFetch([], [fakeMember("1", "Bob")]);
                setClientWithGuild(guild);
                expect(await discord.resolveUserNames("g1", ["1", "gone"])).toEqual({ 1: "Bob" });
                guild.members.fetch.mockClear();
                // "1" came back but is not in this fake's cache; "gone" is remembered as absent
                await discord.resolveUserNames("g1", ["gone"]);
                expect(guild.members.fetch).not.toHaveBeenCalled();
                // the same id on another server is a different question
                await discord.resolveUserNames("g2", ["gone"]).catch(() => {});
                jest.setSystemTime(1_000_000 + discord.ABSENT_MS + 1);
                await discord.resolveUserNames("g1", ["gone"]);
                expect(guild.members.fetch).toHaveBeenCalledWith({ user: ["gone"], time: discord.NAME_FETCH_MS });
            } finally {
                jest.useRealTimers();
            }
        });

        it("skips ids for a while after a failed lookup too, so a page does not wait again", async () => {
            const guild = guildWithMemberFetch(jest.fn(async () => { throw new Error("timeout"); }));
            setClientWithGuild(guild);
            await discord.resolveUserNames("g1", ["9"]);
            await discord.resolveUserNames("g1", ["9"]);
            expect(guild.members.fetch).toHaveBeenCalledTimes(1);
        });

        it("with waitMs answers in time and lets the fetch finish in the background", async () => {
            let finish;
            const guild = guildWithMemberFetch(jest.fn(() => new Promise((resolve) => { finish = resolve; })));
            setClientWithGuild(guild);
            const started = Date.now();
            expect(await discord.resolveUserNames("g1", ["7"], { waitMs: 20 })).toEqual({});
            expect(Date.now() - started).toBeLessThan(1000);
            // the late answer still lands (discord.js caches the members it fetched) and nothing throws
            finish(new Map([["7", fakeMember("7", "Late")]]));
            await new Promise((r) => setImmediate(r));
        });

        it("returns {} without a guild or without any ids", async () => {
            setClientWithGuild(null);
            expect(await discord.resolveUserNames("nope", ["1"])).toEqual({});
            const guild = guildWithCacheAndFetch([], []);
            setClientWithGuild(guild);
            expect(await discord.resolveUserNames("g1", [])).toEqual({});
            expect(guild.members.fetch).not.toHaveBeenCalled();
        });
    });

    describe("postMissingPing", () => {
        it("pings exactly the given users with scoped allowedMentions", async () => {
            const send = jest.fn(async () => ({ id: "m1", url: "https://d/m1" }));
            setClientWithChannels(dc.makeChannel({ id: "chan", send }));
            const res = await discord.postMissingPing("chan", ["1", "2", "2"], "Bitte melden");
            expect(res).toEqual({ channelId: "chan", messageId: "m1", messageIds: ["m1"], url: "https://d/m1" });
            const payload = send.mock.calls[0][0];
            // one warn card: the mentions its first line (they ping from there), the text under them
            expect(isCardPayload(payload)).toBe(true);
            expect(payload.components[0].accent_color).toBe(KIND_COLORS.warn);
            expect(payload.content).toBe("");
            expect(cardTexts(payload)).toEqual(["<@1> <@2>", "Bitte melden"]);
            expect(payload.allowedMentions).toEqual({ users: ["1", "2"] });
        });

        it("uses a default message when no text is given", async () => {
            const send = jest.fn(async () => ({ id: "m1", url: "u" }));
            setClientWithChannels(dc.makeChannel({ id: "chan", send }));
            await discord.postMissingPing("chan", ["1"], "");
            expect(cardTexts(send.mock.calls[0][0])[1]).toMatch(/sign up or sign off/);
        });

        it("throws when there are no users to ping", async () => {
            setClientWithChannels();
            await expect(discord.postMissingPing("chan", [], "x")).rejects.toThrow("Keine fehlenden Raider");
        });

        it("throws when the bot is not connected", async () => {
            discord.setClient(null);
            await expect(discord.postMissingPing("chan", ["1"], "x")).rejects.toThrow("Bot nicht verbunden");
        });
    });

    describe("editPingMessages", () => {
        const message = (id) => ({ id, edit: jest.fn(async () => {}), delete: jest.fn(async () => {}) });

        it("edits the ping to the new list — nobody is notified", async () => {
            const m1 = message("m1");
            const channel = dc.makeChannel({ id: "chan", messages: [m1] });
            setClientWithChannels(channel);
            expect(await discord.editPingMessages("chan", ["m1"], ["1", "3", "3"], "Setup steht")).toEqual({ messageIds: ["m1"] });
            const payload = m1.edit.mock.calls[0][0];
            // the same card as the post, turning an old plain-text ping into it (content and embeds emptied)
            expect(isCardPayload(payload)).toBe(true);
            expect(payload).toMatchObject({ content: "", embeds: [], allowedMentions: { parse: [] } });
            expect(cardTexts(payload)).toEqual(["<@1> <@3>", "Setup steht"]);
            expect(channel.send).not.toHaveBeenCalled();
        });

        it("posts a chunk more quietly, deletes one left over", async () => {
            // 240 snowflake-long ids (~22 characters a mention) need two cards of 4000 characters
            const many = Array.from({ length: 240 }, (_, i) => `1000000000000${String(i).padStart(5, "0")}`);
            const m1 = message("m1");
            const grown = dc.makeChannel({ id: "chan", messages: [m1] });
            setClientWithChannels(grown);
            const out = await discord.editPingMessages("chan", ["m1"], many, "x");
            expect(out.messageIds).toEqual(["m1", "m-new"]);
            expect(grown.send).toHaveBeenCalledWith(expect.objectContaining({ allowedMentions: { parse: [] } }));

            const a = message("a");
            const b = message("b");
            setClientWithChannels(dc.makeChannel({ id: "chan", messages: [a, b] }));
            expect(await discord.editPingMessages("chan", ["a", "b"], ["1"], "x")).toEqual({ messageIds: ["a"] });
            expect(b.delete).toHaveBeenCalled();
        });

        it("leaves a ping deleted by hand deleted", async () => {
            const channel = dc.makeChannel({ id: "chan", messages: [] });
            setClientWithChannels(channel);
            expect(await discord.editPingMessages("chan", ["gone"], ["1"], "x")).toEqual({ messageIds: [] });
            expect(channel.send).not.toHaveBeenCalled();
        });

        it("throws when the bot is not connected", async () => {
            discord.setClient(null);
            await expect(discord.editPingMessages("chan", ["m1"], ["1"], "x")).rejects.toThrow("Bot nicht verbunden");
        });
    });

    describe("postLink", () => {
        it("posts ONE raid card: the raid small over the heading, the link button inside, nothing in content or embeds", async () => {
            const send = jest.fn(async () => ({ id: "m9", url: "https://d/m9" }));
            setClientWithChannels(dc.makeChannel({ id: "chan", send }));
            const res = await discord.postLink("chan", { url: "https://sheet/1", kicker: "MC", title: "Raidsheet", label: "Sheet öffnen", color: 0x2bb39b, facts: [["Start", "<t:1:d> <t:1:t>"]] });
            expect(res).toEqual({ channelId: "chan", messageId: "m9", url: "https://d/m9" });
            const payload = send.mock.calls[0][0];
            expect(isCardPayload(payload)).toBe(true);
            expect(payload).toMatchObject({ content: "", embeds: [] });
            expect(asEmbed(payload)).toMatchObject({ author: { name: "MC" }, title: "Raidsheet", color: 0x2bb39b, fields: [{ name: "Start", value: "<t:1:d> <t:1:t>", inline: true }] });
            expect(cardButtons(payload)).toEqual([expect.objectContaining({ label: "Sheet öffnen", url: "https://sheet/1" })]);
        });

        it("includes the optional message under the heading", async () => {
            const send = jest.fn(async () => ({ id: "m1", url: "u" }));
            setClientWithChannels(dc.makeChannel({ id: "chan", send }));
            await discord.postLink("chan", { url: "https://sheet/1", title: "X", message: "  Bitte eintragen!  " });
            expect(asEmbed(send.mock.calls[0][0])).toMatchObject({ title: "X", description: "Bitte eintragen!" });
        });

        it("posts only the heading when no message is given", async () => {
            const send = jest.fn(async () => ({ id: "m1", url: "u" }));
            setClientWithChannels(dc.makeChannel({ id: "chan", send }));
            await discord.postLink("chan", { url: "https://sheet/1", title: "X" });
            const card = asEmbed(send.mock.calls[0][0]);
            expect(card.title).toBe("X");
            expect(card.description).toBeUndefined();
        });

        it("throws without a url", async () => {
            setClientWithChannels();
            await expect(discord.postLink("chan", { url: "" })).rejects.toThrow("Kein Link");
        });

        it("throws when the bot is not connected", async () => {
            discord.setClient(null);
            await expect(discord.postLink("chan", { url: "https://x" })).rejects.toThrow("Bot nicht verbunden");
        });
    });

    describe("editLink", () => {
        function botMessage(overrides = {}) {
            return { id: "m9", url: "https://d/m9", author: { id: "bot" }, edit: jest.fn(async () => {}), ...overrides };
        }

        it("edits the message in place into the card (an older text post loses its text)", async () => {
            const message = botMessage();
            const channel = dc.makeChannel({ id: "chan", messages: [message] });
            const fetchMessages = channel.messages.fetch;
            setClientWithChannels(channel);
            const res = await discord.editLink("chan", "m9", { url: "https://sheet/1", title: "X", message: "Neu!" });
            expect(res).toEqual({ channelId: "chan", messageId: "m9", url: "https://d/m9" });
            expect(fetchMessages).toHaveBeenCalledWith("m9");
            const payload = message.edit.mock.calls[0][0];
            expect(payload).toMatchObject({ content: "", embeds: [] });
            expect(asEmbed(payload)).toMatchObject({ title: "X", description: "Neu!" });
        });

        it("throws when the message wasn't posted by the bot", async () => {
            const message = botMessage({ author: { id: "someoneelse" } });
            setClientWithChannels(dc.makeChannel({ id: "chan", messages: [message] }));
            await expect(discord.editLink("chan", "m9", { url: "https://sheet/1" })).rejects.toThrow("stammt nicht vom Bot");
        });

        it("takes the button off without a url — a withdrawn share (#537)", async () => {
            const message = botMessage();
            setClientWithChannels(dc.makeChannel({ id: "chan", messages: [message] }));
            await discord.editLink("chan", "m9", { url: "", title: "X", message: "Not shared" });
            const payload = message.edit.mock.calls[0][0];
            expect(asEmbed(payload)).toMatchObject({ title: "X", description: "Not shared" });
            expect(cardButtons(payload)).toEqual([]);
        });

        it("throws when the bot is not connected", async () => {
            discord.setClient(null);
            await expect(discord.editLink("chan", "m9", { url: "https://x" })).rejects.toThrow("Bot nicht verbunden");
        });
    });

    describe("parseApplicationEmbed", () => {
        it("extracts every field the /apply flow writes, stripping class emoji markup", () => {
            const embed = {
                title: "Neue Bewerbung von Marcstz",
                fields: [
                    { name: "Bewerber", value: "<@42>" },
                    { name: "Charakter", value: "Xyz" },
                    { name: "Klasse / Spec", value: "<:mage:99> Magier – Feuer" },
                    { name: "Armory (automatisch ermittelt)", value: "https://armory/x" },
                    { name: "WarcraftLogs", value: "https://logs/x" },
                    { name: "Über den Bewerber", value: "Hallo Welt" },
                ],
                footer: { text: "Discord: marc | 25.07.2026" },
            };
            expect(discord.parseApplicationEmbed(embed)).toEqual({
                applicantId: "42",
                displayName: "Marcstz",
                character: "Xyz",
                classSpec: "Magier – Feuer",
                armory: "https://armory/x",
                wcl: "https://logs/x",
                description: "Hallo Welt",
                discordName: "marc",
                date: "25.07.2026",
                // no "Version" field: an application from before #553 is a TBC one
                versionId: "tbc",
            });
        });

        it("reads the game version of the application (#553)", () => {
            const embed = { fields: [{ name: "Bewerber", value: "<@1>" }, { name: "Version", value: "Classic Era" }] };
            expect(discord.parseApplicationEmbed(embed).versionId).toBe("classic");
            expect(discord.parseApplicationEmbed({ fields: [{ name: "Version", value: "Wotlk" }] }).versionId).toBe("tbc");
        });

        it("returns blank fields for a null embed", () => {
            expect(discord.parseApplicationEmbed(null).applicantId).toBe("");
        });
    });

    describe("listApplications", () => {
        // A fake thread whose first message carries the application embed.
        function appThread(id, name, createdTimestamp, embed) {
            const messages = embed
                ? [{ embeds: [embed] }, { embeds: [{ title: "📊 Parse" }] }] // newest-first from fetch()
                : [];
            return dc.makeChannel({
                id, name, type: ChannelType.PublicThread, guildId: "g1", createdTimestamp,
                // discord.js' own getter on a real thread (#537: nothing hand-built)
                url: `https://discord.com/channels/g1/${id}`,
                messages: messages.map((m, i) => [String(i), m]),
            });
        }
        const embedFor = (char) => ({
            title: `Neue Bewerbung von ${char}`,
            fields: [{ name: "Bewerber", value: "<@42>" }, { name: "Charakter", value: char }],
        });

        function appChannel(active, archived) {
            return dc.makeChannel({
                id: "app1",
                threads: {
                    fetchActive: jest.fn(async () => ({ threads: new Map(active.map((t) => [t.id, t])) })),
                    fetchArchived: jest.fn(async () => ({ threads: new Map(archived.map((t) => [t.id, t])) })),
                },
            });
        }

        it("returns active + archived applications parsed and newest-first", async () => {
            const now = Date.now();
            const t1 = appThread("1", "Feuer - Alt", now - 2000, embedFor("Alt"));
            const t2 = appThread("2", "Frost - Neu", now - 1000, embedFor("Neu"));
            setClientWithChannels(appChannel([t2], [t1]));

            const { applications, error } = await discord.listApplications("app1");
            expect(error).toBeNull();
            expect(applications.map((a) => a.threadId)).toEqual(["2", "1"]); // newest first
            expect(applications[0]).toMatchObject({
                threadId: "2", name: "Frost - Neu", character: "Neu", archived: false,
                url: "https://discord.com/channels/g1/2",
            });
            expect(applications[1]).toMatchObject({ threadId: "1", character: "Alt", archived: true });
        });

        it("excludes threads older than the max age (6 weeks)", async () => {
            const now = Date.now();
            const recent = appThread("r", "Neu", now - 1000, embedFor("Neu"));
            const old = appThread("o", "Alt", now - (7 * 7 * 24 * 60 * 60 * 1000), embedFor("Alt")); // 7 weeks
            setClientWithChannels(appChannel([recent, old], []));

            const { applications } = await discord.listApplications("app1");
            expect(applications.map((a) => a.threadId)).toEqual(["r"]);
            // the too-old thread is dropped before its messages are ever fetched
            expect(old.messages.fetch).not.toHaveBeenCalled();
        });

        it("caps the list to at most 10 newest applications", async () => {
            const base = Date.now();
            const many = Array.from({ length: 12 }, (_, i) =>
                appThread(String(i), `App ${i}`, base - (i * 1000), embedFor(`C${i}`))); // i=0 newest
            setClientWithChannels(appChannel(many, []));

            const { applications } = await discord.listApplications("app1");
            expect(applications).toHaveLength(10);
            expect(applications.map((a) => a.threadId)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
        });

        it("returns an error when the bot is not connected", async () => {
            discord.setClient(null);
            expect(await discord.listApplications("app1")).toEqual({ applications: [], error: "Bot nicht verbunden." });
        });

        it("returns no error and no apps when no channel is configured", async () => {
            setClientWithChannels();
            expect(await discord.listApplications("")).toEqual({ applications: [], error: null });
        });

        it("reports an error when the channel cannot be fetched", async () => {
            setClientWithChannels(); // "app1" is unknown: the fetch rejects
            const res = await discord.listApplications("app1");
            expect(res.applications).toEqual([]);
            expect(res.error).toMatch(/nicht gefunden/);
        });

        it("reports an error when the channel has no thread support", async () => {
            setClientWithChannels(dc.makeChannel({ id: "app1", name: "plain" }));
            const res = await discord.listApplications("app1");
            expect(res.error).toMatch(/keine Threads/);
        });

        it("still lists a thread whose messages cannot be read (name only)", async () => {
            const bad = appThread("9", "Kaputt", Date.now() - 1000, null);
            bad.messages.fetch.mockRejectedValue(new Error("boom"));
            setClientWithChannels(appChannel([bad], []));
            const { applications } = await discord.listApplications("app1");
            expect(applications).toEqual([expect.objectContaining({ threadId: "9", name: "Kaputt", applicantId: "" })]);
        });
    });

    describe("duplicateChannel", () => {
        it("clones the source channel with a new name (same category)", async () => {
            const source = dc.makeChannel({
                id: "src", name: "kara-signup",
                clone: jest.fn(async (opts) => ({ id: "clone-1", name: (opts && opts.name) || "kara-signup" })),
            });
            const { fetch } = setClientWithChannels(source).channels;

            const res = await discord.duplicateChannel("src", "  kara-signup-2 ");
            expect(fetch).toHaveBeenCalledWith("src");
            expect(source.clone).toHaveBeenCalledWith({ name: "kara-signup-2" });
            expect(res).toEqual({ id: "clone-1", name: "kara-signup-2" });
        });

        it("falls back to the original's name when no new name is given", async () => {
            const source = dc.makeChannel({
                id: "src", name: "orig",
                clone: jest.fn(async (opts) => ({ id: "clone-1", name: (opts && opts.name) || "orig" })),
            });
            setClientWithChannels(source);
            const res = await discord.duplicateChannel("src", "");
            expect(source.clone).toHaveBeenCalledWith({ name: "orig" });
            expect(res.name).toBe("orig");
        });

        it("throws when the source cannot be cloned", async () => {
            setClientWithChannels(dc.makeChannel({ id: "x", name: "y" }));
            await expect(discord.duplicateChannel("x", "z")).rejects.toThrow("nicht duplizierbar");
        });

        it("throws when the bot is not connected", async () => {
            discord.setClient(null);
            await expect(discord.duplicateChannel("x", "z")).rejects.toThrow("Bot nicht verbunden");
        });
    });
});

describe("services/discord/discord botPermissionsIn", () => {
    const { PermissionsBitField } = require("discord.js");

    function withBot({ perms = [], intents = [] } = {}) {
        const guild = dc.makeGuild({
            id: "g1",
            me: { permissions: new PermissionsBitField(perms.map((p) => PermissionsBitField.Flags[p])) },
        });
        discord.setClient(dc.makeClient({
            guilds: [guild],
            options: { intents: { has: (k) => intents.includes(k) } },
        }));
    }

    it("lists every required right with whether the bot holds it", () => {
        withBot({ perms: ["SendMessages", "EmbedLinks"], intents: ["GuildMembers"] });
        const list = discord.botPermissionsIn("g1");
        expect(list.map((p) => p.key)).toEqual(discord.REQUIRED_BOT_PERMISSIONS.map((p) => p.key));
        expect(Object.fromEntries(list.map((p) => [p.key, p.ok]))).toEqual({
            ManageChannels: false, SendMessages: true, EmbedLinks: true, ManageRoles: false, GuildMembers: true,
        });
        expect(list.find((p) => p.key === "ManageRoles").label).toBe("Rollen verwalten");
    });

    it("counts Administrator as every channel permission", () => {
        withBot({ perms: ["Administrator"] });
        const list = discord.botPermissionsIn("g1");
        expect(list.filter((p) => !p.ok).map((p) => p.key)).toEqual(["GuildMembers"]);
    });

    // Unknown is not "everything missing".
    it("returns null when the bot is not on the server or not connected", () => {
        withBot();
        expect(discord.botPermissionsIn("other")).toBeNull();
        discord.setClient(null);
        expect(discord.botPermissionsIn("g1")).toBeNull();
    });
});

// Long pings and single-member mentions (#264).
describe("services/discord/discord ping helpers", () => {
    const discordMod = require("../../../src/services/discord/discord");

    it("splits mentions into chunks under the limit", () => {
        const mentions = Array.from({ length: 20 }, (_, i) => `<@${100000 + i}>`);
        const chunks = discordMod.mentionChunks(mentions, 100);
        expect(chunks.join(" ")).toBe(mentions.join(" "));
        for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
        expect(chunks.length).toBeGreaterThan(1);
    });

    it("posts a long ping as several cards, every mention whole, the text on the last", async () => {
        const send = jest.fn(async () => ({ id: "m", url: "u" }));
        discordMod.setClient(dc.makeClient({ channels: [dc.makeChannel({ id: "chan", send })] }));
        const users = Array.from({ length: 240 }, (_, i) => String(100000000000000000n + BigInt(i)));
        await discordMod.postMissingPing("chan", users, "Bitte melden");
        expect(send.mock.calls.length).toBeGreaterThan(1);
        // Discord's 4000 characters of text per card, and no mention cut by the card's own limit
        for (const [payload] of send.mock.calls) expect(cardTexts(payload).join("").length).toBeLessThanOrEqual(4000);
        const mentioned = send.mock.calls.flatMap(([payload]) => cardTexts(payload)[0].split(" "));
        expect(mentioned).toEqual(users.map((id) => `<@${id}>`));
        const last = send.mock.calls[send.mock.calls.length - 1][0];
        expect(cardTexts(last)[cardTexts(last).length - 1]).toBe("Bitte melden");
        expect(cardTexts(send.mock.calls[0][0])).not.toContain("Bitte melden");
        for (const [payload] of send.mock.calls) expect(payload.allowedMentions).toEqual({ users });
    });

    it("mentions single users next to the roles of an announcement", async () => {
        const send = jest.fn(async () => ({ id: "m", url: "u" }));
        discordMod.setClient(dc.makeClient({ channels: [dc.makeChannel({ id: "chan", guildId: "g", send })] }));
        await discordMod.postAnnouncement("chan", { title: "T", body: "B" }, ["r1"], ["u1", "u1"]);
        const payload = send.mock.calls[0][0];
        // one card: the mentions are its first line (they ping from a card), then the template
        expect(isCardPayload(payload)).toBe(true);
        expect(asEmbed(payload).text.split("\n")[0]).toBe("<@&r1> <@u1>");
        expect(asEmbed(payload)).toMatchObject({ title: "T", description: "B" });
        expect(payload.allowedMentions).toEqual({ roles: ["r1"], users: ["u1"] });
    });
});

describe("channelVisible (#335)", () => {
    const perms = (ok) => ({ has: (flag) => ok.includes(flag) });
    const { PermissionsBitField } = require("discord.js");
    const VIEW = PermissionsBitField.Flags.ViewChannel;
    const SEND = PermissionsBitField.Flags.SendMessages;
    function withChannel(channel) {
        discord.setClient(dc.makeClient({ channels: channel ? [channel] : [] }));
    }
    const text = (over = {}) => dc.makeChannel({ id: "c1", guild: { members: { me: { id: "bot" } } }, permissionsFor: () => perms([VIEW, SEND]), ...over });

    it("is true for a cached text channel the bot may write in", () => {
        withChannel(text());
        expect(discord.channelVisible("c1")).toBe(true);
    });

    it("is false offline, for an unknown or non-text channel and without the rights", () => {
        expect(discord.channelVisible("c1")).toBe(false);
        withChannel(null);
        expect(discord.channelVisible("c1")).toBe(false);
        withChannel(text({ isTextBased: () => false }));
        expect(discord.channelVisible("c1")).toBe(false);
        withChannel(text({ permissionsFor: () => perms([VIEW]) }));
        expect(discord.channelVisible("c1")).toBe(false);
        withChannel(text({ permissionsFor: () => null }));
        expect(discord.channelVisible("c1")).toBe(false);
    });

    it("trusts the cache when the bot member is unknown", () => {
        withChannel(text({ guild: null }));
        expect(discord.channelVisible("c1")).toBe(true);
    });
});
