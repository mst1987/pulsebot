jest.mock("fs/promises", () => ({ readFile: jest.fn() }));

const path = require("path");
const fs = require("fs/promises");
const { serve } = require("../../src/web/staticClient");

const DIST_DIR = path.join(__dirname, "..", "..", "src", "web-client", "dist");

function mockRes() {
    return { writeHead: jest.fn(), end: jest.fn() };
}

describe("web/staticClient serve", () => {
    it("ignores non-GET requests", async () => {
        const res = mockRes();
        const handled = await serve({ method: "POST" }, res, "/");
        expect(handled).toBe(false);
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it("serves a matching built asset with its content type", async () => {
        fs.readFile.mockResolvedValueOnce(Buffer.from("body{color:red}"));
        const res = mockRes();
        const handled = await serve({ method: "GET" }, res, "/assets/index-abc.css");
        expect(handled).toBe(true);
        expect(fs.readFile).toHaveBeenCalledWith(path.join(DIST_DIR, "assets/index-abc.css"));
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Content-Type": "text/css; charset=utf-8" }));
        expect(res.end).toHaveBeenCalledWith(Buffer.from("body{color:red}"));
    });

    it("falls back to index.html for a page path (React Router route)", async () => {
        fs.readFile
            .mockRejectedValueOnce(new Error("ENOENT")) // no file at the requested path
            .mockResolvedValueOnce(Buffer.from("<html>spa</html>"));
        const res = mockRes();
        const handled = await serve({ method: "GET" }, res, "/recruitment");
        expect(handled).toBe(true);
        expect(fs.readFile).toHaveBeenLastCalledWith(path.join(DIST_DIR, "index.html"));
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Content-Type": "text/html; charset=utf-8" }));
        expect(res.end).toHaveBeenCalledWith(Buffer.from("<html>spa</html>"));
    });

    it("serves index.html for the site root", async () => {
        fs.readFile.mockResolvedValueOnce(Buffer.from("<html>spa</html>"));
        const res = mockRes();
        const handled = await serve({ method: "GET" }, res, "/");
        expect(handled).toBe(true);
        expect(fs.readFile).toHaveBeenCalledWith(path.join(DIST_DIR, "index.html"));
    });

    // The client routes it and shows its own "not found" page — a server 404
    // would be a dead end without the menu around it.
    it("hands a path no route claims to the client as well", async () => {
        fs.readFile
            .mockRejectedValueOnce(new Error("ENOENT"))
            .mockResolvedValueOnce(Buffer.from("<html>spa</html>"));
        const res = mockRes();
        expect(await serve({ method: "GET" }, res, "/gibtsnicht")).toBe(true);
        expect(fs.readFile).toHaveBeenLastCalledWith(path.join(DIST_DIR, "index.html"));
    });

    it("returns false when dist/ has not been built yet", async () => {
        fs.readFile.mockRejectedValue(new Error("ENOENT"));
        const res = mockRes();
        const handled = await serve({ method: "GET" }, res, "/assets/index-abc.js");
        expect(handled).toBe(false);
        expect(res.writeHead).not.toHaveBeenCalled();
    });

    // Serving from the root puts the traversal guard on the front line: the path
    // arrives unprefixed now, so nothing upstream strips a "..".
    it("never reads outside dist/", async () => {
        const res = mockRes();
        fs.readFile.mockResolvedValue(Buffer.from("secret"));
        await serve({ method: "GET" }, res, "/../../.env");
        for (const call of fs.readFile.mock.calls) expect(call[0].startsWith(DIST_DIR)).toBe(true);
    });
});
