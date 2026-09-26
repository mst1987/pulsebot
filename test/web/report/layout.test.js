// The page shell of the report pages (src/web/report/layout.js): esc, the
// layout, the admin/public shell, the login bar and the 404/error pages.
const { esc, themeToggleBtn, layout, shellPage, authBar, renderNotFound, renderError } = require("../../../src/web/report/layout");
const { assetUrl } = require("../../../src/web/report/assets");

describe("web/report/layout", () => {
    describe("esc", () => {
        it("escapes the five HTML characters", () => {
            expect(esc("<a href=\"x\">'&'</a>")).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
        });

        it("turns null and undefined into an empty string and stringifies numbers", () => {
            expect(esc(null)).toBe("");
            expect(esc(undefined)).toBe("");
            expect(esc(0)).toBe("0");
        });
    });

    it("renders the theme toggle button", () => {
        expect(themeToggleBtn()).toBe("<button class=\"theme-toggle\" id=\"themeBtn\" type=\"button\" aria-label=\"Design umschalten\" data-tip=\"Hell / Dunkel umschalten\"></button>");
    });

    describe("layout", () => {
        it("wraps the body in the centered column with the footer and links the report assets", () => {
            const html = layout("Titel <x>", "<p>Body</p>");
            expect(html).toMatch(/^<!DOCTYPE html>\n<html lang="de">/);
            expect(html).toContain("<title>Titel &lt;x&gt;</title>");
            expect(html).toContain(`<link rel="stylesheet" href="${assetUrl("report.css")}">`);
            expect(html).toContain(`<script src="${assetUrl("report.js")}"></script>`);
            expect(html).toContain("<div class=\"wrap\">\n<p>Body</p>\n<footer>EventHelper · Log-Check · Tooltips by Wowhead</footer>\n</div>");
            expect(html).toContain("<body>\n");
            expect(html).toContain("iconizeLinks:false,renameLinks:false");
            expect(html).not.toContain("<style>");
        });

        it("drops the wrapper when bare and adds the extra style, body class and Wowhead iconizing", () => {
            const html = layout("T", "<main>x</main>", { bare: true, extraStyle: ".x{}", bodyClass: "dark", wowheadIconize: true });
            expect(html).not.toContain("<div class=\"wrap\">");
            expect(html).not.toContain("<footer>");
            expect(html).toContain("<style>\n.x{}\n</style>");
            expect(html).toContain("<body class=\"dark\">\n<main>x</main>");
            expect(html).toContain("iconizeLinks:true,renameLinks:true");
        });
    });

    describe("authBar", () => {
        it("offers the Discord login to an anonymous visitor", () => {
            const html = authBar(null);
            expect(html).toMatch(/^<a class="discord-btn" href="\/auth\/login"><svg/);
            expect(html).toContain("<span>Mit Discord einloggen</span></a>");
        });

        it("names a logged-in user and links logout, plus the guild menu for an admin", () => {
            const member = authBar({ name: "Mo<b>" });
            expect(member).toContain("Eingeloggt als <strong>Mo&lt;b&gt;</strong> · <a class=\"mlink\" href=\"/auth/logout\">Logout</a>");
            expect(member).not.toContain("Gildenmenü");
            expect(authBar({ name: "Lead", isAdmin: true })).toContain("<a class=\"mlink\" href=\"/\">Gildenmenü</a>");
        });
    });

    describe("shellPage", () => {
        it("puts the public header around the body for a visitor", () => {
            const html = shellPage("Report", { user: null, body: "<p id=\"b\">x</p>" });
            expect(html).toContain("<header class=\"pubbar\">");
            expect(html).toContain("<div class=\"pubbar-sub\">Log-Check</div>");
            expect(html).toContain("</header><p id=\"b\">x</p>");
            expect(html).toContain("<div class=\"wrap\">");
            expect(html).toContain("Mit Discord einloggen");
        });

        it("wraps an admin's page in the admin chrome with the crumbs, bare and with the chrome style", () => {
            const html = shellPage("Report", { user: { id: "u1", name: "Lead", isAdmin: true }, body: "<p id=\"b\">x</p>", crumbs: [{ label: "Mein Raid" }] });
            expect(html).not.toContain("<header class=\"pubbar\">");
            expect(html).not.toContain("<div class=\"wrap\">");
            expect(html).toContain("<p id=\"b\">x</p>");
            expect(html).toContain("Log-Auswertung");
            expect(html).toContain("Mein Raid");
            expect(html).toContain("<style>");
            expect(html).toContain("id=\"themeBtn\"");
        });
    });

    it("renders the 404 page with the public header", () => {
        const html = renderNotFound();
        expect(html).toContain("<title>Nicht gefunden</title>");
        expect(html).toContain("<h1 class=\"page-title\" style=\"margin-top:24px\">404</h1>");
        expect(html).toContain("<a class=\"mlink\" href=\"/\">Zur Übersicht</a>");
    });

    it("renders an error page with escaped title and message", () => {
        const html = renderError("Fehler <x>", "Etwas & so");
        expect(html).toContain("<title>Fehler &lt;x&gt;</title>");
        expect(html).toContain("<h1 class=\"page-title\" style=\"margin-top:24px\">Fehler &lt;x&gt;</h1><p class=\"sub\">Etwas &amp; so</p>");
        expect(html).toContain("<a class=\"mlink\" href=\"/auth/login\">Erneut einloggen</a>");
    });
});
