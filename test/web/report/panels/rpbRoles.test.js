// Role order, role attributes and the tool row of the RPB tables (src/web/report/panels/rpbRoles.js).
const { sortByRole, roleAttrs, rpbTools } = require("../../../../src/web/report/panels/rpbRoles");

describe("web/report/panels/rpbRoles", () => {
    const roles = { Tia: "Tank", Elun: "Healer", Zed: "Caster", Odd: "Pet" };

    it("sorts tanks, healers, casters, melee, then unknown roles, stable inside a role", () => {
        const rows = ["Brokk", "Zed", "Odd", "Elun", "Rex", "Tia"].map((name) => ({ name }));
        expect(sortByRole(rows, roles).map((r) => r.name)).toEqual(["Tia", "Elun", "Zed", "Brokk", "Rex", "Odd"]);
        expect(sortByRole(rows, null).map((r) => r.name)).toEqual(["Brokk", "Zed", "Odd", "Elun", "Rex", "Tia"]);
    });

    it("marks a row with its role, Physical for everyone unplaced, and escapes the name", () => {
        expect(roleAttrs(roles, "Tia")).toBe(" data-role=\"Tank\" data-name=\"Tia\"");
        expect(roleAttrs(undefined, "A\"B")).toBe(" data-role=\"Physical\" data-name=\"A&quot;B\"");
    });

    it("renders the role segment with counts for the roles present, the search and no orientation", () => {
        const html = rpbTools([{ name: "Tia" }, { name: "Brokk" }, { name: "Rex" }], roles, false);
        expect(html).toContain("<button type=\"button\" class=\"seg-btn active\" data-frole=\"all\">Alle<span class=\"n\">3</span></button>");
        expect(html).toContain("data-frole=\"Tank\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/inv_shield_06.jpg\" alt=\"\">Tanks<span class=\"n\">1</span></button>");
        expect(html).toContain("data-frole=\"Physical\">");
        expect(html).toContain("Nahkampf<span class=\"n\">2</span>");
        expect(html).not.toContain("data-frole=\"Healer\"");
        expect(html).toContain("<input type=\"search\" data-fsearch placeholder=\"Raider suchen …\" aria-label=\"Raider suchen\">");
        expect(html).not.toContain("data-orient");
    });

    it("adds the orientation buttons for the damage table", () => {
        const html = rpbTools([], {}, true);
        expect(html).toContain("<button type=\"button\" class=\"seg-btn active\" data-orient=\"p\" data-tip=\"Spieler als Zeilen\"");
        expect(html).toContain("data-orient=\"a\" data-tip=\"Fähigkeiten als Zeilen\"");
        expect(html).toContain("Alle<span class=\"n\">0</span>");
    });
});
