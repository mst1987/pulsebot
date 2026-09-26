// Conventions of "Mein Profil" (#255) that a render cannot show: the route and
// menu entry, the shared page head and its own stylesheet, and the CSS rules
// (icon sizes, weekday colours in light and dark, the locked switch). What the
// page does is rendered in src/web-client/src/pages/ProfilePage.test.tsx,
// components/profile/AddCharacterDialog.test.tsx, api/profile.test.ts and
// pages/RosterPage.claims.test.tsx.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

const page = read("pages", "ProfilePage.tsx");
const dialog = read("components", "profile", "AddCharacterDialog.tsx");
const app = read("App.tsx");
const css = read("styles", "profil.css");

describe("ProfilePage conventions", () => {
    it("is routed under /profile for the signup area and listed in the menu", () => {
        expect(app).toMatch(/<Route path="profile" element=\{<Guard user=\{user\} areas=\{\["signup"\]\}><ProfilePage \/><\/Guard>\} \/>/);
        const { MENU } = require("../../../src/config/menu");
        expect(MENU.find((e) => e.id === "profile")).toMatchObject({ href: "/profile", areas: ["signup"] });
    });

    it("uses the shared page head and its own stylesheet, whose selectors stay in the pf- namespace", () => {
        expect(page).toMatch(/<PageHead[\s\S]*tone="profile"/);
        expect(page).toContain("import \"../styles/profil.css\";");
        for (const sel of css.replace(/\/\*[\s\S]*?\*\//g, "").match(/\.[a-z][\w-]*/g) || []) {
            expect(sel).toMatch(/^\.(pf-|wi$|kicker$|part-head$|ph-act$|field$|is-|switch)/);
        }
    });

    it("sizes every icon it asks for above the shared 18 px .wi in its stylesheet", () => {
        // WowIcon's size only picks the image; the shared `.wi` rule draws it at
        // 18 px unless the page's CSS says otherwise — the UI review found all
        // spec, role and "first character" icons shrunk to 18 px.
        const owners = { "pf-way": page, "pf-spec": page, "pf-role": page, "pf-chip": page, "pf-logrow": dialog, "pf-class": dialog };
        for (const [scope, source] of Object.entries(owners)) {
            expect(source).toContain(scope);
            expect(css).toMatch(new RegExp(`\\.${scope} \\.wi[^{]*\\{ width: \\d{2}px; height: \\d{2}px; \\}`));
        }
    });

    it("gives every weekday its own colour, readable in light and dark", () => {
        // The render test checks that buttons and summary tags carry data-day.
        for (const day of ["mo", "di", "mi", "do", "fr", "sa", "so"]) {
            expect(css).toMatch(new RegExp(`\\[data-day="${day}"\\] \\{ --day: #[0-9a-f]{6}; --day-dark: #[0-9a-f]{6}; \\}`));
        }
        expect(css).toMatch(/:root\[data-theme="light"\] \.pf-day, :root\[data-theme="light"\] \.pf-day-tag \{ --day-ink: var\(--day-dark\); \}/);
    });

    it("shows a switch the class cannot use as not clickable", () => {
        expect(css).toMatch(/\.pf-role\.pf-role-off \{ cursor: not-allowed;/);
    });
});
