// The Log-Auswertung page (design issue #217): what cannot be rendered. The
// list, the filters, the row actions and the dialogs are render tests next to
// the page (src/web-client/src/pages/ClaPage.*.test.tsx).
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const CLIENT = path.join(ROOT, "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8");

describe("Log-Auswertung: conventions", () => {
    it("is what the menu calls the page, in the SPA and in the SSR chrome", () => {
        // One list for both menus (src/config/menu.json), rendered by Shell.tsx and adminChrome.js.
        const menu = require("../../../src/config/menu.json");
        expect(menu.find((e) => e.id === "cla")).toMatchObject({ label: "Log-Auswertung", href: "/cla" });
        const chrome = fs.readFileSync(path.join(ROOT, "src", "web", "adminChrome.js"), "utf8");
        expect(chrome).toContain("require(\"../config/menu\")");
    });

    it("keeps its styles in its own file", () => {
        expect(read("pages", "ClaPage.tsx")).toContain("import \"../styles/log-auswertung.css\";");
        const css = read("styles", "log-auswertung.css");
        expect(css).toContain(".la-row.running { box-shadow: inset 3px 0 0 var(--accent); }");
        expect(css).toContain(".la-boss.miss { border-style: dashed;");
        expect(css).not.toMatch(/gold|#d4af37|#ffd700/i);
    });
});
