// The member's roles for the raider's lists, with a short memory over a Discord
// hiccup (src/services/discord/memberRoleMemory.js).
jest.mock("../../../src/services/discord/discord", () => ({ memberRoleIds: jest.fn() }));

const discord = require("../../../src/services/discord/discord");
const { memberRolesRemembered, KEEP_MS, _resetForTests } = require("../../../src/services/discord/memberRoleMemory");

const NOW = 1_900_000_000_000;

beforeEach(() => {
    _resetForTests();
    discord.memberRoleIds.mockReset();
});

describe("memberRolesRemembered", () => {
    it("reads the roles live and remembers them", async () => {
        discord.memberRoleIds.mockResolvedValue(["r1", 2]);
        expect(await memberRolesRemembered("g1", "u1", { now: NOW })).toEqual({ roleIds: ["r1", "2"], stale: false });
        expect(discord.memberRoleIds).toHaveBeenCalledWith("g1", "u1");
    });

    it("stands in with the last read while it is young, then says unknown", async () => {
        discord.memberRoleIds.mockResolvedValueOnce(["r1"]);
        await memberRolesRemembered("g1", "u1", { now: NOW });
        discord.memberRoleIds.mockResolvedValue(null);
        expect(await memberRolesRemembered("g1", "u1", { now: NOW + 60_000 })).toEqual({ roleIds: ["r1"], stale: true });
        expect(await memberRolesRemembered("g1", "u1", { now: NOW + KEEP_MS })).toEqual({ roleIds: null, stale: false });
    });

    it("treats a throwing read like a failed one and keeps members apart", async () => {
        discord.memberRoleIds.mockResolvedValueOnce(["r1"]);
        await memberRolesRemembered("g1", "u1", { now: NOW });
        discord.memberRoleIds.mockRejectedValue(new Error("gateway down"));
        expect((await memberRolesRemembered("g1", "u1", { now: NOW + 1000 })).roleIds).toEqual(["r1"]);
        expect((await memberRolesRemembered("g1", "u2", { now: NOW + 1000 })).roleIds).toBeNull();
        expect((await memberRolesRemembered("g2", "u1", { now: NOW + 1000 })).roleIds).toBeNull();
    });

    it("asks nothing without a server or a member", async () => {
        expect(await memberRolesRemembered("", "u1")).toEqual({ roleIds: null, stale: false });
        expect(discord.memberRoleIds).not.toHaveBeenCalled();
    });
});
