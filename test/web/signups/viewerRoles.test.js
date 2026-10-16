// Whose roles the raider's lists are computed with (src/web/signups/viewerRoles.js):
// "Ansicht als Rolle" the roles looked at, else the member's own.
jest.mock("../../../src/services/discord/discord", () => ({ memberRoleIds: jest.fn() }));

const discord = require("../../../src/services/discord/discord");
const { _resetForTests } = require("../../../src/services/discord/memberRoleMemory");
const { viewerRoles } = require("../../../src/web/signups/viewerRoles");

beforeEach(() => {
    _resetForTests();
    discord.memberRoleIds.mockReset();
});

describe("viewerRoles", () => {
    it("takes the roles of \"Ansicht als Rolle\" and asks Discord nothing", async () => {
        const user = { id: "admin", viewAs: { roleIds: ["r-mo"], at: 1 } };
        expect(await viewerRoles("g1", user)).toEqual({ roleIds: ["r-mo"], viewAs: true, unknown: false });
        expect(discord.memberRoleIds).not.toHaveBeenCalled();
    });

    it("reads the member's own roles, and says when they cannot be read", async () => {
        discord.memberRoleIds.mockResolvedValueOnce(["r1"]);
        expect(await viewerRoles("g1", { id: "u1" })).toEqual({ roleIds: ["r1"], viewAs: false, unknown: false });
        discord.memberRoleIds.mockResolvedValueOnce(null);
        expect(await viewerRoles("g1", { id: "u2" })).toEqual({ roleIds: null, viewAs: false, unknown: true });
    });
});
