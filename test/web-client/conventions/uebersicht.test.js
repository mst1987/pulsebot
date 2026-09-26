// The start page "Übersicht" (design issue #220) — the structural half of the
// former test/web-client/uebersicht.test.js (#435). What the page, the
// Raid-Details modal and the Latest-Loot list show is tested in Vitest:
// src/web-client/src/pages/DashboardPage.test.tsx and
// src/web-client/src/components/TopLootList.test.tsx.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8");

describe("Übersicht (DashboardPage)", () => {
    const page = read("pages", "DashboardPage.tsx");

    it("is built from the shared blocks and WoW icons, not line icons", () => {
        for (const block of ["PageHead", "PartHead", "Badge", "IconTile", "WowIcon", "Button"]) {
            expect(page).toContain(`<${block}`);
        }
        expect(page).not.toMatch(/ClaIcon|ClockIcon|BoltIcon|RecruitmentIcon/);
    });

    it("keeps its styles in its own file", () => {
        expect(page).toContain("import \"../styles/uebersicht.css\";");
        const css = read("styles", "uebersicht.css");
        expect(css).toMatch(/\.ov-grid-top \{/);
        expect(css).not.toMatch(/gold|#ffd700|goldenrod/i);
    });
});
