import { describe, expect, it } from "vitest";
import { accessPatch, changedAccessFields, type AccessFields } from "./accessPatch";

const saved: AccessFields = {
    adminRoleIds: ["a1"],
    rolePermissions: { r1: { raids: { read: true, write: false } } },
    baseAccess: { signup: { read: true, write: true } },
    userPermissions: {},
    orgaRoleIds: ["r1"],
    botCommandAccess: {},
};

describe("accessPatch (#925)", () => {
    it("sends a server's rights with the server the page loaded, so a switched session is refused", () => {
        const draft = { ...saved, orgaRoleIds: ["r2"] };
        expect(accessPatch(draft, saved, "g1")).toEqual({ orgaRoleIds: ["r2"], serverSettingsGuildId: "g1" });
    });

    it("sends the global admin roles without a server", () => {
        expect(accessPatch({ ...saved, adminRoleIds: ["a2"] }, saved, "g1")).toEqual({ adminRoleIds: ["a2"] });
    });

    it("counts the bot command rules as a server's rights", () => {
        const draft = { ...saved, botCommandAccess: { x: { mode: "admins" } } };
        expect(accessPatch(draft, saved, "g1")).toMatchObject({ serverSettingsGuildId: "g1" });
    });

    it("sends nothing for an untouched draft", () => {
        expect(accessPatch(structuredClone(saved), saved, "g1")).toEqual({});
    });
});

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
