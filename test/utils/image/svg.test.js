// The SVG pieces of the drawn bot pictures (utils/image/svg.js): pure strings.
const { PALETTE, esc, num, text, rect, svgDocument } = require("../../../src/utils/image/svg");

describe("utils/image/svg", () => {
    it("escapes markup and drops characters XML does not allow", () => {
        expect(esc("<b>Tom & \"Jerry\" 'x'</b>")).toBe("&lt;b&gt;Tom &amp; &quot;Jerry&quot; &#39;x&#39;&lt;/b&gt;");
        expect(esc("a\u0000b\u0007c\u001fd")).toBe("abcd");
        expect(esc("Kalümbra")).toBe("Kalümbra");
        expect(esc(null)).toBe("");
        expect(esc(undefined)).toBe("");
    });

    it("writes numbers with at most two decimals", () => {
        expect(num(1.23456)).toBe("1.23");
        expect(num(4)).toBe("4");
        expect(num("x")).toBe("0");
    });

    it("draws a line of text with its attributes, escaped, cut to a width", () => {
        const plain = text(10, 20, "A & B");
        expect(plain).toBe(`<text x="10" y="20" font-size="16" fill="${PALETTE.text}">A &amp; B</text>`);
        const styled = text(5, 6, "Hi", { size: 20, bold: true, fill: "#fff", anchor: "middle", letterSpacing: 2, opacity: 0.5 });
        expect(styled).toContain("font-weight=\"700\"");
        expect(styled).toContain("text-anchor=\"middle\"");
        expect(styled).toContain("letter-spacing=\"2\"");
        expect(styled).toContain("opacity=\"0.5\"");
        expect(text(0, 0, "Averyveryverylongname", { maxWidth: 80 })).toMatch(/…<\/text>$/);
        expect(text(0, 0, "Wide", { maxWidth: 1 })).toBe("");
        expect(text(0, 0, "")).toBe("");
    });

    it("draws a rectangle, a border inside its box", () => {
        expect(rect(0, 0, 10, 20, { r: 3, fill: "#000" })).toBe("<rect x=\"0\" y=\"0\" width=\"10\" height=\"20\" rx=\"3\" fill=\"#000\"/>");
        const bordered = rect(0, 0, 10, 20, { stroke: "#f00", strokeWidth: 2 });
        expect(bordered).toContain("x=\"1\" y=\"1\" width=\"8\" height=\"18\"");
        expect(bordered).toContain("stroke=\"#f00\" stroke-width=\"2\"");
        expect(rect(0, 0, 1, 1, { opacity: 0.2 })).toContain("opacity=\"0.2\"");
    });

    it("wraps a body into a document with the bundled font and a background", () => {
        const doc = svgDocument(100, 50, "<g/>");
        expect(doc.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"50\"")).toBe(true);
        expect(doc).toContain("font-family=\"Noto Sans\"");
        expect(doc).toContain(`fill="${PALETTE.background}"`);
        expect(doc.endsWith("<g/></svg>")).toBe(true);
    });
});
