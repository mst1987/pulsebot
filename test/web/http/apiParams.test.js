// apiParams.js (#421): the small readers for query and body values.
const { q } = require("../../../src/web/http/apiParams");

describe("web/http/apiParams q", () => {
    const query = new URLSearchParams("event=%20ev1%20&page=3&fresh=1&off=0&id=123456789012345678&neg=-4&float=1.5");
    const body = { event: "  ev2 ", page: 7, force: true, no: false, id: 123456789012345678n.toString(), text: null, big: "9" };

    describe("str", () => {
        it("reads a trimmed string from the query and the body", () => {
            expect(q.str(query, "event")).toBe("ev1");
            expect(q.str(body, "event")).toBe("ev2");
        });

        it("gives \"\" for a missing key, null, undefined and no source at all", () => {
            expect(q.str(query, "missing")).toBe("");
            expect(q.str(body, "missing")).toBe("");
            expect(q.str(body, "text")).toBe("");
            expect(q.str(null, "event")).toBe("");
            expect(q.str(undefined, "event")).toBe("");
        });

        it("stringifies other values and cuts to max", () => {
            expect(q.str(body, "page")).toBe("7");
            expect(q.str(body, "event", { max: 2 })).toBe("ev");
        });
    });

    describe("int", () => {
        it("reads whole numbers from strings and numbers", () => {
            expect(q.int(query, "page")).toBe(3);
            expect(q.int(body, "page")).toBe(7);
            expect(q.int(query, "neg")).toBe(-4);
        });

        it("answers the fallback (null) for missing, empty and non-integer values", () => {
            expect(q.int(query, "missing")).toBeNull();
            expect(q.int(query, "float")).toBeNull();
            expect(q.int(query, "event")).toBeNull();
            expect(q.int(body, "text")).toBeNull();
            expect(q.int(query, "missing", { fallback: 1 })).toBe(1);
            expect(q.int(new URLSearchParams("page="), "page", { fallback: 1 })).toBe(1);
        });

        it("clamps into [min, max]", () => {
            expect(q.int(query, "page", { min: 5 })).toBe(5);
            expect(q.int(query, "page", { max: 2 })).toBe(2);
            expect(q.int(query, "neg", { min: 0, max: 10 })).toBe(0);
        });
    });

    describe("bool", () => {
        it("reads true/false, \"1\"/\"0\" and \"true\"/\"false\"", () => {
            expect(q.bool(query, "fresh")).toBe(true);
            expect(q.bool(query, "off")).toBe(false);
            expect(q.bool(body, "force")).toBe(true);
            expect(q.bool(body, "no")).toBe(false);
            expect(q.bool({ x: "TRUE" }, "x")).toBe(true);
            expect(q.bool({ x: " false " }, "x")).toBe(false);
            expect(q.bool({ x: 1 }, "x")).toBe(true);
            expect(q.bool({ x: 0 }, "x")).toBe(false);
        });

        it("answers the fallback for a missing key or an unknown word", () => {
            expect(q.bool(query, "missing")).toBe(false);
            expect(q.bool(query, "missing", true)).toBe(true);
            expect(q.bool({ x: "maybe" }, "x", true)).toBe(true);
            expect(q.bool({ x: "" }, "x", true)).toBe(false);
        });
    });

    describe("snowflake", () => {
        it("returns a Discord id and \"\" for anything else", () => {
            expect(q.snowflake(query, "id")).toBe("123456789012345678");
            expect(q.snowflake(body, "id")).toBe("123456789012345678");
            expect(q.snowflake(query, "event")).toBe("");
            expect(q.snowflake(query, "page")).toBe("");
            expect(q.snowflake(body, "big")).toBe("");
            expect(q.snowflake(body, "missing")).toBe("");
            expect(q.snowflake({ id: " 12345 " }, "id")).toBe("12345");
        });
    });
});
