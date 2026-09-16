// scripts/import-raidhelper-history.js (#291): flags, the console summary, and a
// run that hands its flags to the import. Nothing is read or written for real.
jest.mock("dotenv", () => ({ config: jest.fn() }));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: jest.fn(() => ({ guildId: "g-config" })) }));
jest.mock("../../src/web/raidhelperHistoryImport", () => ({
    runImport: jest.fn(async (opts) => ({
        dryRun: opts.dryRun, perCategory: 10, liveError: null, stored: opts.dryRun ? null : { events: 1, entries: 2, users: 2 },
        categories: [{ categoryId: "c1", categoryName: "Mittwoch", events: 1, entries: 2, skipped: 0 }],
        summary: { events: 1, entries: 2, users: 2, skippedEvents: 0, unmapped: { Unholy_DPS: 1 } },
    })),
}));

const { runImport } = require("../../src/web/raidhelperHistoryImport");
const { parseArgs, formatResult, main } = require("../../scripts/import-raidhelper-history");

describe("scripts/import-raidhelper-history", () => {
    beforeEach(() => jest.clearAllMocks());

    it("reads its flags", () => {
        expect(parseArgs(["--dry-run", "--per-category", "5", "--guild", "123", "--no-live", "--dev"]))
            .toEqual({ dev: true, dryRun: true, live: false, perCategory: "5", guildId: "123" });
        expect(parseArgs([])).toEqual({ dev: false, dryRun: false, live: true, perCategory: "", guildId: "" });
        expect(parseArgs(["--guild", "--dry-run"]).guildId).toBe("");
    });

    it("runs a dry run on the configured event server and prints a German summary", async () => {
        const log = jest.fn();
        const result = await main(["--dry-run"], { log });
        expect(runImport).toHaveBeenCalledWith({ guildId: "g-config", perCategory: "", dryRun: true, live: true, byName: "Skript" });
        expect(result.stored).toBeNull();
        const text = log.mock.calls.map((c) => c[0]).join("\n");
        expect(text).toMatch(/Probelauf/);
        expect(text).toMatch(/Mittwoch: 1 Events, 2 Einträge/);
        expect(text).toMatch(/Nicht zuordenbar: Unholy_DPS/);
    });

    it("says what was stored on a real run", () => {
        const lines = formatResult({
            dryRun: false, perCategory: 3, categories: [], liveError: "HTTP 404", stored: { events: 2, entries: 5, users: 4 },
            summary: { events: 2, entries: 5, users: 4, skippedEvents: 1, unmapped: {} },
        });
        expect(lines[0]).toBe("Import gespeichert.");
        expect(lines.join("\n")).toMatch(/nur gespeicherte Events/);
        expect(lines.join("\n")).toMatch(/Neu gespeichert: 2 Events, 5 Einträge/);
    });
});
