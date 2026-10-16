// SVG -> PNG for the drawn bot pictures (services/discord/discordImage.js): the real resvg with
// the bundled font, wrapped so a test can count the renders or make one fail.
jest.mock("@resvg/resvg-js", () => {
    const actual = jest.requireActual("@resvg/resvg-js");
    return { Resvg: jest.fn((svg, opts) => new actual.Resvg(svg, opts)) };
});
jest.mock("../../../src/logger", () => {
    const log = { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() };
    return { ...log, child: () => log };
});

const { Resvg } = require("@resvg/resvg-js");
const logger = require("../../../src/logger").child();
const { visualOn, renderPng, withImages, clearImageCache, CACHE_MAX } = require("../../../src/services/discord/discordImage");
const { svgDocument, text } = require("../../../src/utils/image/svg");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const svg = (label = "Kalümbra <&>") => svgDocument(120, 40, text(8, 28, label, { size: 20, bold: true }));

beforeEach(() => {
    clearImageCache();
    jest.clearAllMocks();
});

describe("services/discord/discordImage", () => {
    it("reads the switches: a picture is on unless set to false", () => {
        expect(visualOn({}, "setupImage")).toBe(true);
        expect(visualOn(null, "setupImage")).toBe(true);
        expect(visualOn({ discordVisuals: { setupImage: false } }, "setupImage")).toBe(false);
        expect(visualOn({ discordVisuals: { setupImage: false } }, "overviewWeekStrip")).toBe(true);
    });

    it("renders a PNG with the bundled font only - no system fonts", () => {
        const png = renderPng(svg());
        expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
        expect(png.readUInt32BE(16)).toBe(120); // IHDR width
        expect(png.readUInt32BE(20)).toBe(40);
        const opts = Resvg.mock.calls[0][1];
        expect(opts.font.loadSystemFonts).toBe(false);
        expect(opts.font.fontFiles).toHaveLength(2);
        expect(opts.font.defaultFontFamily).toBe("Noto Sans");
        expect(logger.debug).toHaveBeenCalledWith(expect.stringMatching(/rendered in [\d.]+ ms/));
    });

    it("draws the text: a picture with a name differs from one without", () => {
        const withName = renderPng(svgDocument(120, 40, text(8, 28, "Zibbo", { size: 20 })));
        const empty = renderPng(svgDocument(120, 40, ""));
        expect(withName.equals(empty)).toBe(false);
    });

    it("takes the PNG from the cache while a key renders the same SVG, and renders anew when it changed", () => {
        const first = renderPng(svg("A"), { key: "setup:1" });
        expect(renderPng(svg("A"), { key: "setup:1" })).toBe(first);
        expect(Resvg).toHaveBeenCalledTimes(1);
        const changed = renderPng(svg("B"), { key: "setup:1" });
        expect(changed).not.toBe(first);
        expect(Resvg).toHaveBeenCalledTimes(2);
        // no key: never cached
        renderPng(svg("A"));
        renderPng(svg("A"));
        expect(Resvg).toHaveBeenCalledTimes(4);
    });

    it("keeps at most CACHE_MAX pictures, dropping the oldest", () => {
        const doc = svg("same");
        for (let i = 0; i <= CACHE_MAX; i++) renderPng(doc, { key: `k${i}` });
        Resvg.mockClear();
        renderPng(doc, { key: `k${CACHE_MAX}` });
        expect(Resvg).not.toHaveBeenCalled();
        renderPng(doc, { key: "k0" });
        expect(Resvg).toHaveBeenCalledTimes(1);
    });

    it("turns a payload's images into files and replaces the message's old ones", () => {
        const out = withImages({ content: "", embeds: [{ title: "x" }], images: [{ name: "setup.png", svg: svg() }] }, { key: "setup:eh-1" });
        expect(out.images).toBeUndefined();
        expect(out.embeds).toEqual([{ title: "x" }]);
        expect(out.attachments).toEqual([]);
        expect(out.files).toHaveLength(1);
        expect(out.files[0].name).toBe("setup.png");
        expect(out.files[0].attachment.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
        // a payload without pictures still drops old files (a picture switched off)
        expect(withImages({ content: "x" })).toEqual({ content: "x", files: [], attachments: [] });
        // a fresh array each time: discord.js pushes into it
        expect(withImages({}).attachments).not.toBe(withImages({}).attachments);
    });

    it("throws when resvg cannot render, so the caller can fall back to text", () => {
        Resvg.mockImplementationOnce(() => {
            throw new Error("no binary for this platform");
        });
        expect(() => withImages({ images: [{ name: "a.png", svg: svg() }] })).toThrow("no binary");
    });
});
