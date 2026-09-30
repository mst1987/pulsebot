// The factory behind every machine credential; the full behaviour is covered
// through its two stores (ingestTokenStore.test.js, kaderTokenStore.test.js).
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { createBearerTokenStore, bearerFrom, hashToken } = require("../../src/stores/bearerTokenStore.js");

beforeEach(() => {
    fs.__store.clear();
});

describe("stores/bearerTokenStore", () => {
    it("refuses a store without a file or prefix", () => {
        expect(() => createBearerTokenStore({ file: "", prefix: "x_" })).toThrow();
        expect(() => createBearerTokenStore({ file: "/tmp/t.json", prefix: "" })).toThrow();
    });

    it("two stores with different prefixes never accept each other's tokens", () => {
        const a = createBearerTokenStore({ file: "/data/a.json", prefix: "aaa_", defaultName: "A" });
        const b = createBearerTokenStore({ file: "/data/b.json", prefix: "bbb_", defaultName: "B" });
        const ta = a.createToken("");
        expect(ta.record.name).toBe("A");
        expect(a.verifyToken(ta.token)).not.toBeNull();
        expect(b.verifyToken(ta.token)).toBeNull();
    });

    it("falls back to a generic name when the store has no default", () => {
        const s = createBearerTokenStore({ file: "/data/c.json", prefix: "c_" });
        expect(s.createToken("").record.name).toBe("Token");
    });

    it("hashes deterministically as sha256 hex", () => {
        expect(hashToken("abc")).toBe(hashToken("abc"));
        expect(hashToken("abc")).toMatch(/^[a-f0-9]{64}$/);
        expect(hashToken(null)).toBe(hashToken(""));
    });

    it("reads the bearer value out of a request", () => {
        expect(bearerFrom({ headers: { authorization: "Bearer ehk_abc" } })).toBe("ehk_abc");
        expect(bearerFrom({ headers: {} })).toBe("");
    });
});
