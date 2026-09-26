// "Ansicht als Rolle": what a member with exactly the viewed roles would get,
// and that the session itself is never changed.
const { MAX_AGE_MS, normalizeRoleIds, accessAsRoles, viewAsActive, effectiveUser } = require("../../../src/web/http/viewAs");
const { fullAccess } = require("../../../src/config/permissions");

const RAIDER = "111111111111111111";
const LEAD = "222222222222222222";
const ADMIN = "333333333333333333";
const config = {
    adminRoleIds: [ADMIN],
    baseAccess: { loot: { read: true, write: false } },
    rolePermissions: {
        [RAIDER]: { signup: { read: true, write: true } },
        [LEAD]: { raids: { read: true, write: true }, cla: { read: true, write: false } },
    },
    userPermissions: { u1: { settings: { read: true, write: true } } },
};

describe("viewAs", () => {
    it("keeps only role ids, each once, at most MAX_ROLES", () => {
        expect(normalizeRoleIds([RAIDER, RAIDER, "nope", "", null, LEAD])).toEqual([RAIDER, LEAD]);
        expect(normalizeRoleIds("x")).toEqual([]);
        expect(normalizeRoleIds(Array.from({ length: 40 }, (_, i) => String(10000000 + i))).length).toBe(25);
    });

    it("gives the base access plus the viewed roles' permissions — never a single account's grants", () => {
        const raider = accessAsRoles(config, [RAIDER]);
        expect(raider.isAdmin).toBe(false);
        expect(raider.access.signup).toEqual({ read: true, write: true });
        expect(raider.access.loot).toEqual({ read: true, write: false });
        expect(raider.access.raids).toEqual({ read: false, write: false });
        expect(raider.access.settings).toEqual({ read: false, write: false });
        // two roles: the union
        const both = accessAsRoles(config, [RAIDER, LEAD]);
        expect(both.access.raids.write).toBe(true);
        expect(both.access.signup.write).toBe(true);
        // no role: only the base access
        const none = accessAsRoles(config, []);
        expect(none.access.loot.read).toBe(true);
        expect(none.access.signup.read).toBe(false);
    });

    it("an admin role, from the settings or from .env, is a full admin", () => {
        expect(accessAsRoles(config, [RAIDER, ADMIN])).toEqual({ isAdmin: true, access: fullAccess() });
        expect(accessAsRoles(config, [LEAD], [LEAD]).isAdmin).toBe(true);
    });

    it("ends after MAX_AGE_MS", () => {
        const now = 10 * MAX_AGE_MS;
        expect(viewAsActive({ roleIds: [], at: now - 1000 }, now)).toBe(true);
        expect(viewAsActive({ roleIds: [], at: now - MAX_AGE_MS }, now)).toBe(false);
        expect(viewAsActive(null, now)).toBe(false);
    });

    it("hands readers a copy with the role's rights, and leaves the session alone", () => {
        const now = Date.now();
        const session = { id: "u1", name: "Chef", isAdmin: true, access: fullAccess(), viewAs: { roleIds: [RAIDER], at: now } };
        const user = effectiveUser(session, config, [], now);
        expect(user).not.toBe(session);
        expect(user.isAdmin).toBe(false);
        expect(user.access.signup.write).toBe(true);
        expect(user.access.settings.read).toBe(false);
        expect(user.viewAs).toEqual({ roleIds: [RAIDER], at: now });
        expect(user.id).toBe("u1");
        expect(session.isAdmin).toBe(true);
        expect(session.access).toEqual(fullAccess());
    });

    it("does nothing for a session that is no full admin (any more), or without a running view", () => {
        const now = Date.now();
        const demoted = { id: "u2", isAdmin: false, access: {}, viewAs: { roleIds: [LEAD], at: now } };
        expect(effectiveUser(demoted, config, [], now)).toBe(demoted);
        const plain = { id: "u1", isAdmin: true, access: fullAccess() };
        expect(effectiveUser(plain, config, [], now)).toBe(plain);
        const old = { id: "u1", isAdmin: true, access: fullAccess(), viewAs: { roleIds: [RAIDER], at: now - MAX_AGE_MS - 1 } };
        expect(effectiveUser(old, config, [], now)).toBe(old);
        expect(effectiveUser(null, config)).toBeNull();
    });
});
