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

    describe("listMembersWithRoles", () => {
        // A fake member with a roles.cache keyed by role id.
        function member(id, displayName, roleIds) {
            return { id, displayName, user: { username: displayName }, roles: { cache: new Map(roleIds.map((r) => [r, { id: r }])) } };
        }
        function guildWithMembers(members) {
            return { members: { fetch: jest.fn(async () => new Map(members.map((m) => [m.id, m]))) } };
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
            const guild = { members: { fetch: jest.fn(async () => { throw new Error("Used disallowed intents"); }) } };
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
            const guild = { members: { fetch: jest.fn(async () => { throw new Error("Used disallowed intents"); }) } };
            setClientWithGuild(guild);

            await discord.listMembersWithRoles("g1", ["r1"]);
            const retry = await discord.listMembersWithRoles("g1", ["r1"]);

            expect(guild.members.fetch).toHaveBeenCalledTimes(2);
            expect(retry.error).toMatch(/disallowed intents/i);
        });
    });

    describe("postMissingPing", () => {
        it("pings exactly the given users with scoped allowedMentions", async () => {
            const send = jest.fn(async () => ({ id: "m1", url: "https://d/m1" }));
            const channel = { id: "chan", isTextBased: () => true, send };
            setClientWithGuild(makeGuild([]), jest.fn(async () => channel));
            const res = await discord.postMissingPing("chan", ["1", "2", "2"], "Bitte melden");
            expect(res).toEqual({ channelId: "chan", messageId: "m1", url: "https://d/m1" });
            const payload = send.mock.calls[0][0];
            expect(payload.content).toBe("<@1> <@2>\nBitte melden");
            expect(payload.allowedMentions).toEqual({ users: ["1", "2"] });
        });

        it("uses a default message when no text is given", async () => {
            const send = jest.fn(async () => ({ id: "m1", url: "u" }));
            setClientWithGuild(makeGuild([]), jest.fn(async () => ({ id: "chan", isTextBased: () => true, send })));
            await discord.postMissingPing("chan", ["1"], "");
            expect(send.mock.calls[0][0].content).toMatch(/an oder ab/);
        });

        it("throws when there are no users to ping", async () => {
            setClientWithGuild(makeGuild([]), jest.fn());
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
            setClientWithGuild(makeGuild([]), jest.fn(async () => ({ id: "chan", isTextBased: () => true, send })));
            const res = await discord.postLink("chan", { url: "https://sheet/1", title: "Raidsheet – MC", label: "Sheet öffnen" });
            expect(res).toEqual({ channelId: "chan", messageId: "m9", url: "https://d/m9" });
            const payload = send.mock.calls[0][0];
            expect(payload.embeds).toEqual([]);
            expect(payload.components).toHaveLength(1);
            expect(payload.content).toContain("Raidsheet – MC");
        });

        it("includes the optional message under the title heading", async () => {
            const send = jest.fn(async () => ({ id: "m1", url: "u" }));
            setClientWithGuild(makeGuild([]), jest.fn(async () => ({ id: "chan", isTextBased: () => true, send })));
            await discord.postLink("chan", { url: "https://sheet/1", title: "X", message: "  Bitte eintragen!  " });
            expect(send.mock.calls[0][0].content).toBe("📄 **X**\nBitte eintragen!");
        });

        it("posts only the heading when no message is given", async () => {
            const send = jest.fn(async () => ({ id: "m1", url: "u" }));
            setClientWithGuild(makeGuild([]), jest.fn(async () => ({ id: "chan", isTextBased: () => true, send })));
            await discord.postLink("chan", { url: "https://sheet/1", title: "X" });
            expect(send.mock.calls[0][0].content).toBe("📄 **X**");
        });

        it("throws without a url", async () => {
            setClientWithGuild(makeGuild([]), jest.fn());
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
            const fetchMessages = jest.fn(async () => message);
            setClientWithGuild(makeGuild([]), jest.fn(async () => ({
                id: "chan", isTextBased: () => true, messages: { fetch: fetchMessages },
            })));
            const res = await discord.editLink("chan", "m9", { url: "https://sheet/1", title: "X", message: "Neu!" });
            expect(res).toEqual({ channelId: "chan", messageId: "m9", url: "https://d/m9" });
            expect(fetchMessages).toHaveBeenCalledWith("m9");
            expect(message.edit).toHaveBeenCalledWith(expect.objectContaining({ content: "📄 **X**\nNeu!", embeds: [] }));
        });

        it("throws when the message wasn't posted by the bot", async () => {
            const message = botMessage({ author: { id: "someoneelse" } });
            setClientWithGuild(makeGuild([]), jest.fn(async () => ({
                id: "chan", isTextBased: () => true, messages: { fetch: jest.fn(async () => message) },
            })));
            await expect(discord.editLink("chan", "m9", { url: "https://sheet/1" })).rejects.toThrow("stammt nicht vom Bot");
        });

        it("throws without a url", async () => {
            setClientWithGuild(makeGuild([]), jest.fn());
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
            return {
                id, name, guildId: "g1", createdTimestamp,
                messages: { fetch: jest.fn(async () => new Map(messages.map((m, i) => [String(i), m]))) },
            };
        }
        const embedFor = (char) => ({
            title: `Neue Bewerbung von ${char}`,
            fields: [{ name: "Bewerber", value: "<@42>" }, { name: "Charakter", value: char }],
        });

        function appChannel(active, archived) {
            return {
                threads: {
                    fetchActive: jest.fn(async () => ({ threads: new Map(active.map((t) => [t.id, t])) })),
                    fetchArchived: jest.fn(async () => ({ threads: new Map(archived.map((t) => [t.id, t])) })),
                },
            };
        }

        it("returns active + archived applications parsed and newest-first", async () => {
            const now = Date.now();
            const t1 = appThread("1", "Feuer - Alt", now - 2000, embedFor("Alt"));
            const t2 = appThread("2", "Frost - Neu", now - 1000, embedFor("Neu"));
            const channel = appChannel([t2], [t1]);
            setClientWithGuild(makeGuild([]), jest.fn(async () => channel));

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
            setClientWithGuild(makeGuild([]), jest.fn(async () => appChannel([recent, old], [])));

            const { applications } = await discord.listApplications("app1");
            expect(applications.map((a) => a.threadId)).toEqual(["r"]);
            // the too-old thread is dropped before its messages are ever fetched
            expect(old.messages.fetch).not.toHaveBeenCalled();
        });

        it("caps the list to at most 10 newest applications", async () => {
            const base = Date.now();
            const many = Array.from({ length: 12 }, (_, i) =>
                appThread(String(i), `App ${i}`, base - (i * 1000), embedFor(`C${i}`))); // i=0 newest
            setClientWithGuild(makeGuild([]), jest.fn(async () => appChannel(many, [])));

            const { applications } = await discord.listApplications("app1");
            expect(applications).toHaveLength(10);
            expect(applications.map((a) => a.threadId)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
        });

        it("returns an error when the bot is not connected", async () => {
            discord.setClient(null);
            expect(await discord.listApplications("app1")).toEqual({ applications: [], error: "Bot nicht verbunden." });
        });

        it("returns no error and no apps when no channel is configured", async () => {
            setClientWithGuild(makeGuild([]), jest.fn());
            expect(await discord.listApplications("")).toEqual({ applications: [], error: null });
        });

        it("reports an error when the channel cannot be fetched", async () => {
            setClientWithGuild(makeGuild([]), jest.fn(async () => { throw new Error("nope"); }));
            const res = await discord.listApplications("app1");
            expect(res.applications).toEqual([]);
            expect(res.error).toMatch(/nicht gefunden/);
        });

        it("reports an error when the channel has no thread support", async () => {
            setClientWithGuild(makeGuild([]), jest.fn(async () => ({ id: "c", name: "plain" })));
            const res = await discord.listApplications("app1");
            expect(res.error).toMatch(/keine Threads/);
        });

        it("still lists a thread whose messages cannot be read (name only)", async () => {
            const bad = {
                id: "9", name: "Kaputt", guildId: "g1", createdTimestamp: Date.now() - 1000,
                messages: { fetch: jest.fn(async () => { throw new Error("boom"); }) },
            };
            setClientWithGuild(makeGuild([]), jest.fn(async () => appChannel([bad], [])));
            const { applications } = await discord.listApplications("app1");
            expect(applications).toEqual([expect.objectContaining({ threadId: "9", name: "Kaputt", applicantId: "" })]);
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
