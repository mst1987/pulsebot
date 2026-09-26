const fs = require("fs");
const path = require("path");
const { formatJson, writeGeneratedJson, GENERATED_DIR, MAX_WIDTH } = require("../../scripts/lib/generatedJson");
const { tempStoreFile } = require("../helpers/tempStore");

describe("scripts/lib/generatedJson", () => {
    describe("formatJson", () => {
        it("parses back to exactly what JSON.stringify gives", () => {
            const value = {
                a: [1, 2, 3],
                b: { nested: ["x", null, true], deep: { n: 1.5 } },
                long: Array.from({ length: 80 }, (_, i) => `item-${i}`),
                rows: Array.from({ length: 5 }, (_, i) => ({ id: i, name: `Name ${i}`, ids: [String(i)] })),
                skip: undefined,
                holes: [undefined, 1],
                empty: {},
                none: [],
            };
            expect(JSON.parse(formatJson(value))).toEqual(JSON.parse(JSON.stringify(value)));
        });

        it("keeps short rows on one line and breaks long ones", () => {
            const text = formatJson({ 21882: ["Soul Essence", "spell_shadow_soulleech_3", 1], long: Array.from({ length: 80 }, (_, i) => i * 1000) });
            const lines = text.split("\n");
            expect(lines).toContain("  \"21882\": [\"Soul Essence\", \"spell_shadow_soulleech_3\", 1],");
            for (const line of lines) expect(line.length).toBeLessThanOrEqual(MAX_WIDTH + 2);
        });

        it("writes scalars as JSON", () => {
            expect(formatJson(3)).toBe("3");
            expect(formatJson("a")).toBe("\"a\"");
            expect(formatJson(null)).toBe("null");
            expect(formatJson(undefined)).toBe("null");
        });
    });

    it("writes into src/config/generated/ by default", () => {
        expect(GENERATED_DIR.split(path.sep).slice(-3)).toEqual(["src", "config", "generated"]);
    });

    it("writes the formatted JSON, creating directories", () => {
        const dir = path.dirname(tempStoreFile("unused.json"));
        const target = writeGeneratedJson("sub/data.json", { ok: [1] }, dir);
        expect(target).toBe(path.join(dir, "sub", "data.json"));
        expect(fs.readFileSync(target, "utf8")).toBe("{\"ok\": [1]}\n");
    });
});
