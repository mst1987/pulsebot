const {
    SPEC_CATALOG, resolveSpec, parseWantedBlock, buildSpecLine, insertSpecLine, removeSpecLine,
} = require("../../src/utils/recruitmentSpecs.js");

// A real recruitment message body (anonymized IDs), used as the reference
// shape the parser must handle: a "## Gesucht" heading, free text, then a
// run of "## <emoji> Label" lines with no blank line between them, followed
// by unrelated "## …" headings elsewhere in the text.
const REAL_BODY = [
    "## Gesucht",
    "",
    "Gute Spieler mit Interesse an gut organisierten und entspannten Raids. ",
    "## <:shadow:1362785832133595177> Shadow Priest",
    "## <:beastmastery:1362785557972914206> Hunter",
    "",
    "## Vorraussetzungen & Anforderungen",
    "- regelmäßige Anmeldungen zu den Raids",
    "",
    "## Raidzeiten",
    "Montag- 18:30 Invite | 19:00 Uhr Start",
].join("\n");

describe("utils/recruitmentSpecs", () => {
    describe("SPEC_CATALOG", () => {
        it("dedupes aliases sharing the same spec key", () => {
            const shadowEntries = SPEC_CATALOG.filter((s) => s.name === "Shadow Priest");
            expect(shadowEntries).toHaveLength(1);
        });

        it("keeps distinct specs distinct", () => {
            const names = SPEC_CATALOG.map((s) => s.name);
            expect(names).toEqual(expect.arrayContaining(["Shadow Priest", "Beastmaster Hunter", "Holy Paladin"]));
        });
    });

    describe("resolveSpec", () => {
        it("matches by icon name (case-insensitive)", () => {
            expect(resolveSpec("Shadow", "")?.name).toBe("Shadow Priest");
        });

        it("falls back to matching by label text", () => {
            expect(resolveSpec("", "Shadow Priest")?.name).toBe("Shadow Priest");
        });

        it("returns null when nothing matches", () => {
            expect(resolveSpec("totally-unknown-icon", "Not A Spec")).toBeNull();
        });
    });

    describe("parseWantedBlock", () => {
        it("finds the contiguous run of recognized spec lines, ignoring unrelated ## headings", () => {
            const result = parseWantedBlock(REAL_BODY);
            expect(result.blockStart).toBe(3);
            expect(result.blockEnd).toBe(4);
            expect(result.entries).toHaveLength(2);
            expect(result.entries[0].spec.name).toBe("Shadow Priest");
            expect(result.entries[0].iconName).toBe("shadow");
            expect(result.entries[0].iconId).toBe("1362785832133595177");
            // label text says just "Hunter" even though the emoji is the beastmastery
            // spec icon — the icon match still resolves it to Beastmaster Hunter.
            expect(result.entries[1].spec.name).toBe("Beastmaster Hunter");
            expect(result.entries[1].label).toBe("Hunter");
        });

        it("reports no block for a body with no recognized spec lines", () => {
            const result = parseWantedBlock("## Gesucht\n\nNoch nichts Konkretes.\n\n## Raidzeiten\nMontag 20 Uhr");
            expect(result.blockStart).toBe(-1);
            expect(result.entries).toHaveLength(0);
        });

        it("handles an empty body", () => {
            const result = parseWantedBlock("");
            expect(result.blockStart).toBe(-1);
            expect(result.entries).toHaveLength(0);
        });
    });

    describe("buildSpecLine", () => {
        it("includes the emoji code when given", () => {
            const spec = resolveSpec("shadow", "");
            expect(buildSpecLine(spec, "<:shadow:123>")).toBe("## <:shadow:123> Shadow Priest");
        });

        it("omits the emoji when none is available", () => {
            const spec = resolveSpec("shadow", "");
            expect(buildSpecLine(spec, "")).toBe("## Shadow Priest");
        });
    });

    describe("insertSpecLine", () => {
        it("appends to an existing block without disturbing the rest of the text", () => {
            const spec = resolveSpec("holypala", "");
            const updated = insertSpecLine(REAL_BODY, spec, "<:holypala:999>");
            const lines = updated.split("\n");
            expect(lines[5]).toBe("## <:holypala:999> Holy Paladin");
            // the rest of the message is untouched, just shifted down by one line
            expect(lines[7]).toBe("## Vorraussetzungen & Anforderungen");
        });

        it("creates a block after a 'Gesucht' heading when none exists yet", () => {
            const body = "## Gesucht\n\nText ohne Klassenliste.\n\n## Raidzeiten\nMontag";
            const spec = resolveSpec("shadow", "");
            const updated = insertSpecLine(body, spec, "<:shadow:1>");
            expect(updated.split("\n")).toEqual([
                "## Gesucht",
                "## <:shadow:1> Shadow Priest",
                "",
                "Text ohne Klassenliste.",
                "",
                "## Raidzeiten",
                "Montag",
            ]);
        });

        it("falls back to appending a fresh block when nothing matches at all", () => {
            const spec = resolveSpec("shadow", "");
            const updated = insertSpecLine("Nur ein Satz ohne Ueberschriften.", spec, "<:shadow:1>");
            expect(updated).toBe("Nur ein Satz ohne Ueberschriften.\n\n## Gesucht\n## <:shadow:1> Shadow Priest");
        });

        it("starts a block from scratch for a fully empty body", () => {
            const spec = resolveSpec("shadow", "");
            expect(insertSpecLine("", spec, "<:shadow:1>")).toBe("## Gesucht\n## <:shadow:1> Shadow Priest");
        });
    });

    describe("removeSpecLine", () => {
        it("removes exactly the targeted line and nothing else", () => {
            const updated = removeSpecLine(REAL_BODY, 4);
            const lines = updated.split("\n");
            expect(lines).toHaveLength(REAL_BODY.split("\n").length - 1);
            expect(lines.some((l) => l.includes("beastmastery"))).toBe(false);
            expect(lines.some((l) => l.includes("shadow"))).toBe(true);
        });

        it("is a no-op for an out-of-range index", () => {
            expect(removeSpecLine(REAL_BODY, 999)).toBe(REAL_BODY);
            expect(removeSpecLine(REAL_BODY, -1)).toBe(REAL_BODY);
        });
    });

    describe("insert + remove round trip", () => {
        it("returns to an equivalent body after adding then removing the same spec", () => {
            const spec = resolveSpec("holypala", "");
            const withSpec = insertSpecLine(REAL_BODY, spec, "<:holypala:999>");
            const parsedAfterInsert = parseWantedBlock(withSpec);
            const addedIndex = parsedAfterInsert.entries.find((e) => e.spec?.name === "Holy Paladin").index;
            const backToOriginal = removeSpecLine(withSpec, addedIndex);
            expect(backToOriginal).toBe(REAL_BODY);
        });
    });
});
