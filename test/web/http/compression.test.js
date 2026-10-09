const http = require("http");
const zlib = require("zlib");
const compression = require("../../../src/web/http/compression");

const { pickEncoding, isCompressible, install } = compression;

/** A real server whose handler goes through install(), answering with `answer(req, res)`. */
function serve(answer) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, "http://localhost");
            install(req, res, url.pathname);
            Promise.resolve().then(() => answer(req, res)).catch(() => {
                res.writeHead(500);
                res.end("err");
            });
        });
        server.listen(0, "127.0.0.1", () => resolve(server));
    });
}

function get(server, path, headers = {}, method = "GET") {
    return new Promise((resolve, reject) => {
        const req = http.request({ port: server.address().port, host: "127.0.0.1", path, method, headers }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on("error", reject);
        req.end();
    });
}

const BIG = JSON.stringify({ data: Array.from({ length: 400 }, (_, i) => ({ id: i, name: `raider ${i}` })) });

describe("pickEncoding", () => {
    it.each([
        ["br, gzip", "br"],
        ["gzip, deflate, br", "br"],
        ["gzip", "gzip"],
        ["gzip, br;q=0", "gzip"],
        ["br;q=0.5, gzip;q=0.9", "gzip"],
        ["br;q=0, gzip;q=0", ""],
        ["identity", ""],
        ["", ""],
        [undefined, ""],
        ["*", "br"],
        ["deflate", ""],
        ["BR", "br"],
    ])("%p -> %p", (header, expected) => {
        expect(pickEncoding(header)).toBe(expected);
    });
});

describe("isCompressible", () => {
    it("accepts text-like types and refuses images and fonts", () => {
        for (const t of ["text/html; charset=utf-8", "application/json; charset=utf-8", "text/javascript", "image/svg+xml", "text/calendar"]) {
            expect(isCompressible(t)).toBe(true);
        }
        for (const t of ["image/png", "font/woff2", "application/octet-stream", "", undefined]) {
            expect(isCompressible(t)).toBe(false);
        }
    });
});

describe("compress", () => {
    it.each(["br", "gzip"])("%s round-trips", async (enc) => {
        const out = await compression.compress(BIG, enc);
        const back = enc === "br" ? zlib.brotliDecompressSync(out) : zlib.gunzipSync(out);
        expect(back.toString()).toBe(BIG);
        expect(out.length).toBeLessThan(BIG.length);
    });
});

describe("withVary", () => {
    it("adds Accept-Encoding once", () => {
        expect(compression.withVary("")).toBe("Accept-Encoding");
        expect(compression.withVary("Cookie")).toBe("Cookie, Accept-Encoding");
        expect(compression.withVary("Cookie, accept-encoding")).toBe("Cookie, accept-encoding");
        expect(compression.withVary("*")).toBe("*");
    });
});

describe("install over a real response", () => {
    let server;
    afterEach(() => new Promise((r) => (server ? server.close(r) : r())));

    const jsonAnswer = (body = BIG) => (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(body);
    };

    it("compresses with brotli, sets Vary, Content-Encoding and the right Content-Length", async () => {
        server = await serve(jsonAnswer());
        const r = await get(server, "/api/x", { "Accept-Encoding": "br, gzip" });
        expect(r.status).toBe(200);
        expect(r.headers["content-encoding"]).toBe("br");
        expect(r.headers.vary).toBe("Accept-Encoding");
        expect(Number(r.headers["content-length"])).toBe(r.body.length);
        expect(zlib.brotliDecompressSync(r.body).toString()).toBe(BIG);
    });

    it("falls back to gzip", async () => {
        server = await serve(jsonAnswer());
        const r = await get(server, "/api/x", { "Accept-Encoding": "gzip" });
        expect(r.headers["content-encoding"]).toBe("gzip");
        expect(zlib.gunzipSync(r.body).toString()).toBe(BIG);
    });

    it("sends identity without Accept-Encoding (but still varies)", async () => {
        server = await serve(jsonAnswer());
        const r = await get(server, "/api/x");
        expect(r.headers["content-encoding"]).toBeUndefined();
        expect(r.headers.vary).toBe("Accept-Encoding");
        expect(r.body.toString()).toBe(BIG);
    });

    it("leaves small bodies alone", async () => {
        server = await serve(jsonAnswer("{\"data\":1}"));
        const r = await get(server, "/api/x", { "Accept-Encoding": "br" });
        expect(r.headers["content-encoding"]).toBeUndefined();
        expect(r.headers.vary).toBeUndefined();
        expect(r.body.toString()).toBe("{\"data\":1}");
    });

    it("leaves non-text types alone", async () => {
        server = await serve((req, res) => {
            res.writeHead(200, { "Content-Type": "image/png" });
            res.end(Buffer.alloc(5000));
        });
        const r = await get(server, "/x.png", { "Accept-Encoding": "br" });
        expect(r.headers["content-encoding"]).toBeUndefined();
        expect(r.body.length).toBe(5000);
    });

    it("keeps an existing Content-Encoding and a 304 as they are", async () => {
        server = await serve((req, res) => {
            if (req.url === "/304") {
                res.writeHead(304, { ETag: "\"a\"" });
                return res.end();
            }
            res.writeHead(200, { "Content-Type": "text/css", "Content-Encoding": "gzip" });
            return res.end(zlib.gzipSync("a".repeat(3000)));
        });
        const a = await get(server, "/304", { "Accept-Encoding": "br" });
        expect(a.status).toBe(304);
        expect(a.headers["content-encoding"]).toBeUndefined();
        const b = await get(server, "/pre", { "Accept-Encoding": "br" });
        expect(b.headers["content-encoding"]).toBe("gzip");
        expect(zlib.gunzipSync(b.body).toString()).toBe("a".repeat(3000));
    });

    it("answers HEAD with headers and no body, uncompressed", async () => {
        server = await serve(jsonAnswer());
        const r = await get(server, "/api/x", { "Accept-Encoding": "br" }, "HEAD");
        expect(r.status).toBe(200);
        expect(r.body.length).toBe(0);
        expect(r.headers["content-encoding"]).toBeUndefined();
    });

    it("passes a streamed answer through untouched", async () => {
        server = await serve((req, res) => {
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            res.write("data: 1\n\n");
            res.end("data: 2\n\n");
        });
        const r = await get(server, "/api/stream", { "Accept-Encoding": "br" });
        expect(r.headers["content-encoding"]).toBeUndefined();
        expect(r.body.toString()).toBe("data: 1\n\ndata: 2\n\n");
    });

    it("lets an error handler still answer when a handler fails before end()", async () => {
        server = await serve((req, res) => {
            res.writeHead(200, { "Content-Type": "text/html" });
            throw new Error("boom");
        });
        const r = await get(server, "/r/x", { "Accept-Encoding": "br" });
        expect(r.status).toBe(500);
    });

    it("sets Server-Timing on /api, /r and /p but not elsewhere", async () => {
        server = await serve(jsonAnswer("{\"a\":1}"));
        for (const p of ["/api/x", "/r/abc", "/p/tok"]) {
            const r = await get(server, p);
            expect(r.headers["server-timing"]).toMatch(/^app;dur=\d+(\.\d+)?$/);
        }
        const other = await get(server, "/health");
        expect(other.headers["server-timing"]).toBeUndefined();
    });
});

describe("slow request log", () => {
    let server;
    const OLD = process.env.SLOW_REQUEST_MS;
    const OLD_LEVEL = process.env.LOG_LEVEL;
    const restore = (key, value) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    };
    afterEach(async () => {
        restore("SLOW_REQUEST_MS", OLD);
        restore("LOG_LEVEL", OLD_LEVEL);
        await new Promise((r) => (server ? server.close(r) : r()));
    });

    it("warns from the threshold on (path without query), debugs below", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const out = jest.spyOn(console, "log").mockImplementation(() => {});
        process.env.LOG_LEVEL = "debug";
        server = await serve((req, res) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("{}");
        });
        process.env.SLOW_REQUEST_MS = "0";
        await get(server, "/api/slow?token=secret");
        expect(warn).toHaveBeenCalledTimes(1);
        const line = warn.mock.calls[0].join(" ");
        expect(line).toContain("GET /api/slow -> 200");
        expect(line).not.toContain("secret");

        process.env.SLOW_REQUEST_MS = "100000";
        await get(server, "/api/fast");
        expect(warn).toHaveBeenCalledTimes(1);
        expect(out.mock.calls.some((c) => c.join(" ").includes("GET /api/fast -> 200"))).toBe(true);
        warn.mockRestore();
        out.mockRestore();
    });

    it("defaults to 1000 ms for a missing or invalid value", () => {
        delete process.env.SLOW_REQUEST_MS;
        expect(compression.slowThresholdMs()).toBe(1000);
        process.env.SLOW_REQUEST_MS = "abc";
        expect(compression.slowThresholdMs()).toBe(1000);
        process.env.SLOW_REQUEST_MS = "250";
        expect(compression.slowThresholdMs()).toBe(250);
    });
});

describe("install on a stand-in response", () => {
    it("does nothing for a response without event support", () => {
        const res = { writeHead: jest.fn(), end: jest.fn() };
        const before = res.writeHead;
        install({ method: "GET", headers: {} }, res, "/api/x");
        expect(res.writeHead).toBe(before);
    });
});
