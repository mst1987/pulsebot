// The menu's one loading state (components/ui/RaidLoader.tsx): a party at a
// raid boss instead of the grey "Lade…". What is guarded here is that it stays
// the ONLY one — a page that quietly goes back to its own placeholder is the
// regression this file exists for — and that it invents no icons.
const fs = require("fs");
const path = require("path");

const { CLIENT, read, sourceFiles } = require("../clientSource");

/** Every .tsx of the client, so a new page cannot slip past this. */
const tsxFiles = () => sourceFiles("", /\.tsx$/);

const loader = read("components", "ui", "RaidLoader.tsx");
const css = read("index.css");

describe("RaidLoader", () => {
    it("is what every page shows while it waits", () => {
        const offenders = tsxFiles()
            .filter((f) => /Lade…|Lade\.\.\./.test(fs.readFileSync(f, "utf8")))
            .map((f) => path.relative(CLIENT, f))
            // the component's own default text and the comment explaining it
            .filter((f) => f !== path.join("components", "ui", "RaidLoader.tsx"));
        expect(offenders).toEqual([]);
        for (const page of ["history/HistoryPage", "roster/RosterPage", "settings/SettingsPage", "ChannelsPage", "RaidsPage", "cla/ClaPage", "recruitment/RecruitmentPage", "DashboardPage"]) {
            expect({ page, uses: read("pages", `${page}.tsx`).includes("<RaidLoader") }).toEqual({ page, uses: true });
        }
    });

    it("is the same scene in the overlay of a long operation", () => {
        const overlay = read("components", "PageLoader.tsx");
        expect(overlay).toContain("import RaidLoader from \"./ui/RaidLoader\";");
        expect(overlay).toContain("<RaidLoader text={text || t(\"jobs.pageLoader.busy\")} />");
        // the old rune is gone from both the component and the stylesheet
        expect(overlay).not.toContain("pl-rune");
        expect(css).not.toContain(".pl-rune");
    });

    it("draws the boss with the icons the menu already checked, never a new name", () => {
        expect(loader).toContain("import { RAID_CONTENTS } from \"../../lib/raidIcons\";");
        expect(loader).toContain("RAID_CONTENTS[boss.key].icon");
        // the bosses the loader lists, by the content id each one belongs to
        const keys = [...loader.match(/const BOSSES[\s\S]*?\];/)[0].matchAll(/key: "(\w+)"/g)].map((m) => m[1]);
        const known = read("lib", "raidIcons.ts");
        for (const key of keys) expect({ key, known: known.includes(`    ${key}: {`) }).toEqual({ key, known: true });
        expect(keys.length).toBeGreaterThan(4);
    });

    it("is decorative: a status role, empty alt icons and no motion when that is switched off", () => {
        expect(loader).toContain("role=\"status\"");
        expect(loader).toContain("aria-hidden=\"true\"");
        expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n\s+\.rl-icon, \.rl-clash/);
    });
});
