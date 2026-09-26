// Conventions of the Raid-Events module (design issue #222): what a render test
// cannot see. The behaviour of the list, the create dialog and the Aufruf-Vorlagen
// is tested in Vitest next to the components (pages/RaidsPage.test.tsx,
// components/raid-create/RaidCreateDialog.test.tsx, pages/NotifyTemplatesPage.test.tsx).
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8");

const page = read("pages", "RaidsPage.tsx");
const notify = read("pages", "NotifyTemplatesPage.tsx");
const css = read("styles", "raid-events.css");

const MODULE_FILES = {
    page,
    notify,
    list: read("components", "RaidList.tsx"),
    dialog: read("components", "raid-create"),
    templates: read("pages", "RaidTemplatesPage.tsx"),
    createPage: read("pages", "RaidCreatePage.tsx"),
    icons: read("lib", "raidIcons.ts"),
    time: read("lib", "raidTime.ts"),
    icon: read("components", "RaidIcon.tsx"),
};

describe("Raid-Events module hygiene", () => {
    it("uses no native title tooltips and no emoji as icons", () => {
        for (const [name, src] of Object.entries(MODULE_FILES)) {
            expect({ name, title: /<(span|div|a|button|label|input|img|li|svg)\b[^>]*\stitle=/.test(src) }).toEqual({ name, title: false });
            expect({ name, emoji: /[＋\u{1F300}-\u{1FAFF}]/u.test(src) }).toEqual({ name, emoji: false });
        }
    });

    it("styles the module in its own stylesheet, without gold", () => {
        expect(page).toContain("import \"../styles/raid-events.css\";");
        expect(notify).toContain("import \"../styles/raid-events.css\";");
        expect(css).not.toMatch(/:\s*gold\b|goldenrod|#d4af37|#ffd700/i);
        expect(read("index.css")).not.toContain(".re-row");
    });
});
