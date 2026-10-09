// The role glyph (#559, "Ring und Linie"): one component for every role placeholder of the raid plan.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RoleGlyph from "./RoleGlyph";
import ClassRefIcon from "./ClassRefIcon";

const svgOf = (el: ReactElementLike) => render(el).container.querySelector("svg") as SVGSVGElement;
type ReactElementLike = Parameters<typeof render>[0];

describe("RoleGlyph", () => {
    it.each(["tank", "healer", "melee", "ranged", "dps", "group"])("draws %s as a line glyph in its own class", (role) => {
        const svg = svgOf(<RoleGlyph role={role} size={40} />);
        expect(svg.getAttribute("class")).toContain(`rp-glyph-${role}`);
        expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
        expect(svg.querySelectorAll("path").length).toBeGreaterThan(0);
        expect(svg.querySelector(".rp-glyph-disc")).not.toBeNull();
        expect(svg.querySelector("g")?.getAttribute("stroke-linecap")).toBe("round");
    });

    it("keeps the double ring for ranged only", () => {
        expect(svgOf(<RoleGlyph role="ranged" size={40} />).querySelectorAll("circle").length).toBe(2);
        expect(svgOf(<RoleGlyph role="melee" size={40} />).querySelectorAll("circle").length).toBe(1);
    });

    it("draws the healer as heart with a pulse line", () => {
        const d = Array.from(svgOf(<RoleGlyph role="healer" size={40} />).querySelectorAll("path")).map((p) => p.getAttribute("d"));
        expect(d).toHaveLength(2);
        expect(d[1]).toContain("M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27");
    });

    it("uses a thicker line at small sizes", () => {
        const width = (size: number) => Number(svgOf(<RoleGlyph role="tank" size={size} />).querySelector("g")?.getAttribute("stroke-width"));
        expect(width(24)).toBeGreaterThan(width(56));
        expect(width(30)).toBeGreaterThanOrEqual(2.4);
        expect(width(30)).toBeLessThanOrEqual(3);
    });

    it("takes the pixel size", () => {
        const svg = svgOf(<RoleGlyph role="melee" size={31} />);
        expect(svg.getAttribute("width")).toBe("31");
        expect(svg.getAttribute("height")).toBe("31");
    });

    it("bare draws no disc and no ring", () => {
        const svg = svgOf(<RoleGlyph bare role="ranged" size={20} />);
        expect(svg.querySelector("circle")).toBeNull();
        expect(svg.getAttribute("class")).toContain("is-bare");
    });

    it("is decoration without a label and named with one", () => {
        expect(svgOf(<RoleGlyph role="tank" />).getAttribute("aria-hidden")).toBe("true");
        const named = svgOf(<RoleGlyph role="tank" label="Tank" />);
        expect(named.getAttribute("role")).toBe("img");
        expect(named.getAttribute("aria-label")).toBe("Tank");
    });

    it("takes an unknown role for dps", () => {
        expect(svgOf(<RoleGlyph role="whatever" />).getAttribute("class")).toContain("rp-glyph-dps");
    });

    it("draws no colour of its own", () => {
        const html = render(<RoleGlyph role="healer" size={40} />).container.innerHTML;
        expect(html).not.toMatch(/#[0-9a-f]{3,6}\b/i);
        expect(html).not.toContain("style=");
    });
});

describe("ClassRefIcon", () => {
    it("shows the role glyph for a class-less reference and a WoW icon for a real class", () => {
        const any = render(<ClassRefIcon classId="Any" role="tank" size={20} />).container;
        expect(any.querySelector("svg.rp-glyph-tank")).not.toBeNull();
        const mage = render(<ClassRefIcon classId="Mage" role="dps" size={20} />).container;
        expect(mage.querySelector("svg")).toBeNull();
        expect(mage.querySelector("img.wi")).not.toBeNull();
    });
});

// the role placeholders of the raid plan draw their role with RoleGlyph, no longer with a WoW icon
describe("role placeholders", () => {
    const sources = import.meta.glob(
        [
            "../../components/raidplan/PlanBoard.tsx",
            "./editor/{Palette,Besetzung,AssignLine,AssignPanel,AssignModal,StepModal,ReadTables,AssignRosterModal}.tsx",
            "./editor/workspace/MapToolRow.tsx",
            "../../pages/raidplan/RaidplanTemplatesPage.tsx",
        ],
        { query: "?raw", import: "default", eager: true },
    ) as Record<string, string>;
    const NAMES = ["ability_warrior_defensivestance", "spell_holy_flashheal", "ability_dualwield", "inv_weapon_bow_07"];

    it("finds the files it checks", () => {
        expect(Object.keys(sources).length).toBe(11);
    });

    it.each(Object.keys(sources))("%s names no role WoW icon and uses no ROLE_ICON table", (file) => {
        for (const n of NAMES) expect(sources[file]).not.toContain(n);
        expect(sources[file]).not.toContain("ROLE_ICON[");
        expect(sources[file]).not.toContain("ROLE_ICONS");
    });

    it.each(["PlanBoard", "Palette", "Besetzung", "MapToolRow", "RaidplanTemplatesPage", "AssignLine", "ReadTables"])("%s draws with RoleGlyph", (name) => {
        const file = Object.keys(sources).find((f) => f.endsWith(`/${name}.tsx`)) as string;
        expect(sources[file]).toContain("RoleGlyph");
    });
});
