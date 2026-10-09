// Conventions of the Raid-Events module (design issue #222): what a render test
// cannot see. The behaviour of the list, the create dialog and the Aufruf-Vorlagen
// is tested in Vitest next to the components (pages/raids/RaidsPage.test.tsx,
// components/raid-create/RaidCreateDialog.test.tsx, pages/NotifyTemplatesPage.test.tsx).
// a folder reads as all of its sources (components/raid-create/, #438)
const { read } = require("../clientSource");

const page = read("pages", "raids", "RaidsPage.tsx");
const notify = read("pages", "NotifyTemplatesPage.tsx");
const css = read("styles", "raid-events.css");

const MODULE_FILES = {
    page,
    notify,
    list: read("pages", "raids", "RaidList.tsx"),
    dialog: read("components", "raid-create"),
    templates: read("pages", "RaidTemplatesPage.tsx"),
    createPage: read("pages", "RaidCreatePage.tsx"),
    icons: read("lib", "wow", "raidIcons.ts"),
    time: read("lib", "raids", "raidTime.ts"),
    icon: read("components", "raid", "RaidIcon.tsx"),
};

describe("Raid-Events module hygiene", () => {
    it("uses no native title tooltips and no emoji as icons", () => {
        for (const [name, src] of Object.entries(MODULE_FILES)) {
            expect({ name, title: /<(span|div|a|button|label|input|img|li|svg)\b[^>]*\stitle=/.test(src) }).toEqual({ name, title: false });
            expect({ name, emoji: /[＋\u{1F300}-\u{1FAFF}]/u.test(src) }).toEqual({ name, emoji: false });
        }
    });

    it("styles the module in its own stylesheet, without gold", () => {
        expect(page).toContain("import \"../../styles/raid-events.css\";");
        expect(notify).toContain("import \"../styles/raid-events.css\";");
        // The dialog loads it itself: "Bearbeiten" opens it on the raid detail
        // page, which never loads RaidsPage's chunk — it rendered bare there.
        expect(read("components", "raid-create", "RaidCreateDialog.tsx")).toContain("import \"../../styles/raid-events.css\";");
        expect(css).not.toMatch(/:\s*gold\b|goldenrod|#d4af37|#ffd700/i);
        expect(read("index.css")).not.toContain(".re-row");
    });
});
