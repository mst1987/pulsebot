// The access of a Discord account (moved out of web/http/auth.js so the bot's
// orga buttons can ask it too; the login side stays covered by auth.test.js).
jest.mock("../../../src/config/variables", () => ({
    logcheckAdminIds: ["233598324022837249"],
    adminRoleIds: [],
}));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/services/discord/guildRoles", () => ({ eventGuildIds: jest.fn(() => ["guild-1"]) }));

const { getConfig } = require("../../../src/stores/settingsStore");
const guildRoles = require("../../../src/services/discord/guildRoles");
const discord = require("../../../src/services/discord/discord");
const userAccess = require("../../../src/services/discord/userAccess");
const { makeClient, makeGuild, makeMember } = require("../../helpers/discordClient");

const RAIDS_WRITE = { raids: { read: true, write: true } };

function clientWith(...guilds) {
    discord.setClient(makeClient({ guilds }));
}

beforeEach(() => {
    getConfig.mockReturnValue({});
    guildRoles.eventGuildIds.mockReturnValue(["guild-1"]);
    discord.setClient(null);
    jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => console.warn.mockRestore());

describe("services/discord/userAccess", () => {
    it("gives the bootstrap admin everything without asking Discord", async () => {
        const result = await userAccess.computeAccess("233598324022837249");
        expect(result.isAdmin).toBe(true);
        expect(result.access.raids).toEqual({ read: true, write: true });
    });

    it("answers the base access plus the account's own grants when no role carries rights", async () => {
        getConfig.mockReturnValue({ baseAccess: { loot: { read: true } }, userPermissions: { u1: { raids: { write: true } } } });
        const result = await userAccess.computeAccess("u1");
        expect(result.isAdmin).toBe(false);
        expect(result.access.loot).toEqual({ read: true, write: false });
        expect(result.access.raids).toEqual({ read: true, write: true });
    });

    it("adds the rights of the member's roles and makes an admin role a full admin", async () => {
        getConfig.mockReturnValue({ adminRoleIds: ["r-admin"], rolePermissions: { "r-lead": RAIDS_WRITE } });
        clientWith(makeGuild({ id: "guild-1", members: [makeMember({ id: "lead", roleIds: ["r-lead"] }), makeMember({ id: "boss", roleIds: ["r-admin"] })] }));
        expect((await userAccess.computeAccess("lead")).access.raids).toEqual({ read: true, write: true });
        expect((await userAccess.computeAccess("boss")).isAdmin).toBe(true);
        expect((await userAccess.computeAccess("stranger")).access.raids).toEqual({ read: false, write: false });
    });

    it("marks a member holding an orga role as orga, a raider role with rights never", async () => {
        getConfig.mockReturnValue({ orgaRoleIds: ["r-lead"], rolePermissions: { "r-mo": RAIDS_WRITE } });
        clientWith(makeGuild({ id: "guild-1", members: [makeMember({ id: "lead", roleIds: ["r-lead"] }), makeMember({ id: "mo", roleIds: ["r-mo"] })] }));
        // an orga role alone already asks Discord, even without any role rights
        expect(await userAccess.computeAccess("lead")).toMatchObject({ isAdmin: false, isOrga: true });
        const mo = await userAccess.computeAccess("mo");
        expect(mo.isOrga).toBeUndefined();
        expect(mo.access.raids).toEqual({ read: true, write: true });
    });

    it("throws when no event server can be reached, resolveAccess falls back to the base access", async () => {
        getConfig.mockReturnValue({ rolePermissions: { "r-lead": RAIDS_WRITE }, baseAccess: { loot: { read: true } } });
        await expect(userAccess.computeAccess("u1")).rejects.toThrow("bot client or guild id not available");
        clientWith();
        await expect(userAccess.computeAccess("u1")).rejects.toThrow();
        const fallback = await userAccess.resolveAccess("u1");
        expect(fallback.isAdmin).toBe(false);
        expect(fallback.access.loot).toEqual({ read: true, write: false });
    });

    it("answers whether an account may write raids (userMayAny)", async () => {
        getConfig.mockReturnValue({ rolePermissions: { "r-lead": RAIDS_WRITE, "r-reader": { raids: { read: true, write: false } } } });
        clientWith(makeGuild({ id: "guild-1", members: [makeMember({ id: "lead", roleIds: ["r-lead"] }), makeMember({ id: "reader", roleIds: ["r-reader"] })] }));
        expect(await userAccess.userMayAny("lead", ["raids"], "write")).toBe(true);
        expect(await userAccess.userMayAny("reader", ["raids"], "write")).toBe(false);
        expect(await userAccess.userMayAny("reader", ["raids"], "read")).toBe(true);
        expect(await userAccess.userMayAny("233598324022837249", ["raids"], "write")).toBe(true);
    });

    it("reads role ids of any member shape and builds the base access defensively", () => {
        expect(userAccess.memberRoleIds(makeMember({ roleIds: ["a", "b"] }))).toEqual(["a", "b"]);
        expect(userAccess.memberRoleIds({})).toEqual([]);
        getConfig.mockImplementation(() => { throw new Error("broken"); });
        expect(userAccess.BASE_ACCESS("u1")).toEqual(userAccess.NO_ACCESS());
    });
});
