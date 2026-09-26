// Structural promises of the Kanäle page (design issue #216, Discord overview
// #259, threads #361) that a render test cannot see: the shared building
// blocks, the page's own namespaced stylesheet and its layout rules, no native
// titles. What the page does is tested in Vitest next to it
// (src/web-client/src/pages/ChannelsPage.*.test.tsx).
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

const page = read("pages", "ChannelsPage.tsx");
const css = read("styles", "kanaele.css");
const PARTS = ["ArchiveTab", "CategorySchemaDialog", "channelBits", "ChannelBulk", "ChannelDialogs", "ChannelEditDialog", "ChannelTree", "NamingBadge", "PurposeList", "QuickCreateDialog"];
const ALL = [page, ...PARTS.map((name) => read("components", "channels", `${name}.tsx`))].join("\n");

describe("ChannelsPage — conventions", () => {
    it("is built from the shared building blocks, not the old stacked forms", () => {
        expect(page).toMatch(/<PageHead[\s\S]*icon="inv_letter_15"/);
        expect(page).toContain("<Segment");
        expect(page).toContain("<SplitButton");
        expect(page).toContain("<RaidLoader");
        expect(page).not.toContain("card-form");
        expect(page).not.toMatch(/<h1 className="page-title"/);
    });

    it("keeps its styles in its own stylesheet, everything in it namespaced", () => {
        expect(page).toContain("import \"../styles/kanaele.css\";");
        // everything is namespaced, apart from the badge variants it adds
        const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/^[^@\s}][^{]*\{/gm) || [];
        expect(selectors.length).toBeGreaterThan(0);
        for (const sel of selectors) {
            expect(sel).toMatch(/\.kn-|\.badge\.(area|dashed)|a\.ibtn|button\.kn-/);
        }
    });

    it("pins the bulk bar to the viewport, one line wide", () => {
        expect(css).toMatch(/\.kn-bulk \{[\s\S]*position: fixed/);
        // left: 50% leaves the fixed bar half the viewport: without max-content its buttons wrap onto two lines.
        expect(css).toMatch(/\.kn-bulk \{[^}]*width: max-content/);
    });

    it("shows a category head's pencil on hover like the channel rows' icons", () => {
        expect(css).toContain(".kn-cat-row:hover .kn-row-icons");
    });

    it("indents a thread's row under its channel (#361)", () => {
        expect(css).toContain(".kn-row-thread { padding-left: 34px; }");
    });

    it("uses no native title on a DOM element and waits with the shared loader", () => {
        // the <Modal title> prop is its heading, not a native tooltip
        expect(ALL).not.toMatch(/<[a-z][a-z0-9]*\s[^>]*\btitle=/);
        expect(ALL).not.toMatch(/Lade…<\/div>/);
    });
});
