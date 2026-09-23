// Guards for the Raid-Detail page's new layout (design issue #219):
// src/web-client/src/pages/RaidDetailPage.tsx and pages/raid-detail/**.
//
// No React renderer here, so the invariants are checked in the source:
//   * three tabs instead of six, and the old ?tab= values still land somewhere,
//   * the head's progress bar and primary action come from the server payload
//     (src/web/raidDetailSteps.js, tested in test/web/raidDetailSteps.test.js),
//   * every form is a dialog, built on the shared blocks,
//   * no native title, no confirm(), no glyph or emoji as an icon,
//   * the page's CSS lives in its own file, not appended to index.css.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...p) => fs.readFileSync(path.join(CLIENT, ...p), "utf8");
const page = read("pages", "RaidDetailPage.tsx");

function moduleSources() {
    const out = [["pages/RaidDetailPage.tsx", page]];
    (function walk(dir) {
        for (const file of fs.readdirSync(dir)) {
            const full = path.join(dir, file);
            if (fs.statSync(full).isDirectory()) walk(full);
            else if (/\.tsx?$/.test(file)) out.push([path.relative(CLIENT, full).replace(/\\/g, "/"), fs.readFileSync(full, "utf8")]);
        }
    })(path.join(CLIENT, "pages", "raid-detail"));
    return out;
}

describe("raid detail layout", () => {
    it("has the tabs roster, loot, logs — plus the setup editor for an own event (#263)", () => {
        expect(page).toContain("const TABS: Tab[] = [\"roster\", \"setup\", \"plan\", \"loot\", \"logs\"];");
        expect(page).toContain("const tabs = TABS.filter((t) => (t !== \"setup\" && t !== \"plan\") || ownEvent);");
        // an old ?tab=setup of a Raid-Helper event still lands on the roster
        expect(page).toContain("const shown: Tab = (tab === \"setup\" || tab === \"plan\") && !ownEvent ? LEGACY_TABS.setup.tab : tab;");
        expect(page).toContain("usePersistedSearchParam<Tab>(\"raid-detail-tab\", \"tab\", \"roster\", TABS)");
    });

    it("maps the old tab links onto the new tabs and dialogs", () => {
        const legacy = page.match(/const LEGACY_TABS[^=]*= \{([\s\S]*?)\n\};/)[1];
        expect(legacy).toContain("setup: { tab: \"roster\" }");
        expect(legacy).toContain("attendance: { tab: \"roster\" }");
        expect(legacy).toContain("actions: { tab: \"roster\", modal: \"notify\" }");
        expect(legacy).toContain("softres: { tab: \"roster\", modal: \"softres\" }");
        // the dialog opens from the first render, and the url is rewritten
        expect(page).toContain("useState<RaidDetailModal | null>(legacy?.modal || null)");
        expect(page).toContain("if (legacy) switchTab(legacy.tab);");
    });

    it("draws the progress bar and the primary action from the payload", () => {
        const hero = read("pages", "raid-detail", "RaidDetailHero.tsx");
        expect(hero).toContain("data.progress.steps.map((s) => <StepCell");
        // a cancelled own event (#288) pushes no next step — and an own event's
        // step bar (#319) carries the one deed itself, so the head keeps quiet
        expect(hero).toContain("const primary = cancelled || cockpit ? null : data.progress?.primary || null;");
        // a step is a button that opens its dialog or tab
        expect(hero).toContain("onClick={() => onOpen(step)}");
        expect(page).toMatch(/if \(step\.open\.modal\) setModal\(step\.open\.modal\);\s*else if \(step\.open\.tab\) switchTab\(step\.open\.tab\);/);
        // the old KPI strip and avatar row are gone
        expect(page).not.toMatch(/OverviewStats|RosterAvatars|HeaderActions/);
    });

    it("opens every form as a dialog", () => {
        for (const modal of ["NotifyModal", "SheetModal", "SoftresModal", "PingModal", "PlayerModal", "LootAddModal", "LogAssignModal"]) {
            const src = read("pages", "raid-detail", "modals", `${modal}.tsx`);
            expect({ modal, usesModal: src.includes("<Modal") }).toEqual({ modal, usesModal: true });
            expect(page).toContain(`<${modal} ctx={ctx}`);
        }
        // and no form sits open on a tab anymore
        for (const tab of ["RosterTab", "LootTab", "LogsTab"]) {
            expect({ tab, form: /<form\b/.test(read("pages", "raid-detail", `${tab}.tsx`)) }).toEqual({ tab, form: false });
        }
    });

    it("uses the shared blocks instead of hand-rolled heads and buttons", () => {
        for (const tab of ["RosterTab", "LootTab", "LogsTab"]) {
            const src = read("pages", "raid-detail", `${tab}.tsx`);
            expect(src).toContain("<PartHead");
            expect(src).not.toMatch(/className="btn[ "]/);
        }
        expect(read("pages", "raid-detail", "LootTab.tsx")).toContain("<Expand open={open}");
        expect(read("pages", "raid-detail", "RosterTab.tsx")).toContain("<Expand open={missingOpen}");
    });

    it("carries no native title, no confirm() and no glyph icons", () => {
        for (const [name, src] of moduleSources()) {
            // `title` on a component (<Modal title>, <PartHead title>) is a prop;
            // on an HTML element it would be the browser's own tooltip.
            expect({ name, title: /<[a-z][a-z0-9]*\s[^<>]*\btitle=/.test(src) }).toEqual({ name, title: false });
            expect({ name, confirm: /(^|[^\w.])confirm\(/.test(src) }).toEqual({ name, confirm: false });
            expect({ name, glyph: /[✕×↗🎉]/u.test(src) }).toEqual({ name, glyph: false });
        }
    });

    it("keeps its styles in its own file", () => {
        expect(page).toContain("import \"../styles/raid-detail.css\";");
        const css = read("styles", "raid-detail.css");
        expect(css).toMatch(/\n\.rd-steps \{/);
        expect(css).not.toMatch(/:\s*gold\b|goldenrod|#d4af37|#ffd700/i);
        expect(read("index.css")).not.toContain(".rd-steps");
    });

    it("lists the instances of a softres list with WoW icons", () => {
        const meta = read("pages", "raid-detail", "meta.ts");
        for (const code of ["kara", "gruul", "magtheridon", "za", "ssc", "tempestkeep", "blacktemple", "hyjal", "sunwellplateau"]) {
            expect(meta).toMatch(new RegExp(`\\b${code}: "[a-z0-9_'-]+"`));
        }
        expect(read("pages", "raid-detail", "modals", "SoftresModal.tsx")).toContain("INSTANCE_ICONS[i.code]");
    });
});
