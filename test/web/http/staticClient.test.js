jest.mock("fs/promises", () => ({ readFile: jest.fn() }));

const path = require("path");
const fs = require("fs/promises");
const { serve, isFilePath, cacheControlFor } = require("../../../src/web/http/staticClient");

const DIST_DIR = path.join(__dirname, "..", "..", "..", "src", "web-client", "dist");

const { mockRes } = require("../../helpers/http");

const IMMUTABLE = "public, max-age=31536000, immutable";

/** fs.readFile answers from a map of dist-relative paths; everything else is ENOENT. */
function distFiles(files) {
    fs.readFile.mockImplementation(async (p) => {
        const rel = path.relative(DIST_DIR, p).split(path.sep).join("/");
        if (Object.prototype.hasOwnProperty.call(files, rel)) return Buffer.from(files[rel]);
        throw new Error("ENOENT");
    });
}

describe("web/http/staticClient serve", () => {
    beforeEach(() => fs.readFile.mockReset());

    it("ignores methods other than GET and HEAD", async () => {
        const res = mockRes();
        const handled = await serve({ method: "POST" }, res, "/");
        expect(handled).toBe(false);
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it("serves a matching built asset with its content type, cacheable for good", async () => {
        distFiles({ "assets/index-abc.css": "body{color:red}" });
        const res = mockRes();
        const handled = await serve({ method: "GET" }, res, "/assets/index-abc.css");
        expect(handled).toBe(true);
        expect(fs.readFile).toHaveBeenCalledWith(path.join(DIST_DIR, "assets/index-abc.css"));
        expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": IMMUTABLE });
        expect(res.end).toHaveBeenCalledWith(Buffer.from("body{color:red}"));
    });

    it("serves a JS chunk as a JavaScript module", async () => {
        distFiles({ "assets/RaidplanTab-abc.js": "export default 1" });
        const res = mockRes();
        await serve({ method: "GET" }, res, "/assets/RaidplanTab-abc.js");
        expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": IMMUTABLE });
    });

    it("revalidates an unhashed file outside assets/ (favicon, boss images)", async () => {
        distFiles({ "favicon.svg": "<svg/>" });
        const res = mockRes();
        await serve({ method: "GET" }, res, "/favicon.svg");
        expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" });
    });

    // #530: after a deploy an open tab still asks for the chunks of the old build.
    // index.html in their place made the browser refuse a "text/html" module script.
    it("answers a missing chunk with a plain 404, never with index.html", async () => {
        distFiles({ "index.html": "<html>spa</html>" });
        const res = mockRes();
        const handled = await serve({ method: "GET" }, res, "/assets/RaidplanTab-CZfoAiL2.js");
        expect(handled).toBe(true);
        expect(res.writeHead).toHaveBeenCalledWith(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
        expect(res.end).toHaveBeenCalledWith("Not found");
        expect(fs.readFile).not.toHaveBeenCalledWith(path.join(DIST_DIR, "index.html"));
    });

    it("answers any missing file with an extension with a 404, also outside assets/", async () => {
        distFiles({ "index.html": "<html>spa</html>" });
        for (const p of ["/assets/gibtsnicht.css", "/robots.txt", "/bosses/x.png"]) {
            const res = mockRes();
            await serve({ method: "GET" }, res, p);
            expect(res.writeHead).toHaveBeenCalledWith(404, expect.objectContaining({ "Content-Type": "text/plain; charset=utf-8" }));
        }
    });

    it("falls back to index.html for a page path (React Router route), never cached", async () => {
        distFiles({ "index.html": "<html>spa</html>" });
        const res = mockRes();
        const handled = await serve({ method: "GET" }, res, "/recruitment");
        expect(handled).toBe(true);
        expect(fs.readFile).toHaveBeenLastCalledWith(path.join(DIST_DIR, "index.html"));
        expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        expect(res.end).toHaveBeenCalledWith(Buffer.from("<html>spa</html>"));
    });

    it("serves index.html for the site root and for /index.html with no-cache", async () => {
        distFiles({ "index.html": "<html>spa</html>" });
        for (const p of ["/", "/index.html"]) {
            const res = mockRes();
            expect(await serve({ method: "GET" }, res, p)).toBe(true);
            expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        }
        expect(fs.readFile).toHaveBeenCalledWith(path.join(DIST_DIR, "index.html"));
    });

    // The client routes it and shows its own "not found" page — a server 404
    // would be a dead end without the menu around it.
    it("hands a page path no route claims to the client as well", async () => {
        distFiles({ "index.html": "<html>spa</html>" });
        const res = mockRes();
        expect(await serve({ method: "GET" }, res, "/gibtsnicht")).toBe(true);
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Content-Type": "text/html; charset=utf-8" }));
    });

    it("answers HEAD with the headers of GET and no body", async () => {
        distFiles({ "index.html": "<html>spa</html>", "assets/a-1.js": "x" });
        const page = mockRes();
        expect(await serve({ method: "HEAD" }, page, "/")).toBe(true);
        expect(page.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        expect(page.end).toHaveBeenCalledWith(undefined);
        const missing = mockRes();
        await serve({ method: "HEAD" }, missing, "/assets/gibtsnicht.js");
        expect(missing.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        expect(missing.end).toHaveBeenCalledWith(undefined);
    });

    it("returns false for a page path when dist/ has not been built yet", async () => {
        distFiles({});
        const res = mockRes();
        const handled = await serve({ method: "GET" }, res, "/raids");
        expect(handled).toBe(false);
        expect(res.writeHead).not.toHaveBeenCalled();
    });

    // Serving from the root puts the traversal guard on the front line: the path
    // arrives unprefixed now, so nothing upstream strips a "..".
    it("never reads outside dist/", async () => {
        // every file outside dist/ would be "secret" — none may ever be read or sent
        fs.readFile.mockImplementation(async (p) => Buffer.from(p === path.join(DIST_DIR, "index.html") ? "<html>spa</html>" : "secret"));
        for (const p of ["/../../.env", "/assets/../../../.env", "/../dist-old/index.html", "/..", "/../package.json"]) {
            const res = mockRes();
            await serve({ method: "GET" }, res, p);
            expect(res.end).not.toHaveBeenCalledWith(Buffer.from("secret"));
        }
        for (const call of fs.readFile.mock.calls) expect(call[0].startsWith(DIST_DIR + path.sep)).toBe(true);
    });

    it("answers a traversal attempt for a file with a 404", async () => {
        fs.readFile.mockResolvedValue(Buffer.from("secret"));
        const res = mockRes();
        await serve({ method: "GET" }, res, "/../package.json");
        expect(res.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
        expect(res.end).toHaveBeenCalledWith("Not found");
    });
});

describe("web/http/staticClient helpers", () => {
    it("tells a file path from a page path", () => {
        expect(isFilePath("assets/x-1.js")).toBe(true);
        expect(isFilePath("favicon.svg")).toBe(true);
        expect(isFilePath("raids/detail")).toBe(false);
        expect(isFilePath("")).toBe(false);
    });

    it("caches only the hashed build output for good", () => {
        expect(cacheControlFor("assets/x-1.js")).toBe(IMMUTABLE);
        expect(cacheControlFor("index.html")).toBe("no-cache");
        expect(cacheControlFor("bosses/a.png")).toBe("no-cache");
    });
});

describe("web/http/staticClient compression of hashed assets", () => {
    const zlib = require("zlib");
    const { clearCompressedCache } = require("../../../src/web/http/staticClient");
    const BIG_JS = `export const x = ${JSON.stringify("lorem ipsum ".repeat(300))};`;

    beforeEach(() => {
        fs.readFile.mockReset();
        clearCompressedCache();
    });

    it("serves a brotli copy of an asset and compresses it only once", async () => {
        distFiles({ "assets/app-1.js": BIG_JS });
        const first = mockRes();
        await serve({ method: "GET", headers: { "accept-encoding": "br, gzip" } }, first, "/assets/app-1.js");
        const [status, headers] = first.writeHead.mock.calls[0];
        expect(status).toBe(200);
        expect(headers["Content-Encoding"]).toBe("br");
        expect(headers.Vary).toBe("Accept-Encoding");
        expect(headers["Cache-Control"]).toBe(IMMUTABLE);
        const body = first.end.mock.calls[0][0];
        expect(headers["Content-Length"]).toBe(body.length);
        expect(zlib.brotliDecompressSync(body).toString()).toBe(BIG_JS);

        const second = mockRes();
        await serve({ method: "GET", headers: { "accept-encoding": "br" } }, second, "/assets/app-1.js");
        expect(second.end.mock.calls[0][0]).toBe(body); // the very same cached buffer
    });

    it("uses gzip when brotli is not offered, identity when nothing is", async () => {
        distFiles({ "assets/app-2.js": BIG_JS });
        const gz = mockRes();
        await serve({ method: "GET", headers: { "accept-encoding": "gzip" } }, gz, "/assets/app-2.js");
        expect(gz.writeHead.mock.calls[0][1]["Content-Encoding"]).toBe("gzip");
        expect(zlib.gunzipSync(gz.end.mock.calls[0][0]).toString()).toBe(BIG_JS);

        const plain = mockRes();
        await serve({ method: "GET", headers: {} }, plain, "/assets/app-2.js");
        expect(plain.writeHead.mock.calls[0][1]["Content-Encoding"]).toBeUndefined();
        expect(plain.end).toHaveBeenCalledWith(Buffer.from(BIG_JS));
    });

    it("sends HEAD, tiny files and images uncompressed", async () => {
        distFiles({ "assets/app-3.js": BIG_JS, "assets/tiny.css": "a{}", "assets/pic.png": "x".repeat(5000) });
        const head = mockRes();
        await serve({ method: "HEAD", headers: { "accept-encoding": "br" } }, head, "/assets/app-3.js");
        expect(head.writeHead.mock.calls[0][1]["Content-Encoding"]).toBeUndefined();
        expect(head.end).toHaveBeenCalledWith(undefined);
        for (const p of ["/assets/tiny.css", "/assets/pic.png"]) {
            const res = mockRes();
            await serve({ method: "GET", headers: { "accept-encoding": "br" } }, res, p);
            expect(res.writeHead.mock.calls[0][1]["Content-Encoding"]).toBeUndefined();
        }
    });
});
