// "Anmeldungen" (#256) — the structural half of the former
// test/web-client/signupsPage.test.js (#435): routing, the shared building
// blocks, the page's own stylesheet and its column grid, none of which a
// render in jsdom can show. What the page, the signup dialog, the bulk dialog
// and the roster show and send is tested in Vitest:
// src/web-client/src/pages/SignupsPage.test.tsx,
// src/web-client/src/components/signup/SignupDialog.test.tsx,
// src/web-client/src/pages/raid-detail/RosterTab.signups.test.tsx and
// src/web-client/src/api/signups.test.ts.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8");

const page = read("pages", "SignupsPage.tsx");
const css = read("styles", "anmeldung.css");

describe("SignupsPage", () => {
    it("is routed under /signups for the signup area and listed in the menu next to the profile", () => {
        expect(read("App.tsx")).toMatch(/<Route path="signups" element=\{<Guard user=\{user\} areas=\{\["signup"\]\}><SignupsPage \/><\/Guard>\} \/>/);
        const { MENU } = require("../../../src/config/menu");
        const ids = MENU.map((e) => e.id);
        expect(MENU.find((e) => e.id === "signups")).toMatchObject({ href: "/signups", areas: ["signup"], wowIcon: "inv_misc_book_09" });
        expect(Math.abs(ids.indexOf("signups") - ids.indexOf("profile"))).toBe(1);
    });

    it("uses the shared blocks and keeps its styles in its own file, every selector its own", () => {
        expect(page).toContain("<PageHead");
        expect(page).toContain("<RaidLoader");
        expect(page).toContain("import \"../styles/anmeldung.css\";");
        for (const sel of css.replace(/\/\*[\s\S]*?\*\//g, "").match(/\.[a-z][\w-]*/g) || []) {
            expect(sel).toMatch(/^\.(an-|wi$|field$|seg-opt$|is-on$|is-mine$)/);
        }
    });

    it("keeps status and action in columns of their own, shared by every row", () => {
        // a row as its own flex line put the bar wherever badge and button left room
        expect(page).toContain("<div className=\"an-state\">");
        expect(page).toContain("<div className=\"an-act\">");
        expect(page).toContain("<span className=\"an-bar\"");
        expect(css).toMatch(/\.an-list \{[^}]*grid-template-columns: 18px auto minmax\(0, 1fr\) auto auto auto;/);
        expect(css).toMatch(/\.an-group \{[^}]*grid-template-columns: subgrid;/);
        expect(css).toMatch(/\.an-row \{[^}]*grid-template-columns: subgrid;/);
    });
});
