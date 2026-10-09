// The council's role vocabulary on the client (#669): every role the server
// sends has a name and an icon, and a set of another role is named for what it is.
import { describe, expect, it } from "vitest";
import { inLang } from "../../test/i18n";
import { ROLE_ICON, otherSetLabel, roleLabel } from "./council";

const ROLES = ["caster", "healer", "tank", "melee", "ranged"];

describe("lootcouncil/council roles", () => {
    it("names every council role in German and English", async () => {
        expect(ROLES.map((r) => roleLabel(r))).toEqual(["Caster", "Heiler", "Tank", "Nahkampf", "Fernkampf"]);
        expect(await inLang("en", () => ROLES.map((r) => roleLabel(r)))).toEqual(["Caster", "Healer", "Tank", "Melee", "Ranged"]);
    });

    it("gives every role an icon", () => {
        for (const role of ROLES) expect(ROLE_ICON[role]).toBeTruthy();
    });

    it("names a set of another role for what it is", () => {
        expect(otherSetLabel("healer")).toBe("Heilgear");
        expect(otherSetLabel("caster")).toBe("Caster-Gear");
        expect(otherSetLabel("tank")).toBe("Tank-Gear");
        expect(otherSetLabel("physical")).toBe("Nahkampf-Gear");
        // The server could not say: the neutral word.
        expect(otherSetLabel("")).toBe("andere Rolle");
    });
});
