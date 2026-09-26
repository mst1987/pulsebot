// Conventions of the roster and the character page (design issue #218) that a
// render cannot show: no glyph icons, their own stylesheet, the shared building
// blocks and the fixed-width attendance bar. What the pages do is tested in
// Vitest next to them: pages/roster/RosterPage.test.tsx, pages/history/HistoryCharPage.test.tsx,
// components/RosterCommon.test.tsx and lib/rosterCharakter.test.ts.
// (No native `title` anywhere is the client-wide guard in conventions/uiFoundation.test.js.)
const { read } = require("../clientSource");

// each page with its parts (#438)
const roster = read("pages/roster");
const charPage = ["HistoryCharPage.tsx", "CharHero.tsx", "GearSection.tsx", "ItemDetailModal.tsx", "AttendanceSection.tsx", "charGear.ts"]
    .map((f) => read("pages/history", f)).join("\n");
const FILES = {
    roster,
    charPage,
    common: read("components/RosterCommon.tsx"),
    kpis: read("components/RosterHero.tsx"),
    view: read("lib/rosterView.ts"),
};

describe("roster & character page: shared rules", () => {
    it.each(Object.keys(FILES))("%s uses no text glyph icons and no old list badges", (name) => {
        const src = FILES[name];
        expect(src).not.toMatch(/[✓✕↻↗←]/);
        expect(src).not.toMatch(/lbadge/);
    });

    it("keeps its styles in its own stylesheet, imported by both pages", () => {
        expect(roster).toContain("import \"../../styles/roster-charakter.css\";");
        expect(charPage).toContain("import \"../../styles/roster-charakter.css\";");
        // the replaced hero band, gear-issue cards and gear rows are gone from index.css
        const indexCss = read("index.css");
        for (const cls of [".stat-hero", ".stat-tile", ".gi-row", ".gear-row", ".char-hero"]) {
            expect(indexCss).not.toContain(cls);
        }
    });

    it("builds on the shared building blocks", () => {
        expect(roster).toMatch(/from "\.\.\/\.\.\/components\/ui"/);
        expect(charPage).toMatch(/from "\.\.\/\.\.\/components\/ui"/);
        expect(charPage).toContain("<Modal");
        expect(charPage).toContain("<PartHead");
        expect(roster).toContain("<Segment<RoleFilter>");
        expect(roster).toContain("<Expand");
    });

    it("draws attendance as a fixed-width bar, so a short label never makes a longer bar", () => {
        expect(read("styles/roster-charakter.css")).toMatch(/\.bar\.ros-bar \{ width: 188px;/);
    });
});
