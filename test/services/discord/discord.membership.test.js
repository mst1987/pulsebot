// guildMembership() (#907): the web signup of a PuG raid asks whether the user is
// on the raid's server — true / false, null when it cannot be known.
const discord = require("../../../src/services/discord/discord.js");
const { makeClient, makeGuild, makeMember } = require("../../helpers/discordClient");

afterEach(() => discord.setClient(null));

describe("services/discord/discord guildMembership", () => {
    it("is true for a member in the cache or answered by a fetch", async () => {
        const guild = makeGuild({ id: "g1", members: [makeMember({ id: "u1" })] });
        discord.setClient(makeClient({ guilds: [guild] }));
        expect(await discord.guildMembership("g1", "u1")).toBe(true);
        guild.members.cache.get = jest.fn(() => undefined);
        guild.members.fetch = jest.fn(async () => makeMember({ id: "u1" }));
        expect(await discord.guildMembership("g1", "u1")).toBe(true);
    });

    it("is false only when Discord says Unknown Member / Unknown User", async () => {
        const guild = makeGuild({ id: "g1" });
        discord.setClient(makeClient({ guilds: [guild] }));
        expect(await discord.guildMembership("g1", "u9")).toBe(false);
        guild.members.fetch = jest.fn(async () => { throw Object.assign(new Error("Unknown User"), { rawError: { code: 10013 } }); });
        expect(await discord.guildMembership("g1", "u9")).toBe(false);
    });

    it("is null when it cannot be known", async () => {
        expect(await discord.guildMembership("g1", "u1")).toBeNull();
        const guild = makeGuild({ id: "g1" });
        discord.setClient(makeClient({ guilds: [guild] }));
        expect(await discord.guildMembership("other", "u1")).toBeNull();
        expect(await discord.guildMembership("g1", "")).toBeNull();
        guild.members.fetch = jest.fn(async () => { throw new Error("socket hang up"); });
        expect(await discord.guildMembership("g1", "u1")).toBeNull();
        guild.members.fetch = jest.fn(async () => null);
        expect(await discord.guildMembership("g1", "u1")).toBeNull();
    });
});
