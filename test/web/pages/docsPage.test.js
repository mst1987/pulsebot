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
                expect(html).toContain(`<span class="doc-card-title">${s.titleHtml}</span>`);
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

    it("gives every element a unique id (cards, sub-headings, sections)", () => {
        const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
        expect(ids.length).toBeGreaterThan(40);
        expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
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
        // Web pages: the menu's top-level paths, plus the raidplan share link
        // `/p/<token>` (docs/raidplan.md), which has no menu entry.
        const webPages = new Set([...menu.map((e) => e.href.split("/")[1]).filter(Boolean), "p"]);
        const spans = [...html.matchAll(/<code>\/([a-z0-9_-]+)(\/)?/g)].map((m) => ({ name: m[1], path: Boolean(m[2]) }));
        const commands = new Set(spans.map((s) => s.name));
        expect(commands.size).toBeGreaterThan(10);
        for (const { name, path: isPath } of spans) {
            // `/roster/r/<id>` must start with a web page; a bare `/kader` may be
            // a web page or a command; everything else is a registered command.
            const known = isPath ? webPages.has(name) : registered.includes(name) || webPages.has(name);
            expect({ name, isPath, known }).toEqual({ name, isPath, known: true });
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

        it("does not cache a page with a missing guide, retries the file and logs only once", () => {
            jest.isolateModules(() => {
                const realFs = jest.requireActual("fs");
                const log = require("../../../src/logger");
                const warn = jest.fn();
                jest.spyOn(log, "child").mockReturnValue({ warn, info: jest.fn(), error: jest.fn(), debug: jest.fn() });
                const isDiscord = (p) => String(p).endsWith("guide-discord.md");
                let missing = true;
                const original = realFs.readFileSync;
                const read = jest.spyOn(realFs, "readFileSync").mockImplementation((p, ...rest) => {
                    if (missing && isDiscord(p)) throw new Error("ENOENT");
                    return original.call(realFs, p, ...rest);
                });
                try {
                    const page = require("../../../src/web/pages/docsPage");
                    const first = page.renderDocsPage(null);
                    expect(first).toContain("gerade nicht verfügbar");
                    expect(first).toContain("id=\"web-admin-roster\"");
                    page.renderDocsPage(null);
                    expect(read.mock.calls.filter(([p]) => isDiscord(p))).toHaveLength(2);
                    expect(warn).toHaveBeenCalledTimes(1);

                    missing = false;
                    const back = page.renderDocsPage(null);
                    expect(back).not.toContain("gerade nicht verfügbar");
                    expect(back).toContain("id=\"discord-anmeldung\"");
                    page.renderDocsPage(null);
                    // Complete now, so it is cached: no further read of the file.
                    expect(read.mock.calls.filter(([p]) => isDiscord(p))).toHaveLength(3);
                } finally {
                    read.mockRestore();
                    log.child.mockRestore();
                }
            });
        });
    });
});
