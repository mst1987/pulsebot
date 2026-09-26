// Conventions of the Einstellungen page that a render cannot show: every
// per-category setting has one home (the category matrix), and explanations sit
// in tooltips instead of hint paragraphs. What the sections, the section column
// and the save bar do is tested in src/web-client/src/lib/settingsSections.test.ts,
// components/SectionNav.test.tsx and pages/settings/SettingsPage.sections.test.tsx; the
// areas of Historie & Loot in pages/history/HistoryPage.areas.test.tsx.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const readClient = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

const settingsSrc = readClient("pages", "settings", "SettingsPage.tsx");

describe("Einstellungen conventions", () => {
    it("configures each per-category setting in exactly one place", () => {
        const matrix = readClient("components", "CategoryMatrix.tsx");
        for (const prop of ["categoryRoles", "categoryLootTool", "categorySheets"]) {
            expect(matrix).toContain(prop);
            const renderedElsewhere = settingsSrc.includes(`value={draft.${prop}}`);
            expect({ prop, renderedElsewhere }).toEqual({ prop, renderedElsewhere: false });
        }
        // Raider → Charakter is no longer a section with its own category picker.
        expect(settingsSrc).not.toContain("RaiderCharactersTab");
        expect(matrix).toContain("<RaiderCharactersModal");
    });

    it("turns the hint paragraphs into tooltips", () => {
        const files = {
            "SettingsPage.tsx": settingsSrc,
            "RolePermissions.tsx": readClient("components", "RolePermissions.tsx"),
            "CategoryMatrix.tsx": readClient("components", "CategoryMatrix.tsx"),
        };
        for (const [name, src] of Object.entries(files)) {
            expect({ name, hint: src.includes("className=\"hint\""), note: src.includes("<p className=\"note\">") })
                .toEqual({ name, hint: false, note: false });
        }
    });
});
