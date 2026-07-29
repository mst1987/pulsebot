const {
    AREA_IDS, emptyAccess, fullAccess, can, hasAnyAccess, readableAreas,
    normalizeRolePermissions, accessForRoles, userCan, userHasMenuAccess,
} = require("../../src/config/permissions");

describe("config/permissions", () => {
    describe("emptyAccess / fullAccess", () => {
        it("covers every area", () => {
            expect(Object.keys(emptyAccess())).toEqual(AREA_IDS);
            expect(Object.keys(fullAccess())).toEqual(AREA_IDS);
        });

        it("grants nothing / everything", () => {
            expect(hasAnyAccess(emptyAccess())).toBe(false);
            expect(readableAreas(fullAccess())).toEqual(AREA_IDS);
        });
    });

    describe("can", () => {
        it("treats write as implying read", () => {
            const access = { raids: { read: false, write: true } };
            expect(can(access, "raids", "read")).toBe(true);
            expect(can(access, "raids", "write")).toBe(true);
        });

        it("does not let read imply write", () => {
            const access = { raids: { read: true, write: false } };
            expect(can(access, "raids", "read")).toBe(true);
            expect(can(access, "raids", "write")).toBe(false);
        });

        it("is false for unknown areas and a missing map", () => {
            expect(can({ raids: { read: true } }, "cla")).toBe(false);
            expect(can(null, "raids")).toBe(false);
            expect(can(undefined, "raids")).toBe(false);
        });
    });

    describe("normalizeRolePermissions", () => {
        it("drops unknown areas, empty role ids and roles that grant nothing", () => {
            const out = normalizeRolePermissions({
                role1: { raids: { read: true, write: false }, nonsense: { read: true } },
                "  ": { raids: { read: true } },
                role2: { raids: { read: false, write: false } },
                role3: "not-an-object",
            });
            expect(out).toEqual({ role1: { raids: { read: true, write: false } } });
        });

        it("lets write imply read and coerces the flags to booleans", () => {
            const out = normalizeRolePermissions({ role1: { cla: { write: 1 } } });
            expect(out).toEqual({ role1: { cla: { read: true, write: true } } });
        });

        it("returns {} for anything that isn't a plain object", () => {
            expect(normalizeRolePermissions(null)).toEqual({});
            expect(normalizeRolePermissions([])).toEqual({});
            expect(normalizeRolePermissions("x")).toEqual({});
        });
    });

    describe("accessForRoles", () => {
        const perms = {
            role1: { raids: { read: true, write: false }, cla: { read: true, write: false } },
            role2: { raids: { read: true, write: true } },
        };

        it("unions the rights of every role the member holds — the most permissive wins", () => {
            const access = accessForRoles(perms, ["role1", "role2"]);
            expect(access.raids).toEqual({ read: true, write: true });
            expect(access.cla).toEqual({ read: true, write: false });
            expect(access.settings).toEqual({ read: false, write: false });
        });

        it("ignores roles that have no permissions configured", () => {
            expect(accessForRoles(perms, ["unknown"])).toEqual(emptyAccess());
            expect(accessForRoles(perms, [])).toEqual(emptyAccess());
            expect(accessForRoles({}, ["role1"])).toEqual(emptyAccess());
        });
    });

    describe("userCan / userHasMenuAccess", () => {
        it("gives full admins everything regardless of their access map", () => {
            const admin = { isAdmin: true, access: emptyAccess() };
            expect(userCan(admin, "settings", "write")).toBe(true);
            expect(userHasMenuAccess(admin)).toBe(true);
        });

        it("follows the access map for everyone else", () => {
            const user = { isAdmin: false, access: { ...emptyAccess(), raids: { read: true, write: false } } };
            expect(userCan(user, "raids")).toBe(true);
            expect(userCan(user, "raids", "write")).toBe(false);
            expect(userCan(user, "cla")).toBe(false);
            expect(userHasMenuAccess(user)).toBe(true);
        });

        it("locks out a user with no areas and an anonymous caller", () => {
            expect(userHasMenuAccess({ isAdmin: false, access: emptyAccess() })).toBe(false);
            expect(userHasMenuAccess({ isAdmin: false })).toBe(false);
            expect(userHasMenuAccess(null)).toBe(false);
            expect(userCan(null, "raids")).toBe(false);
        });
    });
});
