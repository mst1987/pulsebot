import { describe, expect, it } from "vitest";
import { assignableRoles } from "../assignableRoles";
import { raiderRoleOptions } from "../categoryLifecycle";

const roles = [
    { id: "r1", name: "Raider" },
    { id: "m1", name: "MEE6", managed: true },
    { id: "m2", name: "Raid-Bot", managed: true },
    { id: "o1", name: "Orga", managed: false },
];

describe("assignableRoles (#745)", () => {
    it("leaves out the roles a bot or an integration owns", () => {
        expect(assignableRoles(roles).map((r) => r.id)).toEqual(["r1", "o1"]);
    });

    it("keeps a bot role that is already chosen, so a stored choice stays visible", () => {
        expect(assignableRoles(roles, ["m1"]).map((r) => r.id)).toEqual(["r1", "m1", "o1"]);
    });

    it("feeds the raider-role picker: a bot's role named 'raid' only while a category uses it", () => {
        expect(raiderRoleOptions(roles, {}).map((r) => r.id)).toEqual(["r1"]);
        expect(raiderRoleOptions(roles, { c1: ["m2"] }).map((r) => r.id)).toEqual(["m2", "r1"]);
    });
});
