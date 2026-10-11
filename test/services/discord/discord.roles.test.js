// listRoles() feeds the role pickers and the permission matrix, which tints a
// role's tile with its Discord colour; `managed` marks a role a bot or an
// integration owns, which the pickers leave out (#745).
const discord = require("../../../src/services/discord/discord.js");
const { makeClient, makeGuild } = require("../../helpers/discordClient");

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
