const { SNOWFLAKE, isSnowflake, newId } = require("../../src/utils/ids");

describe("utils/ids", () => {
    describe("isSnowflake", () => {
        it("accepts 5 to 25 digits, as a string or a number", () => {
            expect(isSnowflake("1139509316387344395")).toBe(true);
            expect(isSnowflake("12345")).toBe(true);
            expect(isSnowflake(12345)).toBe(true);
            expect(isSnowflake("1".repeat(25))).toBe(true);
        });

        it("refuses too short, too long, non-digits and missing values", () => {
            expect(isSnowflake("1234")).toBe(false);
            expect(isSnowflake("1".repeat(26))).toBe(false);
            expect(isSnowflake("<@123456>")).toBe(false);
            expect(isSnowflake("https://discord.com/channels/1/2")).toBe(false);
            expect(isSnowflake("")).toBe(false);
            expect(isSnowflake(null)).toBe(false);
            expect(isSnowflake(undefined)).toBe(false);
        });

        it("does not trim: a padded id is not an id", () => {
            expect(isSnowflake(" 123456 ")).toBe(false);
        });

        it("exports the pattern it tests with", () => {
            expect(SNOWFLAKE.test("123456")).toBe(true);
        });
    });

    describe("newId", () => {
        it("is hex, two characters per byte (6 bytes by default)", () => {
            expect(newId()).toMatch(/^[0-9a-f]{12}$/);
            expect(newId(5)).toMatch(/^[0-9a-f]{10}$/);
        });

        it("differs between calls", () => {
            const ids = new Set(Array.from({ length: 50 }, () => newId()));
            expect(ids.size).toBe(50);
        });
    });
});
