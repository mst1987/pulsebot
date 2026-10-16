// The in-app documentation page (#349), rendered from the two end-user guides
// since #474 (docs/guide-discord.md, docs/guide-web-admin.md). These tests run
// against the real guides: every section gets a card and a color, every link
// lands somewhere, and every slash command a guide names is registered.
const fs = require("fs");
const path = require("path");
const { renderDocsPage, guideBlock, guideSections, resolveLink, loadGuide, GUIDES, CAT, DOCS_DIR } = require("../../../src/web/pages/docsPage");
const { slugify } = require("../../../src/web/pages/guideMarkdown");
const { esc } = require("../../../src/web/report/render");
const menu = require("../../../src/config/menu.json");

const guideText = (g) => fs.readFileSync(path.join(DOCS_DIR, g.file), "utf8");
const h2Of = (text) => [...text.matchAll(/^## +(.+?)\s*$/gm)].map((m) => m[1]);

describe("docsPage", () => {
    const html = renderDocsPage(null);

    it("renders a full HTML page with both section anchors", () => {
        expect(html).toMatch(/^<!DOCTYPE html>/);
        expect(html).toContain("<h2 class=\"doc-section\" id=\"discord\">Discord-Befehle &amp; Abläufe</h2>");
        expect(html).toContain("<h2 class=\"doc-section\" id=\"web-admin\">Web-Admin-Bereiche</h2>");
    });

    it("renders one card per ## section of each guide (plus Grundlagen for an intro), colored with a defined token", () => {
        let expected = 0;
        for (const g of GUIDES) {
            const { sections } = guideSections(g, guideText(g));
            expect(sections.map((s) => s.title).filter((t) => t !== "Grundlagen")).toEqual(h2Of(guideText(g)));
            expected += sections.length;
            for (const s of sections) {
                expect(CAT[s.cat]).toEqual({ varName: expect.stringMatching(/^--(area|doc)-[a-z]+$/), label: expect.stringMatching(/\S/) });
                expect(html).toContain(`id="${esc(s.id)}" style="border-left-color:var(${CAT[s.cat].varName})"`);
                expect(html).toContain(`<span class="doc-card-title">${esc(s.title)}</span>`);
            }
        }
        expect((html.match(/<details class="card doc-card"/g) || []).length).toBe(expected);
    });

    it("gives every section of today's guides its own color (the fallback is only for new ones)", () => {
        for (const g of GUIDES) {
            for (const title of h2Of(guideText(g))) {
                expect({ guide: g.id, title, mapped: Boolean(g.sectionCat[slugify(title)]) }).toEqual({ guide: g.id, title, mapped: true });
            }
            for (const cat of Object.values(g.sectionCat)) expect(CAT[cat]).toBeDefined();
        }
    });

    it("shows content that was missing from the old hand-written copy", () => {
        for (const title of ["Kaderplaner", "Abwesenheiten", "Gildenbank", "Addons", "Neue Spielversion"]) {
            expect(html).toContain(`<span class="doc-card-title">${title}</span>`);
        }
        expect(html).toContain("Orga-Zentrale");
    });

    it("leaves out the developer pointers and never passes raw HTML from a guide", () => {
        expect(html).not.toMatch(/Technik:/);
        // `<Event>` and `<Name>` from the guides arrive escaped.
        expect(html).toContain("/raid &lt;Event&gt;");
        expect(html).not.toMatch(/<(Event|Name|token|id)>/);
    });

    it("lets every in-page link land on an element of the page", () => {
        const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
        const hashes = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
        expect(hashes.length).toBeGreaterThan(5);
        for (const h of hashes) expect({ h, found: ids.has(h) }).toEqual({ h, found: true });
    });

    it("opens links to the technical docs on GitHub, never as a dead relative link", () => {
        const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
        expect(hrefs.filter((h) => /\.md(#|$)/.test(h) && !h.startsWith("https://github.com/mst1987/pulsebot/blob/main/docs/"))).toEqual([]);
        expect(hrefs.some((h) => h.startsWith("https://github.com/mst1987/pulsebot/blob/main/docs/"))).toBe(true);
    });

    it("names only slash commands the bot registers, and only web pages the menu has (#418)", () => {
        const { loadCommandModules, commandDefinitions } = require("../../../src/commands/loader");
        const registered = commandDefinitions(loadCommandModules()).map((d) => d.name);
        const webPages = new Set(menu.map((e) => e.href.split("/")[1]).filter(Boolean));
        const mentioned = [...new Set([...html.matchAll(/<code>\/([a-z0-9_-]+)(\/)?/g)].map((m) => (m[2] ? `${m[1]}/` : m[1])))];
        expect(mentioned.length).toBeGreaterThan(10);
        for (const name of mentioned) {
            // `/roster/r/<id>` and a bare `/kader` are web pages, the rest are commands.
            const known = registered.includes(name) || webPages.has(name.replace(/\/$/, "")) || name.endsWith("/");
            expect({ name, known }).toEqual({ name, known: true });
        }
    });

    it("shows the login prompt for an anonymous visitor and the account for a logged-in one", () => {
        expect(html).toContain("Mit Discord einloggen");
        expect(html).not.toContain("Eingeloggt als");
        const user = renderDocsPage({ name: "Brokk", isAdmin: false });
        expect(user).toContain("Eingeloggt als");
        expect(user).toContain("Brokk");
    });

    it("keeps list markup balanced", () => {
        for (const tag of ["li", "ul", "ol", "p", "details"]) {
            expect((html.match(new RegExp(`<${tag}[ >]`, "g")) || []).length).toBe((html.match(new RegExp(`</${tag}>`, "g")) || []).length);
        }
    });

    describe("resolveLink", () => {
        it("keeps links inside and between the guides on the page", () => {
            expect(resolveLink("web-admin", "#roster")).toEqual({ href: "#web-admin-roster" });
            expect(resolveLink("web-admin", "guide-discord.md")).toEqual({ href: "#discord" });
            expect(resolveLink("discord", "guide-web-admin.md#kanäle")).toEqual({ href: "#web-admin-kanäle" });
        });

        it("sends other docs to GitHub, keeps http(s) links and drops anything else", () => {
            expect(resolveLink("discord", "events.md")).toEqual({ href: "https://github.com/mst1987/pulsebot/blob/main/docs/events.md", external: true });
            expect(resolveLink("discord", "game-versions.md#runbook")).toEqual({ href: "https://github.com/mst1987/pulsebot/blob/main/docs/game-versions.md#runbook", external: true });
            expect(resolveLink("discord", "https://example.org/x")).toEqual({ href: "https://example.org/x", external: true });
            expect(resolveLink("discord", "javascript:alert(1)")).toBeNull();
            expect(resolveLink("discord", "../src/bot.js")).toBeNull();
        });
    });

    describe("a missing guide", () => {
        it("reads null instead of throwing", () => {
            expect(loadGuide("guide-discord.md", path.join(DOCS_DIR, "does-not-exist"))).toBeNull();
            expect(loadGuide("guide-discord.md")).toMatch(/^# /);
        });

        it("renders a short notice instead of the cards", () => {
            const block = guideBlock(GUIDES[0], null);
            expect(block).toContain("id=\"discord\"");
            expect(block).toContain("gerade nicht verfügbar");
            expect(block).not.toContain("doc-card");
        });
    });
});
