// The PNG codec and the portrait crop of scripts/fetch-mob-icons.js (scripts/lib/png.js).
const png = require("../../scripts/lib/png");

/** A width x height picture, transparent, with fn(x, y) -> [r,g,b,a] or null painted in. */
function picture(width, height, fn) {
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const px = fn(x, y);
            if (px) data.set(px, (y * width + x) * 4);
        }
    }
    return { width, height, data };
}

describe("png codec", () => {
    it("encodes and decodes an RGBA picture without loss", () => {
        const img = picture(7, 5, (x, y) => [x * 30, y * 40, (x + y) * 10, 255 - x * 10]);
        const back = png.decode(png.encode(img));
        expect(back.width).toBe(7);
        expect(back.height).toBe(5);
        expect(Buffer.compare(back.data, img.data)).toBe(0);
    });
    it("refuses what is not a PNG", () => {
        expect(() => png.decode(Buffer.from("not a png at all, really not a png at all"))).toThrow(/not a PNG/);
    });
});

describe("portrait crop", () => {
    const figure = picture(100, 100, (x, y) => (x >= 40 && x < 60 && y >= 10 && y < 90 ? [200, 50, 50, 255] : null));
    const blob = picture(100, 100, (x, y) => (x >= 10 && x < 90 && y >= 30 && y < 70 ? [50, 200, 50, 255] : null));
    it("finds the box round what is not transparent", () => {
        expect(png.alphaBox(figure)).toMatchObject({ x0: 40, x1: 59, y0: 10, y1: 89, w: 20, h: 80 });
        expect(png.alphaBox(picture(4, 4, () => null))).toBe(null);
    });
    it("an upright figure is cropped to its head and shoulders, at its top and centred on it", () => {
        const r = png.portraitRect(figure);
        expect(r.size).toBeLessThan(80);
        expect(r.size).toBeGreaterThanOrEqual(30);
        expect(r.y).toBeLessThanOrEqual(10);
        expect(r.y + r.size).toBeLessThan(60);
        expect(r.x + r.size / 2).toBeGreaterThan(45);
        expect(r.x + r.size / 2).toBeLessThan(55);
    });
    it("a wide creature is taken whole, and the square stays inside the picture", () => {
        const r = png.portraitRect(blob);
        expect(r.size).toBeGreaterThanOrEqual(80);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.size).toBeLessThanOrEqual(100);
        expect(r.y + r.size).toBeLessThanOrEqual(100);
    });
    it("scales a crop to the wanted size and keeps the colour of an opaque area", () => {
        const solid = picture(20, 20, () => [10, 120, 230, 255]);
        const out = png.cropScale(solid, { x: 0, y: 0, size: 20 }, 4);
        expect([out.width, out.height]).toEqual([4, 4]);
        expect([...out.data.subarray(0, 4)]).toEqual([10, 120, 230, 255]);
        const empty = png.cropScale(picture(8, 8, () => null), { x: 0, y: 0, size: 8 }, 2);
        expect(empty.data[3]).toBe(0);
    });
});
