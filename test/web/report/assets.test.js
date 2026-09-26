// The /r-assets/ files of the report pages (#423): a fixed list, a content hash
// in the url and the cache header that goes with it.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { assetUrl, serveAsset, PREFIX, FILES } = require("../../../src/web/report/assets");

const STATIC = path.join(__dirname, "..", "..", "..", "src", "web", "static");
const hashOf = (name) => crypto.createHash("sha256").update(fs.readFileSync(path.join(STATIC, name))).digest("hex").slice(0, 12);
const res = () => ({ writeHead: jest.fn(), end: jest.fn() });
const urlOf = (u) => new URL(u, "http://localhost");

describe("web/report/assets", () => {
    it("links every file under its content hash", () => {
        expect(Object.keys(FILES).sort()).toEqual(["report.css", "report.js"]);
        for (const name of Object.keys(FILES)) {
            expect(assetUrl(name)).toBe(`${PREFIX}${name}?v=${hashOf(name)}`);
        }
    });

    it("refuses to link a file that is not on the list", () => {
        expect(() => assetUrl("../render.js")).toThrow("unknown report asset");
        expect(() => assetUrl("toString")).toThrow("unknown report asset");
    });

    it("serves the current version with a year-long immutable cache and the file's type", () => {
        const r = res();
        const url = assetUrl("report.css");
        expect(serveAsset(urlOf(url).pathname, urlOf(url), r)).toBe(true);
        expect(r.writeHead).toHaveBeenCalledWith(200, {
            "Content-Type": "text/css; charset=utf-8",
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        });
        expect(r.end.mock.calls[0][0].equals(fs.readFileSync(path.join(STATIC, "report.css")))).toBe(true);
    });

    it("serves another or no version with no-cache, so an old url never pins old content", () => {
        for (const u of ["/r-assets/report.js", "/r-assets/report.js?v=0123456789ab"]) {
            const r = res();
            expect(serveAsset("/r-assets/report.js", urlOf(u), r)).toBe(true);
            expect(r.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" }));
        }
        const r = res();
        expect(serveAsset("/r-assets/report.js", null, r)).toBe(true);
        expect(r.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Cache-Control": "no-cache" }));
    });

    it("answers false for every name that is not on the list and never touches the disk for it", () => {
        const spy = jest.spyOn(fs, "readFileSync");
        for (const p of ["/r-assets/", "/r-assets/nope.css", "/r-assets/../render.js", "/r-assets/..\\render.js", "/r-assets/static/report.css", "/r-assets/constructor", "/r-assets/report.css/"]) {
            const r = res();
            expect(serveAsset(p, urlOf("/r-assets/x"), r)).toBe(false);
            expect(r.writeHead).not.toHaveBeenCalled();
        }
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it("reads a file once and again only after it changed on disk", () => {
        const read = jest.spyOn(fs, "readFileSync");
        const stat = jest.spyOn(fs, "statSync");
        assetUrl("report.js");
        read.mockClear();
        assetUrl("report.js");
        expect(read).not.toHaveBeenCalled();
        const real = fs.statSync(path.join(STATIC, "report.js"));
        stat.mockReturnValueOnce({ mtimeMs: real.mtimeMs + 1000 });
        assetUrl("report.js");
        expect(read).toHaveBeenCalledTimes(1);
        read.mockRestore();
        stat.mockRestore();
    });
});
