// The Markdown subset of the end-user guides (#474): what the help page /docs
// renders, and that nothing from a guide reaches the page unescaped.
const { parseGuide, parseBlocks, renderInline, slugify } = require("../../../src/web/pages/guideMarkdown");

const toHash = (href) => ({ href: `#x-${href}` });

describe("guideMarkdown", () => {
    describe("slugify", () => {
        it("builds GitHub's heading anchors, the ones the guides link to", () => {
            expect(slugify("Übersicht & Nachschlagen")).toBe("übersicht--nachschlagen");
            expect(slugify("Log-Auswertung (CLA/RPB)")).toBe("log-auswertung-clarpb");
            expect(slugify("Serien (wiederkehrende Events)")).toBe("serien-wiederkehrende-events");
            expect(slugify("Kanäle")).toBe("kanäle");
        });
    });

    describe("renderInline", () => {
        it("renders bold, italic and code", () => {
            expect(renderInline("**fett** und *schräg* mit `/raid <Event>`"))
                .toBe("<strong>fett</strong> und <em>schräg</em> mit <code>/raid &lt;Event&gt;</code>");
        });

        it("escapes raw HTML instead of passing it through", () => {
            expect(renderInline("<script>alert(1)</script> & \"x\"")).toBe("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;");
            expect(renderInline("**<b>x</b>**")).toBe("<strong>&lt;b&gt;x&lt;/b&gt;</strong>");
        });

        it("leaves asterisks inside code and lone ones alone", () => {
            expect(renderInline("`a*b*c` und 2 * 3")).toBe("<code>a*b*c</code> und 2 * 3");
        });

        it("resolves links, keeps the label only when there is no target, and escapes the href", () => {
            expect(renderInline("siehe [Roster](#roster)", toHash)).toBe("siehe <a href=\"#x-#roster\">Roster</a>");
            expect(renderInline("siehe [Roster](#roster)", () => null)).toBe("siehe Roster");
            expect(renderInline("[x](y)")).toBe("x");
            expect(renderInline("[x](y)", () => ({ href: "a\"b", external: true })))
                .toBe("<a href=\"a&quot;b\" target=\"_blank\" rel=\"noopener noreferrer\">x</a>");
        });

        it("renders bold and code inside a link label", () => {
            expect(renderInline("[**`/raids`** öffnen](#a)", toHash)).toBe("<a href=\"#x-#a\"><strong><code>/raids</code></strong> öffnen</a>");
        });
    });

    describe("forged placeholders (NUL in the input, #474 review)", () => {
        const passThrough = (href) => ({ href, external: /^https?:/.test(href) });

        it("cannot smuggle one link's HTML into another link's href", () => {
            const html = renderInline("[a](#\u00001\u0000) [b](https://x.de/onmouseover=location='javascript:alert%281%29'//)", passThrough);
            expect(html).not.toContain("\u0000");
            // Every href is one quoted attribute without a stray quote or tag inside.
            for (const [, href] of html.matchAll(/href="([^"]*)"/g)) expect(href).not.toMatch(/[<>]/);
            expect(html).toBe("<a href=\"#1\">a</a> <a href=\"https://x.de/onmouseover=location=&#39;javascript:alert%281%29&#39;//\" target=\"_blank\" rel=\"noopener noreferrer\">b</a>");
        });

        it("never loops on a self-referencing placeholder", () => {
            expect(renderInline("`\u00000\u0000`")).toBe("<code>0</code>");
        }, 2000);

        it("drops a NUL instead of printing undefined", () => {
            expect(renderInline("x \u00005\u0000 y")).toBe("x 5 y");
            expect(parseBlocks("a\u0000b").blocks).toEqual([{ type: "para", text: "ab" }]);
        });

        it("keeps a code span in a link target as text, never inside the href", () => {
            expect(renderInline("[x](#`a`)", toHash)).toBe("[x](#<code>a</code>)");
        });
    });

    describe("parseBlocks", () => {
        it("splits headings, paragraphs and lists; a line under a list item continues it", () => {
            const { title, blocks } = parseBlocks("# Titel\n\nZeile eins\nZeile zwei\n\n## Teil\n- a\n  weiter\n- b\n\n1. eins\n2. zwei\n");
            expect(title).toBe("Titel");
            expect(blocks).toEqual([
                { type: "para", text: "Zeile eins Zeile zwei" },
                { type: "heading", level: 2, text: "Teil" },
                { type: "list", items: [{ indent: 0, ordered: false, text: "a weiter" }, { indent: 0, ordered: false, text: "b" }] },
                { type: "list", items: [{ indent: 0, ordered: true, text: "eins" }, { indent: 0, ordered: true, text: "zwei" }] },
            ]);
        });

        it("ends a paragraph where a list starts, and reads CRLF files", () => {
            const { blocks } = parseBlocks("Text:\r\n- a\r\n");
            expect(blocks.map((b) => b.type)).toEqual(["para", "list"]);
        });
    });

    describe("parseGuide", () => {
        const md = [
            "# Guide",
            "",
            "Intro mit **fett**.",
            "",
            "## Erster Teil",
            "",
            "Technik: [events.md](events.md)",
            "",
            "*Bereich \"Raids\"*",
            "",
            "- oben",
            "  - darunter",
            "    1. Schritt",
            "",
            "### Unterpunkt",
            "",
            "Text <b>roh</b>.",
            "",
            "## Zweiter Teil",
            "",
            "*Ein sehr langer kursiver Absatz, der kein Abzeichen sein soll, weil er zu lang ist*",
        ].join("\n");

        it("returns the intro and one section per ## heading with ids and the scope badge", () => {
            const g = parseGuide(md, { idPrefix: "g", resolveLink: toHash });
            expect(g.title).toBe("Guide");
            expect(g.intro).toEqual(["<p>Intro mit <strong>fett</strong>.</p>"]);
            expect(g.sections.map((s) => [s.id, s.slug, s.title, s.scope])).toEqual([
                ["g-erster-teil", "erster-teil", "Erster Teil", "Bereich \"Raids\""],
                ["g-zweiter-teil", "zweiter-teil", "Zweiter Teil", null],
            ]);
        });

        it("drops the developer pointers (Technik:) and nests lists", () => {
            const [first, second] = parseGuide(md).sections;
            expect(first.html).not.toContain("Technik");
            expect(first.html).toContain("<ul><li>oben<ul><li>darunter<ol><li>Schritt</li></ol></li></ul></li></ul>");
            expect(first.html).toContain("<h3 id=\"unterpunkt\">Unterpunkt</h3>");
            expect(first.html).toContain("<p>Text &lt;b&gt;roh&lt;/b&gt;.</p>");
            expect(second.html).toMatch(/^<p><em>Ein sehr langer/);
        });

        it("prefixes sub-heading ids with the guide", () => {
            expect(parseGuide(md, { idPrefix: "g" }).sections[0].html).toContain("<h3 id=\"g-unterpunkt\">");
        });

        it("renders section titles and badges inline (bold, code, links), escaped", () => {
            const g = parseGuide("## Mit `/raids` & **fett**\n\n*Nur `<Orga>`*\n\nText", { resolveLink: toHash });
            expect(g.sections[0].slug).toBe("mit-raids--fett");
            expect(g.sections[0].titleHtml).toBe("Mit <code>/raids</code> &amp; <strong>fett</strong>");
            expect(g.sections[0].scopeHtml).toBe("Nur <code>&lt;Orga&gt;</code>");
            expect(parseGuide(md).sections[1].scopeHtml).toBeNull();
        });
    });
});
