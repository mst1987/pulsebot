const { EventEmitter } = require("events");
const { readJsonBody, readRawBody } = require("../../src/web/apiBody");

function fakeReq() {
    return new EventEmitter();
}

describe("web/apiBody readJsonBody", () => {
    it("parses a valid JSON body", async () => {
        const req = fakeReq();
        const p = readJsonBody(req);
        req.emit("data", JSON.stringify({ name: "kara-signup", type: "text" }));
        req.emit("end");
        expect(await p).toEqual({ name: "kara-signup", type: "text" });
    });

    it("resolves {} for an empty body", async () => {
        const req = fakeReq();
        const p = readJsonBody(req);
        req.emit("end");
        expect(await p).toEqual({});
    });

    it("resolves {} for invalid JSON instead of throwing", async () => {
        const req = fakeReq();
        const p = readJsonBody(req);
        req.emit("data", "{not json");
        req.emit("end");
        expect(await p).toEqual({});
    });

    it("resolves {} and stops reading a body over 1MB", async () => {
        const req = fakeReq();
        req.destroy = jest.fn();
        const p = readJsonBody(req);
        req.emit("data", "a".repeat(1_000_001));
        req.emit("end");
        expect(await p).toEqual({});
        expect(req.destroy).toHaveBeenCalled();
    });

    it("resolves {} on a stream error", async () => {
        const req = fakeReq();
        const p = readJsonBody(req);
        req.emit("error", new Error("boom"));
        expect(await p).toEqual({});
    });
});

describe("web/apiBody readRawBody", () => {
    it("collects the chunks into one Buffer", async () => {
        const req = fakeReq();
        req.headers = {};
        const p = readRawBody(req, 100);
        req.emit("data", Buffer.from("ab"));
        req.emit("data", Buffer.from("cd"));
        req.emit("end");
        expect((await p).toString()).toBe("abcd");
    });

    it("resolves null and cuts the connection when the body grows past the limit", async () => {
        const req = fakeReq();
        req.headers = {};
        req.destroy = jest.fn();
        const p = readRawBody(req, 3);
        req.emit("data", Buffer.from("abcd"));
        req.emit("end");
        expect(await p).toBeNull();
        expect(req.destroy).toHaveBeenCalled();
    });

    it("refuses a declared length over the limit without reading anything", async () => {
        const req = fakeReq();
        req.headers = { "content-length": "999" };
        req.destroy = jest.fn();
        expect(await readRawBody(req, 10)).toBeNull();
        expect(req.destroy).toHaveBeenCalled();
    });

    it("resolves an empty Buffer for an empty body", async () => {
        const req = fakeReq();
        req.headers = {};
        const p = readRawBody(req, 10);
        req.emit("end");
        expect((await p).length).toBe(0);
    });
});
