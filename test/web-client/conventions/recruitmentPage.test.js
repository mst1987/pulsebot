// Conventions of the Recruitment page (issue #215) that a render cannot show:
// its stylesheet, the CSS that keeps the tables' rows one line tall, the rule
// that explanations sit in tooltips, and the apply button's default label being
// the same in the preview and in the message the bot posts. What the page does
// is tested in src/web-client/src/pages/recruitment/RecruitmentPage.test.tsx (and the
// editor pieces next to DiscordPreview.tsx / EmojiPicker.tsx).
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const { read } = require("../clientSource");

// the page and its parts (pages/recruitment/, #438)
const page = read("pages", "recruitment");
const css = read("styles", "recruitment.css");

describe("Recruitment page conventions", () => {
    it("keeps explanations in tooltips, not in paragraphs under the heads and fields", () => {
        for (const [name, src] of [["RecruitmentPage.tsx", page], ["SpecPicker.tsx", read("pages", "recruitment", "SpecPicker.tsx")]]) {
            expect({ name, note: /className="note"/.test(src), hint: /className="hint"/.test(src) }).toEqual({ name, note: false, hint: false });
        }
    });

    // A Discord channel is called "🔎》recruitment" and its category
    // "「・」TBC Montag": with automatic columns the browser broke such a name
    // after every symbol and the row grew three lines tall.
    it("keeps the tables' columns fixed and every name on one line", () => {
        expect(css).toMatch(/\.rc-tbl table\.idx \{[^}]*table-layout: fixed/);
        expect(css).toMatch(/\.rc-tbl \.cname[^{]*\{[^}]*white-space: nowrap/);
        expect(css).toMatch(/\.rc-tbl \.cname[^{]*\{[^}]*text-overflow: ellipsis/);
        // Many wanted specs wrap inside their column instead of widening the table.
        expect(css).toMatch(/\.rc-specs \{[^}]*flex-wrap: wrap/);
    });

    it("styles itself in its own stylesheet, light and dark", () => {
        expect(page).toContain("import \"../../styles/recruitment.css\";");
        expect(css).toContain(".rc-editor");
        // light and dark for the Discord preview
        expect(css).toContain(":root[data-theme=\"light\"] .rc-page");
        expect(read("index.css")).not.toContain(".applist");
    });

    it("gives the preview's button the same default label as the message the bot posts", () => {
        const preview = read("pages", "recruitment", "DiscordPreview.tsx").match(/buttonLabel\.trim\(\) \|\| "([^"]+)"/);
        const bot = fs.readFileSync(path.join(ROOT, "src", "services", "discord", "discord.js"), "utf8").match(/template\.buttonLabel \|\| "([^"]+)"/);
        expect(preview).not.toBeNull();
        expect(bot).not.toBeNull();
        expect(preview[1]).toBe(bot[1]);
    });
});
