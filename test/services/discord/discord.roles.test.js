// listRoles() feeds the role pickers and the permission matrix, which tints a
// role's tile with its Discord colour; `managed` marks a role a bot or an
// integration owns, which the pickers leave out (#745).
const discord = require("../../../src/services/discord/discord.js");
const { makeClient, makeGuild, makeMember } = require("../../helpers/discordClient");

function role(id, name, rawPosition, color = 0, hexColor = "#000000", managed = false) {
    return { id, name, rawPosition, color, hexColor, managed };
}

afterEach(() => discord.setClient(null));

describe("services/discord/discord listRoles", () => {
    it("lists the roles highest first without @everyone, with their colour", () => {
        const guild = makeGuild({
            id: "g1",
            roles: [
                role("g1", "@everyone", 0),
                role("r1", "Raider", 1, 0x35d6c4, "#35d6c4"),
                role("r2", "Offizier", 5),
            ],
        });
        discord.setClient(makeClient({ guilds: [guild] }));
        expect(discord.listRoles("g1")).toEqual([
            { id: "r2", name: "Offizier", color: "", managed: false },
            { id: "r1", name: "Raider", color: "#35d6c4", managed: false },
        ]);
    });

    it("marks a role a bot owns as managed (#745)", () => {
        const guild = makeGuild({ id: "g1", roles: [role("r1", "Raider", 1), role("m1", "MEE6", 9, 0, "#000000", true)] });
        discord.setClient(makeClient({ guilds: [guild] }));
        expect(discord.listRoles("g1").map((r) => [r.name, r.managed])).toEqual([["MEE6", true], ["Raider", false]]);
    });

    it("returns [] without a client", () => {
        expect(discord.listRoles("g1")).toEqual([]);
    });
});

// memberRoleIds feeds the raider-role check; `absentAs` lets a signup tell
// "surely not on the server" from "unknown" with one fetch (#904).
describe("services/discord/discord memberRoleIds", () => {
    const failingGuild = (error) => {
        const guild = makeGuild({ id: "g1" });
        guild.members.fetch = jest.fn(async () => { throw error; });
        return guild;
    };

    it("lists the member's role ids", async () => {
        discord.setClient(makeClient({ guilds: [makeGuild({ id: "g1", members: [makeMember({ id: "u1", roleIds: ["r1", "r2"] })] })] }));
        await expect(discord.memberRoleIds("g1", "u1", { absentAs: [] })).resolves.toEqual(["r1", "r2"]);
    });

    it("answers absentAs on Unknown Member / Unknown User, null by default", async () => {
        discord.setClient(makeClient({ guilds: [makeGuild({ id: "g1" })] }));
        await expect(discord.memberRoleIds("g1", "u9")).resolves.toBeNull();
        await expect(discord.memberRoleIds("g1", "u9", { absentAs: [] })).resolves.toEqual([]);
        discord.setClient(makeClient({ guilds: [failingGuild(Object.assign(new Error("Unknown User"), { rawError: { code: 10013 } }))] }));
        await expect(discord.memberRoleIds("g1", "u9", { absentAs: [] })).resolves.toEqual([]);
    });

    it("stays null for any other failure, an unknown guild or no bot", async () => {
        discord.setClient(makeClient({ guilds: [failingGuild(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))] }));
        await expect(discord.memberRoleIds("g1", "u9", { absentAs: [] })).resolves.toBeNull();
        await expect(discord.memberRoleIds("g2", "u9", { absentAs: [] })).resolves.toBeNull();
        discord.setClient(null);
        await expect(discord.memberRoleIds("g1", "u9", { absentAs: [] })).resolves.toBeNull();
    });
});
