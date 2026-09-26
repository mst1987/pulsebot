const { ChannelType } = require("discord.js");
const discord = require("../../../src/services/discord/discord.js");
const dc = require("../../helpers/discordClient");

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

    describe("resolveUserNames", () => {
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
            expect(guild.members.fetch).toHaveBeenCalledWith({ user: ["2", "3"] });
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
            expect(res).toEqual({ channelId: "chan", messageId: "m1", url: "https://d/m1" });
            const payload = send.mock.calls[0][0];
            expect(payload.content).toBe("<@1> <@2>\nBitte melden");
            expect(payload.allowedMentions).toEqual({ users: ["1", "2"] });
        });

        it("uses a default message when no text is given", async () => {
            const send = jest.fn(async () => ({ id: "m1", url: "u" }));
            setClientWithChannels(dc.makeChannel({ id: "chan", send }));
            await discord.postMissingPing("chan", ["1"], "");
            expect(send.mock.calls[0][0].content).toMatch(/sign up or sign off/);
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

    describe("postLink", () => {
        it("posts plain content with a link button and no embed", async () => {
            const send = jest.fn(async () => ({ id: "m9", url: "https://d/m9" }));
            setClientWithChannels(dc.makeChannel({ id: "chan", send }));
            const res = await discord.postLink("chan", { url: "https://sheet/1", title: "Raidsheet – MC", label: "Sheet öffnen" });
            expect(res).toEqual({ channelId: "chan", messageId: "m9", url: "https://d/m9" });
            const payload = send.mock.calls[0][0];
            expect(payload.embeds).toEqual([]);
            expect(payload.components).toHaveLength(1);
            expect(payload.content).toContain("Raidsheet – MC");
        });

        it("includes the optional message under the title heading", async () => {
            const send = jest.fn(async () => ({ id: "m1", url: "u" }));
            setClientWithChannels(dc.makeChannel({ id: "chan", send }));
            await discord.postLink("chan", { url: "https://sheet/1", title: "X", message: "  Bitte eintragen!  " });
            expect(send.mock.calls[0][0].content).toBe("📄 **X**\nBitte eintragen!");
        });

        it("posts only the heading when no message is given", async () => {
            const send = jest.fn(async () => ({ id: "m1", url: "u" }));
            setClientWithChannels(dc.makeChannel({ id: "chan", send }));
            await discord.postLink("chan", { url: "https://sheet/1", title: "X" });
            expect(send.mock.calls[0][0].content).toBe("📄 **X**");
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

        it("edits the message in place with the rebuilt payload", async () => {
            const message = botMessage();
            const channel = dc.makeChannel({ id: "chan", messages: [message] });
            const fetchMessages = channel.messages.fetch;
            setClientWithChannels(channel);
            const res = await discord.editLink("chan", "m9", { url: "https://sheet/1", title: "X", message: "Neu!" });
            expect(res).toEqual({ channelId: "chan", messageId: "m9", url: "https://d/m9" });
            expect(fetchMessages).toHaveBeenCalledWith("m9");
            expect(message.edit).toHaveBeenCalledWith(expect.objectContaining({ content: "📄 **X**\nNeu!", embeds: [] }));
        });

        it("throws when the message wasn't posted by the bot", async () => {
            const message = botMessage({ author: { id: "someoneelse" } });
            setClientWithChannels(dc.makeChannel({ id: "chan", messages: [message] }));
            await expect(discord.editLink("chan", "m9", { url: "https://sheet/1" })).rejects.toThrow("stammt nicht vom Bot");
        });

        it("throws without a url", async () => {
            setClientWithChannels();
            await expect(discord.editLink("chan", "m9", { url: "" })).rejects.toThrow("Kein Link");
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
            });
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

    it("posts a long ping as several messages, the text on the last", async () => {
        const send = jest.fn(async () => ({ id: "m", url: "u" }));
        discordMod.setClient(dc.makeClient({ channels: [dc.makeChannel({ id: "chan", send })] }));
        const users = Array.from({ length: 120 }, (_, i) => String(100000000000000000n + BigInt(i)));
        await discordMod.postMissingPing("chan", users, "Bitte melden");
        expect(send.mock.calls.length).toBeGreaterThan(1);
        for (const [payload] of send.mock.calls) expect(payload.content.length).toBeLessThanOrEqual(2000);
        expect(send.mock.calls[send.mock.calls.length - 1][0].content.endsWith("Bitte melden")).toBe(true);
        expect(send.mock.calls[0][0].content.includes("Bitte melden")).toBe(false);
    });

    it("mentions single users next to the roles of an announcement", async () => {
        const send = jest.fn(async () => ({ id: "m", url: "u" }));
        discordMod.setClient(dc.makeClient({ channels: [dc.makeChannel({ id: "chan", guildId: "g", send })] }));
        await discordMod.postAnnouncement("chan", { title: "T", body: "B" }, ["r1"], ["u1", "u1"]);
        const payload = send.mock.calls[0][0];
        expect(payload.content).toBe("<@&r1> <@u1>");
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
