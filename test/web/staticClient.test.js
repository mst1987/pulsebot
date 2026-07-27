jest.mock("fs/promises", () => ({ readFile: jest.fn() }));

const path = require("path");
const fs = require("fs/promises");
const { serve } = require("../../src/web/staticClient");

const DIST_DIR = path.join(__dirname, "..", "..", "src", "web-client", "dist");

function mockRes() {
    return { writeHead: jest.fn(), end: jest.fn() };
}

describe("web/staticClient serve", () => {
    it("ignores requests outside /admin and returns false", async () => {
        const res = mockRes();
        const handled = await serve({ method: "GET" }, res, "/other");
        expect(handled).toBe(false);
        expect(fs.readFile).not.toHaveBeenCalled();
    });

    it("ignores non-GET requests under /admin", async () => {
        const res = mockRes();
        const handled = await serve({ method: "POST" }, res, "/admin");
        expect(handled).toBe(false);
    });

    it("serves a matching built asset with its content type", async () => {
        fs.readFile.mockResolvedValueOnce(Buffer.from("body{color:red}"));
        const res = mockRes();
        const handled = await serve({ method: "GET" }, res, "/admin/assets/index-abc.css");
        expect(handled).toBe(true);
        expect(fs.readFile).toHaveBeenCalledWith(path.join(DIST_DIR, "assets/index-abc.css"));
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Content-Type": "text/css; charset=utf-8" }));
        expect(res.end).toHaveBeenCalledWith(Buffer.from("body{color:red}"));
    });

    it("falls back to index.html for an unknown /admin path (React Router route)", async () => {
        fs.readFile
            .mockRejectedValueOnce(new Error("ENOENT")) // no file at the requested path
            .mockResolvedValueOnce(Buffer.from("<html>spa</html>"));
        const res = mockRes();
        const handled = await serve({ method: "GET" }, res, "/admin/recruitment");
        expect(handled).toBe(true);
        expect(fs.readFile).toHaveBeenLastCalledWith(path.join(DIST_DIR, "index.html"));
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ "Content-Type": "text/html; charset=utf-8" }));
        expect(res.end).toHaveBeenCalledWith(Buffer.from("<html>spa</html>"));
    });

    it("serves index.html for the bare /admin path", async () => {
        fs.readFile.mockResolvedValueOnce(Buffer.from("<html>spa</html>"));
        const res = mockRes();
        const handled = await serve({ method: "GET" }, res, "/admin");
        expect(handled).toBe(true);
        expect(fs.readFile).toHaveBeenCalledWith(path.join(DIST_DIR, "index.html"));
    });

    it("returns false when dist/ has not been built yet", async () => {
        fs.readFile.mockRejectedValue(new Error("ENOENT"));
        const res = mockRes();
        const handled = await serve({ method: "GET" }, res, "/admin/assets/index-abc.js");
        expect(handled).toBe(false);
        expect(res.writeHead).not.toHaveBeenCalled();
    });
});
