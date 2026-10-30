// The menu's one loading state (components/ui/layout/RaidLoader.tsx): a party at a
// raid boss instead of the grey "Lade…". What is guarded here is that it stays
// the ONLY one — a page that quietly goes back to its own placeholder is the
// regression this file exists for — and that it invents no icons.
const fs = require("fs");
const path = require("path");

const { CLIENT, read, sourceFiles } = require("../clientSource");

/** Every .tsx of the client, so a new page cannot slip past this. */
const tsxFiles = () => sourceFiles("", /\.tsx$/);

const loader = read("components", "ui", "layout", "RaidLoader.tsx");
const css = read("index.css");

describe("RaidLoader", () => {
    it("is what every page shows while it waits", () => {
        const offenders = tsxFiles()
            .filter((f) => /Lade…|Lade\.\.\./.test(fs.readFileSync(f, "utf8")))
            .map((f) => path.relative(CLIENT, f))
            // the component's own default text and the comment explaining it
            .filter((f) => f !== path.join("components", "ui", "layout", "RaidLoader.tsx"));
        expect(offenders).toEqual([]);
        for (const page of ["history/HistoryPage", "roster/RosterCharsPage", "settings/SettingsPage", "ChannelsPage", "raids/RaidsPage", "cla/ClaPage", "recruitment/RecruitmentPage", "dashboard/DashboardPage"]) {
            expect({ page, uses: read("pages", `${page}.tsx`).includes("<RaidLoader") }).toEqual({ page, uses: true });
        }
    });

    it("has no full-page overlay any more: long operations run as background jobs", () => {
        expect(fs.existsSync(path.join(CLIENT, "components", "ui", "PageLoader.tsx"))).toBe(false);
        expect(css).not.toContain(".page-loader");
        expect(css).not.toContain(".pl-rune");
    });

    it("draws a raid's end boss with the icon the menu already checked, other bosses with a boss icon", () => {
        // the bosses per version live in lib/wow/loaderBosses.ts (no TBC boss in the Forever part)
        expect(loader).toContain("from \"../../../lib/wow/loaderBosses\";");
        expect(loader).toContain("<WowIcon name={boss.icon}");
        const bosses = read("lib", "wow", "loaderBosses.ts");
        expect(bosses).toContain("import { RAID_CONTENTS } from \"./raidIcons\";");
        // a raid's end boss by the content id it belongs to: the raid's own icon
        const keys = [...bosses.matchAll(/endBoss\("([\w-]+)"/g)].map((m) => m[1]);
        const known = read("lib", "wow", "raidIcons.ts");
        for (const key of keys) {
            const entry = /^[a-z0-9]+$/.test(key) ? `    ${key}: content("${key}"` : `    "${key}": content("${key}"`;
            expect({ key, known: known.includes(entry) }).toEqual({ key, known: true });
        }
        expect(keys.length).toBeGreaterThan(10);
        // the bosses beyond them (Classic's dungeons, Naxxramas' wings): achievement boss icons,
        // each checked against the CDN by hand (docs/web-admin.md), a typo shows WowIcon's question mark
        const icons = [...bosses.matchAll(/icon: "([^"]+)"/g)].map((m) => m[1]);
        for (const icon of icons) expect({ icon, ok: /^achievement_boss_[a-z0-9_]+$/.test(icon) }).toEqual({ icon, ok: true });
    });

    it("is decorative: a status role, empty alt icons and no motion when that is switched off", () => {
        expect(loader).toContain("role=\"status\"");
        expect(loader).toContain("aria-hidden=\"true\"");
        expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n\s+\.rl-icon, \.rl-clash/);
    });
});
