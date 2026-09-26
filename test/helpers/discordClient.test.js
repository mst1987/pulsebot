// The fake discord.js client the suites share (#433).
const { ChannelType } = require("discord.js");
const { makeClient, makeGuild, makeChannel, makeMember, discordError } = require("./discordClient");
const { textChannelOf } = require("../../src/services/discord/discord");

describe("test/helpers/discordClient", () => {
    it("fetches cached channels and rejects an unknown one like Discord", async () => {
        const channel = makeChannel({ id: "c1", name: "kara" });
        const client = makeClient({ channels: [channel] });
        await expect(client.channels.fetch("c1")).resolves.toBe(channel);
        await expect(client.channels.fetch("nope")).rejects.toMatchObject({ code: 10003, message: "Unknown Channel" });
        expect(client.channels.cache.get("c1")).toBe(channel);
        expect(client.isReady()).toBe(true);
        expect(client.user.id).toBe("bot");
    });

    it("answers null for a missing channel when asked to", async () => {
        const client = makeClient({ missing: "null" });
        await expect(client.channels.fetch("nope")).resolves.toBeNull();
    });

    it("builds guilds with members, roles and the bot as members.me", async () => {
        const member = makeMember({ id: "u1", roleIds: ["r1", "r2"] });
        const guild = makeGuild({ id: "g1", members: [member], roles: [{ id: "r1", name: "Raider" }] });
        const client = makeClient({ guilds: [guild] });
        expect(client.guilds.cache.get("g1")).toBe(guild);
        await expect(client.guilds.fetch("g2")).rejects.toMatchObject({ code: 10004 });
        await expect(guild.members.fetch("u1")).resolves.toBe(member);
        await expect(guild.members.fetch("u9")).rejects.toMatchObject({ code: 10007 });
        expect((await guild.members.fetch()).size).toBe(1);
        expect([...member.roles.cache.keys()]).toEqual(["r1", "r2"]);
        expect(guild.roles.cache.find((r) => r.name === "Raider").id).toBe("r1");
        expect(guild.members.me).toEqual({ id: "bot" });
        expect(guild.roles.everyone).toEqual({ id: "g1" });
    });

    it("puts bare members on a default guild", () => {
        const client = makeClient({ members: [makeMember({ id: "u2" })] });
        expect(client.guilds.cache.get("g1").members.cache.has("u2")).toBe(true);
    });

    it("gives text channels send and messages, voice channels no text", async () => {
        const message = { id: "m1" };
        const text = makeChannel({ messages: [message] });
        expect(text.isTextBased()).toBe(true);
        await expect(text.messages.fetch("m1")).resolves.toBe(message);
        await expect(text.messages.fetch("m2")).rejects.toMatchObject({ code: 10008 });
        await expect(text.send({ content: "hi" })).resolves.toMatchObject({ id: "m-new", channelId: "c1" });
        expect(makeChannel({ type: ChannelType.GuildVoice }).isTextBased()).toBe(false);
    });

    it("is a client the real textChannelOf accepts", async () => {
        const client = makeClient({ channels: [makeChannel({ id: "c1" })] });
        await expect(textChannelOf(client, "c1")).resolves.toMatchObject({ id: "c1" });
        const voice = makeClient({ channels: [makeChannel({ id: "v1", type: ChannelType.GuildVoice })] });
        await expect(textChannelOf(voice, "v1")).rejects.toMatchObject({ code: "channel_not_found" });
    });

    it("discordError carries the API code", () => {
        expect(discordError("member")).toMatchObject({ code: 10007, status: 404, message: "Unknown Member" });
    });
});
