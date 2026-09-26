// The brand block top-left of the sidebar (crest + "EventHelper") is the way
// back to the dashboard. It used to be a plain div, so the one spot every app
// trains people to click for "home" did nothing.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const shellSrc = fs.readFileSync(path.join(CLIENT, "components", "Shell.tsx"), "utf8");
const css = fs.readFileSync(path.join(CLIENT, "index.css"), "utf8");

describe("brand link", () => {
    it("takes the crest to the site root, where the dashboard lives", () => {
        // "/" renders the dashboard, or App.tsx's redirect to the first section
        // the account may open — so the brand never needs to know either.
        const brand = shellSrc.match(/<Link className="brand"[\s\S]*?<div className="crest">/);
        expect(brand).not.toBeNull();
        expect(brand[0]).toContain("to=\"/\"");
        expect(brand[0]).toContain("aria-label=");
        expect(shellSrc).toContain("</Link>");
    });

    it("closes the mobile menu on the click, like a nav item", () => {
        const brand = shellSrc.match(/<Link className="brand"[\s\S]*?<div className="crest">/)[0];
        expect(brand).toContain("setMenuOpen(false)");
    });

    it("keeps the block's look — no link colour, no underline", () => {
        const rule = css.match(/\n\.brand \{([^}]*)\}/)[1];
        expect(rule).toContain("color: inherit");
        expect(rule).toContain("text-decoration: none");
        // ...but it does answer the pointer, so it reads as clickable.
        expect(css).toMatch(/\.brand:hover \.crest/);
    });
});
