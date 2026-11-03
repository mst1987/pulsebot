// The access of a Discord account (moved out of web/http/auth.js so the bot's
// orga buttons can ask it too; the login side stays covered by auth.test.js).
// Since #925 the rights are per server: config.serverSettings[guildId].
jest.mock("../../../../src/config/variables", () => ({
    logcheckAdminIds: ["233598324022837249"],
    adminRoleIds: [],
}));
jest.mock("../../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../../src/services/discord/roles/guildRoles", () => ({ eventGuildIds: jest.fn(() => ["guild-1"]) }));

const { getConfig } = require("../../../../src/stores/settings/settingsStore");
const guildRoles = require("../../../../src/services/discord/roles/guildRoles");
const discord = require("../../../../src/services/discord/discord");
const userAccess = require("../../../../src/services/discord/members/userAccess");
const { makeClient, makeGuild, makeMember } = require("../../../helpers/discordClient");

const RAIDS_WRITE = { raids: { read: true, write: true } };
const G1 = { guildId: "guild-1" };

function clientWith(...guilds) {
    discord.setClient(makeClient({ guilds }));
}

/** A config whose rights sit on guild-1 (the one server of the old tests). */
function onGuild1(settings, extra = {}) {
    return { ...extra, serverSettings: { "guild-1": settings } };
}

beforeEach(() => {
    getConfig.mockReturnValue({});
    guildRoles.eventGuildIds.mockReturnValue(["guild-1"]);
    discord.setClient(null);
    jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => console.warn.mockRestore());

describe("services/discord/members/userAccess", () => {
    it("gives the bootstrap admin everything without asking Discord", async () => {
        const result = await userAccess.computeAccess("233598324022837249", G1);
        expect(result.isAdmin).toBe(true);
        expect(result.access.raids).toEqual({ read: true, write: true });
        // on any server, even one without a guild id
        expect((await userAccess.computeAccess("233598324022837249")).isAdmin).toBe(true);
    });

    it("answers the base access plus the account's own grants when no role carries rights", async () => {
        getConfig.mockReturnValue(onGuild1({ baseAccess: { loot: { read: true } }, userPermissions: { u1: { raids: { write: true } } } }));
        const result = await userAccess.computeAccess("u1", G1);
        expect(result.isAdmin).toBe(false);
        expect(result.access.loot).toEqual({ read: true, write: false });
        expect(result.access.raids).toEqual({ read: true, write: true });
    });

    it("fails closed without a guild id: no server, no rights", async () => {
        getConfig.mockReturnValue(onGuild1({ baseAccess: { loot: { read: true } } }));
        const result = await userAccess.computeAccess("u1");
        expect(result.isAdmin).toBe(false);
        expect(result.access.loot).toEqual({ read: false, write: false });
        expect(userAccess.BASE_ACCESS("u1", "")).toEqual(userAccess.NO_ACCESS());
    });

    it("adds the rights of the member's roles and makes an admin role a full admin", async () => {
        getConfig.mockReturnValue(onGuild1({ rolePermissions: { "r-lead": RAIDS_WRITE } }, { adminRoleIds: ["r-admin"] }));
        clientWith(makeGuild({ id: "guild-1", members: [makeMember({ id: "lead", roleIds: ["r-lead"] }), makeMember({ id: "boss", roleIds: ["r-admin"] })] }));
        expect((await userAccess.computeAccess("lead", G1)).access.raids).toEqual({ read: true, write: true });
        expect((await userAccess.computeAccess("boss", G1)).isAdmin).toBe(true);
        expect((await userAccess.computeAccess("stranger", G1)).access.raids).toEqual({ read: false, write: false });
    });

    it("marks a member holding an orga role as orga, a raider role with rights never", async () => {
        getConfig.mockReturnValue(onGuild1({ orgaRoleIds: ["r-lead"], rolePermissions: { "r-mo": RAIDS_WRITE } }));
        clientWith(makeGuild({ id: "guild-1", members: [makeMember({ id: "lead", roleIds: ["r-lead"] }), makeMember({ id: "mo", roleIds: ["r-mo"] })] }));
        // an orga role alone already asks Discord, even without any role rights
        expect(await userAccess.computeAccess("lead", G1)).toMatchObject({ isAdmin: false, isOrga: true });
        const mo = await userAccess.computeAccess("mo", G1);
        expect(mo.isOrga).toBeUndefined();
        expect(mo.access.raids).toEqual({ read: true, write: true });
    });

    describe("two servers (#925)", () => {
        const A = "guild-a";
        const B = "guild-b";
        beforeEach(() => {
            guildRoles.eventGuildIds.mockReturnValue([A, B]);
            getConfig.mockReturnValue({
                adminRoleIds: ["r-admin-a"],
                serverSettings: {
                    [A]: { rolePermissions: { "r-lead-a": RAIDS_WRITE }, orgaRoleIds: ["r-lead-a"] },
                    [B]: { rolePermissions: { "r-lead-b": RAIDS_WRITE, "r-loot-b": { loot: { read: true, write: true } } }, orgaRoleIds: ["r-lead-b"], baseAccess: { loot: { read: true } } },
                },
            });
            clientWith(
                makeGuild({ id: A, members: [makeMember({ id: "boss", roleIds: ["r-admin-a"] }), makeMember({ id: "both", roleIds: ["r-lead-b"] })] }),
                makeGuild({ id: B, members: [makeMember({ id: "orgaB", roleIds: ["r-lead-b", "r-loot-b"] }), makeMember({ id: "both", roleIds: [] })] }),
            );
        });

        it("an orga role on B opens nothing on A", async () => {
            const onB = await userAccess.computeAccess("orgaB", { guildId: B });
            expect(onB).toMatchObject({ isAdmin: false, isOrga: true });
            expect(onB.access.raids).toEqual({ read: true, write: true });
            const onA = await userAccess.computeAccess("orgaB", { guildId: A });
            expect(onA.isAdmin).toBe(false);
            expect(onA.isOrga).toBeUndefined();
            expect(onA.access.raids).toEqual({ read: false, write: false });
            expect(onA.access.loot).toEqual({ read: false, write: false });
            expect(await userAccess.userMayAny("orgaB", ["raids", "loot"], "read", { guildId: A })).toBe(false);
        });

        it("a role id of B held on A does not count on A (role ids are matched per server)", async () => {
            // "both" holds r-lead-b on server A, not on B: B's grant is not given on A, and not on B either
            expect((await userAccess.computeAccess("both", { guildId: A })).access.raids).toEqual({ read: false, write: false });
            const onB = await userAccess.computeAccess("both", { guildId: B });
            expect(onB.access.raids).toEqual({ read: false, write: false });
            // B's base access still counts on B
            expect(onB.access.loot).toEqual({ read: true, write: false });
        });

        it("a full admin through a role on A may do everything on B", async () => {
            const onB = await userAccess.computeAccess("boss", { guildId: B });
            expect(onB.isAdmin).toBe(true);
            expect(onB.access.raids).toEqual({ read: true, write: true });
            expect(onB.access.settings).toEqual({ read: true, write: true });
            expect(await userAccess.userMayAny("boss", ["settings"], "write", { guildId: B })).toBe(true);
        });

        it("keeps the base access of a server the bot cannot reach", async () => {
            clientWith(makeGuild({ id: A, members: [] }));
            const onB = await userAccess.computeAccess("orgaB", { guildId: B });
            expect(onB.access.loot).toEqual({ read: true, write: false });
            expect(onB.access.raids).toEqual({ read: false, write: false });
        });
    });

    describe("server-admin rank (#1072)", () => {
        const A = "guild-a";
        const B = "guild-b";
        const OTHER = "guild-overview";
        const { fullAccess } = require("../../../../src/config/permissions");
        const { PermissionFlagsBits } = require("discord.js");

        /** A member whose permissions answer like Discord: only `right` counts. */
        function holding(id, right, over = {}) {
            return makeMember({ id, permissions: { has: jest.fn((perm) => perm === right) }, ...over });
        }
        const discordAdmin = (id, over) => holding(id, PermissionFlagsBits.Administrator, over);

        beforeEach(() => {
            guildRoles.eventGuildIds.mockReturnValue([A, B]);
            getConfig.mockReturnValue({ serverSettings: { [B]: { baseAccess: { loot: { read: true } } } } });
        });

        it("an administrator on A has every area on A, only the base access on B, and is no full admin", async () => {
            clientWith(
                makeGuild({ id: A, members: [discordAdmin("u1")] }),
                makeGuild({ id: B, members: [holding("u1", PermissionFlagsBits.SendMessages)] }),
            );
            const onA = await userAccess.computeAccess("u1", { guildId: A });
            expect(onA).toEqual({ isAdmin: false, access: fullAccess(), isOrga: true, isServerAdmin: true });
            const onB = await userAccess.computeAccess("u1", { guildId: B });
            expect(onB.isAdmin).toBe(false);
            expect(onB.isServerAdmin).toBeUndefined();
            expect(onB.isOrga).toBeUndefined();
            expect(onB.access.loot).toEqual({ read: true, write: false });
            expect(onB.access.settings).toEqual({ read: false, write: false });
            // the bot's gates ask the same answer
            expect(await userAccess.userMayAny("u1", ["settings"], "write", { guildId: A })).toBe(true);
            expect(await userAccess.userMayAny("u1", ["settings"], "write", { guildId: B })).toBe(false);
        });

        it("gives the owner the rank without any role (permissions.has answers for the owner)", async () => {
            const owner = discordAdmin("owner", { roleIds: [] });
            clientWith(makeGuild({ id: A, members: [owner] }));
            expect(await userAccess.computeAccess("owner", { guildId: A })).toMatchObject({ isAdmin: false, isServerAdmin: true });
            expect(owner.permissions.has).toHaveBeenCalledWith(PermissionFlagsBits.Administrator);
        });

        it("gives a member without the right, or of an unexpected shape, no rank", async () => {
            clientWith(makeGuild({ id: A, members: [
                holding("plain", PermissionFlagsBits.ManageGuild),
                makeMember({ id: "shapeless" }),
                makeMember({ id: "truthy", permissions: { has: () => "yes" } }),
                makeMember({ id: "broken", permissions: { has: () => { throw new Error("no cache"); } } }),
            ] }));
            for (const id of ["plain", "shapeless", "truthy", "broken"]) {
                const result = await userAccess.computeAccess(id, { guildId: A });
                expect(result.isServerAdmin).toBeUndefined();
                expect(result.isOrga).toBeUndefined();
                expect(result.access.settings).toEqual({ read: false, write: false });
            }
        });

        it("gives no rank on a server outside discordServers.servers, even with settings there", async () => {
            guildRoles.eventGuildIds.mockReturnValue([A]);
            getConfig.mockReturnValue({ serverSettings: { [OTHER]: { baseAccess: { loot: { read: true } } } } });
            clientWith(
                makeGuild({ id: A, members: [] }),
                makeGuild({ id: OTHER, members: [discordAdmin("u1")] }),
            );
            const there = await userAccess.computeAccess("u1", { guildId: OTHER });
            expect(there.isServerAdmin).toBeUndefined();
            expect(there.isOrga).toBeUndefined();
            expect(there.access.loot).toEqual({ read: true, write: false });
            expect(there.access.settings).toEqual({ read: false, write: false });
        });

        it("asks Discord even with nothing role-based configured", async () => {
            getConfig.mockReturnValue({});
            const guild = makeGuild({ id: A, members: [discordAdmin("u1")] });
            const fetch = jest.spyOn(guild.members, "fetch");
            clientWith(guild);
            expect(await userAccess.computeAccess("u1", { guildId: A })).toMatchObject({ isServerAdmin: true });
            expect(fetch).toHaveBeenCalledWith("u1");
        });

        it("with nothing role-based configured, no answer from Discord is the base access without a throw", async () => {
            // bot not logged in
            expect((await userAccess.computeAccess("u1", { guildId: B })).access.loot).toEqual({ read: true, write: false });
            // Discord fails on A: no rank there, the rest goes on
            const failing = makeGuild({ id: A, members: [] });
            failing.members.fetch = jest.fn().mockRejectedValue(new Error("network down"));
            clientWith(failing, makeGuild({ id: B, members: [discordAdmin("u1")] }));
            const onA = await userAccess.computeAccess("u1", { guildId: A });
            expect(onA.isServerAdmin).toBeUndefined();
            expect(onA.access.settings).toEqual({ read: false, write: false });
            expect(await userAccess.computeAccess("u1", { guildId: B })).toMatchObject({ isServerAdmin: true });
        });

        it("with roles configured, a Discord error still throws and resolveAccess falls back without a rank", async () => {
            getConfig.mockReturnValue({ serverSettings: { [A]: { rolePermissions: { "r-lead": RAIDS_WRITE }, baseAccess: { loot: { read: true } } } } });
            const failing = makeGuild({ id: A, members: [] });
            failing.members.fetch = jest.fn().mockRejectedValue(new Error("network down"));
            clientWith(failing);
            await expect(userAccess.computeAccess("u1", { guildId: A })).rejects.toThrow("network down");
            const fallback = await userAccess.resolveAccess("u1", { guildId: A });
            expect(fallback.isServerAdmin).toBeUndefined();
            expect(fallback.isOrga).toBeUndefined();
            expect(fallback.access.loot).toEqual({ read: true, write: false });
            expect(fallback.access.settings).toEqual({ read: false, write: false });
        });

        it("a full-admin role wins over the rank", async () => {
            getConfig.mockReturnValue({ adminRoleIds: ["r-admin"] });
            clientWith(makeGuild({ id: A, members: [discordAdmin("u1", { roleIds: ["r-admin"] })] }));
            const result = await userAccess.computeAccess("u1", { guildId: B });
            expect(result.isAdmin).toBe(true);
            expect(result.isServerAdmin).toBeUndefined();
        });

        describe("withoutServerAdminRank", () => {
            it("puts a server with the rank back on its base access and leaves the others alone", () => {
                getConfig.mockReturnValue({ serverSettings: { [A]: { baseAccess: { loot: { read: true } }, userPermissions: { u1: { cla: { read: true } } } } } });
                const other = { access: { raids: { read: true, write: true } }, isOrga: true, isMember: true };
                const stored = { isAdmin: false, guilds: {
                    [A]: { access: fullAccess(), isOrga: true, isMember: true, isServerAdmin: true },
                    [B]: other,
                } };
                const result = userAccess.withoutServerAdminRank(stored, "u1");
                expect(result.isAdmin).toBe(false);
                expect(result.guilds[A].isServerAdmin).toBeUndefined();
                expect(result.guilds[A].isOrga).toBeUndefined();
                expect(result.guilds[A].isMember).toBe(true);
                expect(result.guilds[A].access.settings).toEqual({ read: false, write: false });
                expect(result.guilds[A].access.loot).toEqual({ read: true, write: false });
                expect(result.guilds[A].access.cla).toEqual({ read: true, write: false });
                expect(result.guilds[B]).toBe(other);
                // the stored object itself stays as it was
                expect(stored.guilds[A].isServerAdmin).toBe(true);
            });

            it("returns a result without a rank as it is, and tolerates none at all", () => {
                const stored = { isAdmin: false, guilds: { [A]: { access: {}, isOrga: true } } };
                expect(userAccess.withoutServerAdminRank(stored, "u1")).toBe(stored);
                expect(userAccess.withoutServerAdminRank(null, "u1")).toBeNull();
            });
        });
    });

    it("throws when no event server can be reached, resolveAccess falls back to the base access", async () => {
        getConfig.mockReturnValue(onGuild1({ rolePermissions: { "r-lead": RAIDS_WRITE }, baseAccess: { loot: { read: true } } }));
        await expect(userAccess.computeAccess("u1", G1)).rejects.toThrow("bot client or guild id not available");
        clientWith();
        await expect(userAccess.computeAccess("u1", G1)).rejects.toThrow();
        const fallback = await userAccess.resolveAccess("u1", G1);
        expect(fallback.isAdmin).toBe(false);
        expect(fallback.access.loot).toEqual({ read: true, write: false });
        expect(fallback.access.raids).toEqual({ read: false, write: false });
    });

    it("answers whether an account may write raids (userMayAny)", async () => {
        getConfig.mockReturnValue(onGuild1({ rolePermissions: { "r-lead": RAIDS_WRITE, "r-reader": { raids: { read: true, write: false } } } }));
        clientWith(makeGuild({ id: "guild-1", members: [makeMember({ id: "lead", roleIds: ["r-lead"] }), makeMember({ id: "reader", roleIds: ["r-reader"] })] }));
        expect(await userAccess.userMayAny("lead", ["raids"], "write", G1)).toBe(true);
        expect(await userAccess.userMayAny("reader", ["raids"], "write", G1)).toBe(false);
        expect(await userAccess.userMayAny("reader", ["raids"], "read", G1)).toBe(true);
        expect(await userAccess.userMayAny("233598324022837249", ["raids"], "write", G1)).toBe(true);
        // without a server: nothing for a role holder
        expect(await userAccess.userMayAny("lead", ["raids"], "read")).toBe(false);
    });

    it("reads role ids of any member shape and builds the base access defensively", () => {
        expect(userAccess.memberRoleIds(makeMember({ roleIds: ["a", "b"] }))).toEqual(["a", "b"]);
        expect(userAccess.memberRoleIds({})).toEqual([]);
        getConfig.mockImplementation(() => { throw new Error("broken"); });
        expect(userAccess.BASE_ACCESS("u1", "guild-1")).toEqual(userAccess.NO_ACCESS());
    });
});
