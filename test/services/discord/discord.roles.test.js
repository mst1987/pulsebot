// listRoles() feeds the role pickers and the permission matrix, which tints a
// role's tile with its Discord colour.
const discord = require("../../../src/services/discord/discord.js");
const { makeClient, makeGuild } = require("../../helpers/discordClient");

function role(id, name, rawPosition, color = 0, hexColor = "#000000") {
    return { id, name, rawPosition, color, hexColor };
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
            { id: "r2", name: "Offizier", color: "" },
            { id: "r1", name: "Raider", color: "#35d6c4" },
        ]);
    });

    it("returns [] without a client", () => {
        expect(discord.listRoles("g1")).toEqual([]);
    });
});
