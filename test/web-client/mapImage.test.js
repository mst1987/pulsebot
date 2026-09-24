// The room map's client-side shrinking (lib/mapImage.ts): when to shrink, to what size,
// which encoder settings are tried in which order, and the text shown.
const fs = require("fs");
const path = require("path");
const { loadTs, makeT } = require("./i18nHelper");

const lib = loadTs("lib/mapImage.ts", { t: makeT("de") });
const MB = 1024 * 1024;

describe("needsCompression", () => {
    it("leaves a file that is already small enough alone, whatever its pixels", () => {
        expect(lib.needsCompression(600 * 1024)).toBe(false);
        expect(lib.needsCompression(lib.MAP_TARGET_BYTES)).toBe(false);
    });
    it("shrinks a file over 900 KB", () => {
        expect(lib.needsCompression(lib.MAP_TARGET_BYTES + 1)).toBe(true);
        expect(lib.needsCompression(6.3 * MB)).toBe(true);
    });
    it("aims below the 1 MB default of a reverse proxy, which is below the server's 3 MB limit", () => {
        expect(lib.MAP_TARGET_BYTES).toBe(900 * 1024);
        expect(lib.MAP_TARGET_BYTES).toBeLessThan(1 * MB);
        expect(lib.MAP_TARGET_BYTES).toBeLessThan(lib.MAP_LIMIT_BYTES);
        expect(lib.MAP_LIMIT_BYTES).toBe(3 * MB);
    });
});

describe("scaledSize", () => {
    it("keeps the proportions and caps the longest edge", () => {
        expect(lib.scaledSize(5120, 3200, 2560)).toEqual({ width: 2560, height: 1600 });
        expect(lib.scaledSize(3000, 3000, 2560)).toEqual({ width: 2560, height: 2560 });
        expect(lib.scaledSize(1000, 4000, 2560)).toEqual({ width: 640, height: 2560 });
    });
    it("never enlarges, and never returns 0", () => {
        expect(lib.scaledSize(800, 600, 2560)).toEqual({ width: 800, height: 600 });
        expect(lib.scaledSize(100000, 1, 2560).height).toBe(1);
    });
});

describe("attempts", () => {
    it("starts at 2560 px with the best quality, goes 2048 then 1600 px only after every quality failed", () => {
        const a = lib.attempts();
        expect(a[0]).toEqual({ edge: 2560, quality: 0.92 });
        expect(a[lib.MAP_QUALITIES.length - 1]).toEqual({ edge: 2560, quality: 0.6 });
        expect(a[lib.MAP_QUALITIES.length]).toEqual({ edge: 2048, quality: 0.92 });
        expect(lib.MAP_EDGES.slice(0, 3)).toEqual([2560, 2048, 1600]);
        expect(a).toHaveLength(lib.MAP_QUALITIES.length * lib.MAP_EDGES.length);
        const q = lib.MAP_QUALITIES;
        expect([...q].sort((x, y) => y - x)).toEqual(q);
    });
});

describe("types and names", () => {
    it("accepts PNG, JPG and WebP only", () => {
        for (const t of ["image/png", "image/jpeg", "image/webp"]) expect(lib.isMapType(t)).toBe(true);
        for (const t of ["image/gif", "image/svg+xml", "application/pdf", ""]) expect(lib.isMapType(t)).toBe(false);
    });
    it("writes WebP (transparency stays), JPEG only without WebP support", () => {
        expect(lib.outputType(true)).toBe("image/webp");
        expect(lib.outputType(false)).toBe("image/jpeg");
    });
    it("renames to the new extension", () => {
        expect(lib.renamedFor("Room.PNG", "image/webp")).toBe("Room.webp");
        expect(lib.renamedFor("a.b.jpeg", "image/jpeg")).toBe("a.b.jpg");
        expect(lib.renamedFor("", "image/webp")).toBe("map.webp");
    });
});

describe("formatBytes", () => {
    it("shows megabytes with the language's decimal sign", () => {
        expect(lib.formatBytes(4.8 * MB, "de-DE")).toBe("4,8 MB");
        expect(lib.formatBytes(1.9 * MB, "en-GB")).toBe("1.9 MB");
        expect(lib.formatBytes(640 * 1024, "de-DE")).toBe("640 KB");
    });
});

describe("texts and wiring", () => {
    const root = path.join(__dirname, "../../src/web-client/src");
    it("has the messages in both languages", () => {
        for (const lang of ["de", "en"]) {
            const d = JSON.parse(fs.readFileSync(path.join(root, "i18n/locales", lang, "raidBoard.json"), "utf8"));
            expect(d.board.mapCompressed).toContain("{from}");
            expect(d.board.mapCompressed).toContain("{to}");
            for (const k of ["mapCannotShrink", "mapNotImage", "mapUnreadable"]) expect(typeof d.board[k]).toBe("string");
        }
    });
    it("the map panel shrinks before it uploads", () => {
        const panel = fs.readFileSync(path.join(root, "pages/raid-detail/raidplan/MapPanel.tsx"), "utf8");
        expect(panel).toContain("prepareMapFile(file)");
        expect(panel.indexOf("prepareMapFile(file)")).toBeLessThan(panel.indexOf("uploadRaidplanMap(csrfToken"));
    });
});
