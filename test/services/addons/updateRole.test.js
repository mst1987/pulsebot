// Whether a role may be the self-service update role (src/services/addons/updateRole.js):
// never one with bot rights (admin, orga, area grants) or Discord permissions.
jest.mock("../../../src/config/variables", () => ({ adminRoleIds: ["900000000000000009"] }));

const { privilegedReason } = require("../../../src/services/addons/updateRole");

const ROLE = "200000000000000002";

describe("updateRole privilegedReason", () => {
    it("lets a plain role pass, with or without the Discord role at hand", () => {
        expect(privilegedReason({}, ROLE)).toBe("");
        expect(privilegedReason({}, ROLE, { permissions: { bitfield: 0n } })).toBe("");
        expect(privilegedReason({ rolePermissions: { [ROLE]: { signup: { read: false } } } }, ROLE)).toBe("");
        expect(privilegedReason({}, "")).toBe("");
        expect(privilegedReason(null, ROLE, null)).toBe("");
    });

    it.each([
        ["a full-admin role of the config", { adminRoleIds: [ROLE] }, ROLE, "full-admin"],
        ["a full-admin role of ADMIN_ROLE_IDS", {}, "900000000000000009", "full-admin"],
        ["an orga role", { orgaRoleIds: [ROLE] }, ROLE, "orga role"],
        ["a role with area grants", { rolePermissions: { [ROLE]: { signup: { read: true } } } }, ROLE, "Berechtigungen"],
    ])("refuses %s", (_name, config, roleId, reason) => {
        expect(privilegedReason(config, roleId)).toContain(reason);
    });

    it("refuses a role that carries any Discord permission", () => {
        expect(privilegedReason({}, ROLE, { permissions: { bitfield: 1024n } })).toBe("the role carries Discord permissions");
    });
});
