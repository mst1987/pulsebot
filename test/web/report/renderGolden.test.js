// Golden master for the log-check report pages (#423). The HTML below was
// captured from render.js before it was split into src/web/report/ and before
// its CSS and client JS moved to /r-assets/. The pages must stay identical to
// it apart from how the styles and scripts are delivered, so inline <style>
// and <script> blocks and the /r-assets/ tags are stripped on both sides.
//
// The inputs are real fixtures of the render*.test.js suites, picked so that
// together they cover every class, tag and data attribute those suites render.
// A deliberate change to the pages' markup regenerates the expected files:
//   UPDATE_GOLDEN=1 npx jest test/web/report/renderGolden.test.js
const fs = require("fs");
const path = require("path");
const render = require("../../../src/web/report/render.js");

const DIR = path.join(__dirname, "..", "..", "fixtures", "reportGolden");
const cases = JSON.parse(fs.readFileSync(path.join(DIR, "cases.json"), "utf8"));

function strip(html) {
    return html
        .replace(/\s*<style>[\s\S]*?<\/style>/g, "")
        .replace(/\s*<script>[\s\S]*?<\/script>/g, "")
        .replace(/\s*<link rel="stylesheet" href="\/r-assets\/[^"]*">/g, "")
        .replace(/\s*<script src="\/r-assets\/[^"]*"( defer)?><\/script>/g, "");
}

function check(name, html) {
    const file = path.join(DIR, `${name}.html`);
    const actual = strip(html);
    if (process.env.UPDATE_GOLDEN) fs.writeFileSync(file, actual);
    // a Windows checkout (core.autocrlf) hands the fixture back with CRLF
    expect(actual).toBe(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
}

describe("web/report/render — golden master", () => {
    it.each(cases.map((c) => [c.name, c]))("renders %s as before", (name, c) => {
        const args = c.args.map((a) => (a === null ? undefined : a));
        check(name, render[c.fn](...args));
    });

    it("renders the not-found and the error page as before", () => {
        check("not-found", render.renderNotFound());
        check("error", render.renderError("Fehler <x>", "Etwas ging schief & so"));
    });

    it("ships the former inline style block as /r-assets/report.css, rule for rule", () => {
        const rules = (css) => css.replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
        const before = fs.readFileSync(path.join(DIR, "layout-style.css"), "utf8");
        const now = fs.readFileSync(path.join(__dirname, "..", "..", "..", "src", "web", "static", "report.css"), "utf8");
        expect(rules(now)).toBe(rules(before));
    });

    it("renders the bare shell as before", () => {
        check("layout", render.layout("Titel", "<p>Inhalt</p>"));
        check("layout-bare", render.layout("Titel", "<main>x</main>", { bare: true, bodyClass: "dark", wowheadIconize: true, extraStyle: ".x{}" }));
    });
});
