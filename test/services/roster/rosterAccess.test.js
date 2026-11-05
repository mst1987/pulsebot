jest.mock("../../../src/services/discord/discord", () => ({ memberRoleIds: jest.fn() }));

const discord = require("../../../src/services/discord/discord");
const { canManageRoster, canManageRosterLive, mayAdminRoster, mayCreateRosters } = require("../../../src/services/roster/rosterAccess");

const roster = { guildId: "g1", managers: { roleIds: ["50", "51"], userIds: ["700"] } };

describe("services/roster/rosterAccess canManageRoster", () => {
    it("a full admin manages every roster, even without one", () => {
        expect(canManageRoster({ id: "1", isAdmin: true }, roster, [])).toBe(true);
        expect(canManageRoster({ id: "1", isAdmin: true }, null)).toBe(true);
    });

    it("an account in managers.userIds", () => {
        expect(canManageRoster({ id: "700" }, roster, null)).toBe(true);
        expect(canManageRoster({ id: 700 }, roster)).toBe(true);
    });

    it("a member holding a manager role", () => {
        expect(canManageRoster({ id: "2" }, roster, ["1", "51"])).toBe(true);
        expect(canManageRoster({ id: "2" }, roster, ["1"])).toBe(false);
    });

    it("nobody else - also not with unknown roles, without user or managers", () => {
        expect(canManageRoster({ id: "2" }, roster, null)).toBe(false);
        expect(canManageRoster(null, roster, ["50"])).toBe(false);
        expect(canManageRoster({ id: "2" }, null, ["50"])).toBe(false);
        expect(canManageRoster({ id: "2" }, {}, ["50"])).toBe(false);
        expect(canManageRoster({ id: "" }, { managers: { userIds: [""] } }, [])).toBe(false);
        // "isAdmin" must be true itself, not just truthy
        expect(canManageRoster({ id: "2", isAdmin: "yes" }, roster, [])).toBe(false);
    });
});

describe("services/roster/rosterAccess server-admin rank", () => {
    const rank = { id: "2", guildId: "g1", isServerAdmin: true };

    it("manages the rosters of its active server, without a manager role", () => {
        expect(canManageRoster(rank, roster, [])).toBe(true);
        expect(mayAdminRoster(rank, roster)).toBe(true);
    });

    it("stops at a roster of another server and at one without a server", () => {
        for (const other of [{ guildId: "g2" }, {}, { guildId: "" }]) {
            expect(canManageRoster(rank, other, [])).toBe(false);
            expect(mayAdminRoster(rank, other)).toBe(false);
        }
        expect(mayAdminRoster(rank, null)).toBe(false);
    });

    it("the flag must be true itself and the user needs an active server", () => {
        expect(canManageRoster({ ...rank, isServerAdmin: "yes" }, roster, [])).toBe(false);
        expect(mayAdminRoster({ ...rank, isServerAdmin: "yes" }, roster)).toBe(false);
        expect(mayAdminRoster({ id: "2", isServerAdmin: true }, roster)).toBe(false);
    });

    it("mayAdminRoster and mayCreateRosters: the rank and full admins, not a manager", () => {
        expect(mayAdminRoster({ id: "1", isAdmin: true }, { guildId: "g2" })).toBe(true);
        expect(mayAdminRoster({ id: "700" }, roster)).toBe(false);
        expect(mayAdminRoster(null, roster)).toBe(false);
        expect(mayCreateRosters(rank)).toBe(true);
        expect(mayCreateRosters({ id: "1", isAdmin: true })).toBe(true);
        expect(mayCreateRosters({ id: "700" })).toBe(false);
        expect(mayCreateRosters(null)).toBe(false);
    });
});

describe("services/roster/rosterAccess canManageRosterLive", () => {
    it("asks Discord only when a manager role could decide", async () => {
        discord.memberRoleIds.mockResolvedValue(["50"]);
        await expect(canManageRosterLive({ id: "700" }, roster)).resolves.toBe(true);
        expect(discord.memberRoleIds).not.toHaveBeenCalled();
        await expect(canManageRosterLive({ id: "2" }, roster)).resolves.toBe(true);
        expect(discord.memberRoleIds).toHaveBeenCalledWith("g1", "2");
    });

    it("an unknown member (bot offline) holds no role", async () => {
        discord.memberRoleIds.mockResolvedValue(null);
        await expect(canManageRosterLive({ id: "2" }, roster)).resolves.toBe(false);
    });

    it("no roles to check, no server or no user: no fetch, no right", async () => {
        const lookup = jest.fn();
        await expect(canManageRosterLive({ id: "2" }, { guildId: "g1", managers: { userIds: ["9"] } }, { memberRoleIds: lookup })).resolves.toBe(false);
        await expect(canManageRosterLive({ id: "2" }, { managers: { roleIds: ["50"] } }, { memberRoleIds: lookup })).resolves.toBe(false);
        await expect(canManageRosterLive(null, roster, { memberRoleIds: lookup })).resolves.toBe(false);
        expect(lookup).not.toHaveBeenCalled();
    });
});
