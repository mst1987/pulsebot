import { describe, expect, it } from "vitest";
import { changedAccessFields, type AccessFields } from "./accessPatch";

const saved: AccessFields = {
    adminRoleIds: ["a1"],
    rolePermissions: { r1: { raids: { read: true, write: false } } },
    baseAccess: { signup: { read: true, write: true } },
    userPermissions: {},
    orgaRoleIds: ["r1"],
};

describe("changedAccessFields (#925)", () => {
    it("sends nothing for an untouched draft, so an old tab cannot overwrite another server's rights", () => {
        expect(changedAccessFields(structuredClone(saved), saved)).toEqual({});
    });

    it("ignores the order of object keys", () => {
        const draft = { ...saved, baseAccess: { signup: { write: true, read: true } } };
        expect(changedAccessFields(draft, saved)).toEqual({});
    });

    it("sends only the fields the draft changed", () => {
        const draft = { ...saved, orgaRoleIds: [], rolePermissions: { r1: { raids: { read: true, write: true } } } };
        expect(changedAccessFields(draft, saved)).toEqual({ orgaRoleIds: [], rolePermissions: draft.rolePermissions });
    });

    it("sends a changed admin role list on its own", () => {
        expect(changedAccessFields({ ...saved, adminRoleIds: ["a1", "a2"] }, saved)).toEqual({ adminRoleIds: ["a1", "a2"] });
    });
});
