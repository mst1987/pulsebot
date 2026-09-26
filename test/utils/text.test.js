const { str, clip, plural } = require("../../src/utils/text");

describe("utils/text", () => {
    describe("str", () => {
        it("trims text and turns null/undefined into an empty string", () => {
            expect(str("  Keslight ")).toBe("Keslight");
            expect(str(null)).toBe("");
            expect(str(undefined)).toBe("");
        });

        it("keeps falsy values that are not missing", () => {
            expect(str(0)).toBe("0");
            expect(str(false)).toBe("false");
        });
    });

    describe("clip", () => {
        it("leaves text within the limit alone", () => {
            expect(clip("abc", 3)).toBe("abc");
            expect(clip("", 5)).toBe("");
        });

        it("cuts to max characters, the last one being the ellipsis", () => {
            expect(clip("abcdef", 4)).toBe("abc…");
            expect(clip("abcdef", 4)).toHaveLength(4);
        });

        it("does not trim (callers that want it pass str(text))", () => {
            expect(clip("  a  ", 10)).toBe("  a  ");
            expect(clip(str("  a  "), 10)).toBe("a");
        });

        it("handles null, numbers and a limit of 0", () => {
            expect(clip(null, 5)).toBe("");
            expect(clip(12345, 3)).toBe("12…");
            expect(clip("abc", 0)).toBe("…");
        });
    });

    describe("plural", () => {
        it("picks the singular for exactly one, the plural otherwise", () => {
            expect(plural(1, "Raid", "Raids")).toBe("1 Raid");
            expect(plural(0, "Raid", "Raids")).toBe("0 Raids");
            expect(plural(3, "Kanal", "Kanäle")).toBe("3 Kanäle");
        });
    });
});
