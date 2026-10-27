const {
    ACCESS_KEYS, accessSettings, configForGuild, accessGuildIds, allServersAccess, fullAdminRoleIds, normalizeRoleIdList,
    interactionGuildId,
} = require("../../../src/services/discord/serverAccess");

// Two servers: the orga of B is configured on B only.
const config = {
    guildId: "A",
    adminRoleIds: ["admin"],
    discordServers: { servers: [{ guildId: "A", label: "" }, { guildId: "B", label: "" }], links: [] },
    serverSettings: {
        A: { orgaRoleIds: ["orgaA"], rolePermissions: { orgaA: { loot: { read: true, write: true } } } },
        B: {
            orgaRoleIds: ["orgaB", "orgaB", " "],
            rolePermissions: { orgaB: { raids: { read: true } } },
            baseAccess: { signup: { read: true }, nonsense: { read: true, write: true } },
            userPermissions: { u1: { loot: { read: true } } },
            botCommandAccess: { signup: { mode: "roles", roleIds: ["123456789012345678"] } },
        },
    },
};

describe("services/discord/serverAccess (#925)", () => {
    it("names the five keys that live per server", () => {
        expect([...ACCESS_KEYS].sort()).toEqual(["baseAccess", "botCommandAccess", "orgaRoleIds", "rolePermissions", "userPermissions"]);
    });

    it("reads one server's settings, normalised", () => {
        const b = accessSettings("B", config);
        expect(b.orgaRoleIds).toEqual(["orgaB"]);
        expect(b.baseAccess).toEqual({ signup: { read: true, write: false } });
        expect(Object.keys(b.rolePermissions)).toEqual(["orgaB"]);
        expect(Object.keys(b.userPermissions)).toEqual(["u1"]);
    });

    // The core of #925: a grant on B never reaches A.
    it("keeps the servers apart", () => {
        const a = accessSettings("A", config);
        expect(a.orgaRoleIds).toEqual(["orgaA"]);
        expect(a.rolePermissions.orgaB).toBeUndefined();
        expect(a.userPermissions).toEqual({});
        expect(a.baseAccess).toEqual({});
    });

    it("fails closed for an empty or unknown server", () => {
        for (const gid of ["", null, undefined, "C"]) {
            const none = accessSettings(gid, config);
            expect(none.orgaRoleIds).toEqual([]);
            expect(none.rolePermissions).toEqual({});
            expect(none.userPermissions).toEqual({});
            expect(none.baseAccess).toEqual({});
        }
    });

    it("ignores the old global fields: there is no fallback", () => {
        const legacy = { ...config, serverSettings: {}, orgaRoleIds: ["old"], rolePermissions: { old: { loot: { read: true } } } };
        expect(accessSettings("A", legacy).orgaRoleIds).toEqual([]);
        expect(accessSettings("A", legacy).rolePermissions).toEqual({});
    });

    it("lays one server's rights over the top level for the helpers of before", () => {
        const cfg = configForGuild(config, "B");
        expect(cfg.orgaRoleIds).toEqual(["orgaB"]);
        expect(cfg.adminRoleIds).toEqual(["admin"]);
        expect(config.orgaRoleIds).toBeUndefined();
    });

    it("lists the servers that may hold rights", () => {
        expect(accessGuildIds(config).sort()).toEqual(["A", "B"]);
    });

    it("unites every server only for questions of use", () => {
        const all = allServersAccess(config);
        expect(all.orgaRoleIds.sort()).toEqual(["orgaA", "orgaB"]);
        expect(Object.keys(all.rolePermissions).sort()).toEqual(["orgaA", "orgaB"]);
        expect(all.botCommandAccess.signup.roleIds).toEqual(["123456789012345678"]);
    });

    it("keeps the full admin roles global", () => {
        expect(fullAdminRoleIds(config)).toContain("admin");
    });

    it("cleans role id lists", () => {
        expect(normalizeRoleIdList([" a ", "a", "", 3])).toEqual(["a", "3"]);
        expect(normalizeRoleIdList("x")).toEqual([]);
    });

    describe("interactionGuildId", () => {
        it("judges an interaction by the server it happened on", () => {
            expect(interactionGuildId({ guildId: "B" }, config)).toBe("B");
            expect(interactionGuildId({ guild: { id: "B" } }, config)).toBe("B");
        });

        it("judges a DM by the home server", () => {
            expect(interactionGuildId({ guildId: null }, config)).toBe("A");
        });
    });
});
