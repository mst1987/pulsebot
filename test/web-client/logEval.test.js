// The log evaluation is what the CLA page is for — it has to be the first thing
// on it, on both tabs, with the CLA/RPB choice right there. Source scans, since
// the client has no React test renderer.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8");

describe("Log-Auswertung: finding it", () => {
    const page = read("pages", "ClaPage.tsx");

    it("is what the menu calls the page, in the SPA and in the SSR chrome", () => {
        expect(read("components", "Shell.tsx")).toContain('label: "Log-Auswertung", href: "/cla"');
        expect(page).toContain('<h1 className="page-title">Log-Auswertung</h1>');
        const chrome = fs.readFileSync(path.join(__dirname, "..", "..", "src", "web", "adminChrome.js"), "utf8");
        expect(chrome).toContain('label: "Log-Auswertung", href: "/cla"');
    });

    it("puts the evaluation card above the tab switch, so it is there on both tabs", () => {
        const card = page.indexOf("<NewEvaluationCard ");
        const tabs = page.indexOf('<div className="subnav" role="tablist">');
        expect(card).toBeGreaterThan(0);
        expect(tabs).toBeGreaterThan(card);
        // and not a second copy inside the reports tab
        expect(page).not.toContain("<h2>Neue Auswertung</h2>");
    });

    it("offers CLA + RPB, CLA only and RPB only, both halves by default", () => {
        expect(page).toMatch(/\{ key: "both", label: "CLA \+ RPB"[^}]*sections: \["cla", "rpb"\] \}/);
        expect(page).toMatch(/\{ key: "cla", label: "nur CLA"[^}]*sections: \["cla"\] \}/);
        expect(page).toMatch(/\{ key: "rpb", label: "nur RPB"[^}]*sections: \["rpb"\] \}/);
        expect(page).toContain('{ link: "", sections: "both" as SectionChoice }');
        expect(page).toContain("createReport(csrfToken, target, { force, sections: choice.sections })");
    });

    it("lets a detected log be evaluated as CLA + RPB in one click", () => {
        expect(page).toContain('onClick={() => onEvaluate("both")}');
        expect(page).toContain("const evaluateBoth = (l: LogRow) => {");
        // CLA first (it creates the page), then RPB into it, the force answer reused
        expect(page).toMatch(/evalLog\(csrfToken, l\.id, "cla", \{ force: f \}\)[\s\S]*evalLog\(csrfToken, l\.id, "rpb", \{ force \}\)/);
    });

    it("is one click from the dashboard", () => {
        expect(read("pages", "DashboardPage.tsx")).toContain('link="/cla" linkLabel="Log auswerten"');
    });
});
