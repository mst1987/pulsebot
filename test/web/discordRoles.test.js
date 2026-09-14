// listRoles() feeds the role pickers and the permission matrix, which tints a
// role's tile with its Discord colour.
const discord = require("../../src/web/discord.js");

function role(id, name, rawPosition, color = 0, hexColor = "#000000") {
    return { id, name, rawPosition, color, hexColor };
}

afterEach(() => discord.setClient(null));

describe("web/discord listRoles", () => {
    it("lists the roles highest first without @everyone, with their colour", () => {
        const guild = {
            id: "g1",
            roles: {
                cache: new Map([
                    ["g1", role("g1", "@everyone", 0)],
                    ["r1", role("r1", "Raider", 1, 0x35d6c4, "#35d6c4")],
                    ["r2", role("r2", "Offizier", 5)],
                ]),
            },
        };
        discord.setClient({ guilds: { cache: new Map([["g1", guild]]) } });
        expect(discord.listRoles("g1")).toEqual([
            { id: "r2", name: "Offizier", color: "" },
            { id: "r1", name: "Raider", color: "#35d6c4" },
        ]);
    });

    it("returns [] without a client", () => {
        expect(discord.listRoles("g1")).toEqual([]);
    });
});
