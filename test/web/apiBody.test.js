const { EventEmitter } = require("events");
const { readJsonBody } = require("../../src/web/apiBody");

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
