jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../../src/config/paths");
const { isDone, markDone } = require("../../../src/stores/settings/migrationMarkStore");

const FILE = settingsPath("migrations.json");

beforeEach(() => {
    fs.__store.clear();
});

describe("stores/settings/migrationMarkStore (#920)", () => {
    it("knows nothing without a file", () => {
        expect(isDone("reportGuilds")).toBe(false);
    });

    it("marks a migration as done and keeps the first time", () => {
        markDone("reportGuilds", 100);
        expect(isDone("reportGuilds")).toBe(true);
        expect(isDone("other")).toBe(false);
        markDone("reportGuilds", 200);
        expect(JSON.parse(fs.__store.get(FILE)).done).toEqual({ reportGuilds: 100 });
    });

    it("drops broken entries from the file", () => {
        fs.__store.set(FILE, JSON.stringify({ done: { a: 5, b: "nope" }, junk: 1 }));
        expect(isDone("a")).toBe(true);
        expect(isDone("b")).toBe(false);
        fs.__store.set(FILE, JSON.stringify({ done: "x" }));
        expect(isDone("a")).toBe(false);
    });

    it("writes to another file with useFile and returns to the default with null", () => {
        const { useFile } = require("../../../src/stores/settings/migrationMarkStore");
        const other = settingsPath("migrations-other.json");
        useFile(other);
        try {
            markDone("reportGuilds");
            expect(isDone("reportGuilds")).toBe(true);
            expect(Number.isFinite(JSON.parse(fs.__store.get(other)).done.reportGuilds)).toBe(true);
            expect(fs.__store.has(FILE)).toBe(false);
        } finally {
            useFile(null);
        }
        expect(isDone("reportGuilds")).toBe(false);
    });
});
