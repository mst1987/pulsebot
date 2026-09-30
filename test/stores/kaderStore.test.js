// The Kaderplaner's store (docs/kaderplaner.md): one planner per server in
// data/settings/kader.json, normalised on the way in and out — and read by the
// Kaderplaner alone: wishes, answers, notes, votes and comments never leave it.
const fs = require("fs");
const path = require("path");
const { tempStoreFile } = require("../helpers/tempStore");
const kaderStore = require("../../src/stores/kaderStore");

let file;
beforeEach(() => {
    file = tempStoreFile("kader-store.json");
    if (fs.existsSync(file)) fs.unlinkSync(file);
    kaderStore.useFile(file);
});
afterAll(() => kaderStore.useFile(null));

describe("stores/kaderStore", () => {
    it("reads an empty planner when nothing is stored", () => {
        expect(kaderStore.readPlanner("g1")).toEqual({ v: 2, accounts: [], assignments: {}, kaders: [] });
    });

    it("keeps the planners of different servers apart", () => {
        kaderStore.writePlanner("g1", { v: 2, kaders: [{ id: "k1", name: "Hyjal" }] });
        kaderStore.writePlanner("g2", { v: 2, accounts: [{ userId: "444444444444444444", displayName: "Hand" }] });
        expect(kaderStore.readPlanner("g1").kaders.map((k) => k.id)).toEqual(["k1"]);
        expect(kaderStore.readPlanner("g1").accounts).toEqual([]);
        expect(kaderStore.readPlanner("g2").accounts).toHaveLength(1);
        expect(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).guilds).sort()).toEqual(["g1", "g2"]);
    });

    it("normalises what it writes and survives a broken file", () => {
        const stored = kaderStore.writePlanner("g1", { v: 2, kaders: [{ id: "k1", players: { x: { state: "boss" } } }] });
        expect(stored.kaders[0].players.x.state).toBe("pool");
        fs.writeFileSync(file, "{ nope");
        expect(kaderStore.readPlanner("g1").kaders).toEqual([]);
    });

    it("migrates old planners once, per server", () => {
        fs.writeFileSync(file, JSON.stringify({ guilds: {
            g1: { rosters: [{ id: "r1", name: "Alt", size: 10, members: [{ userId: "111111111111111111", role: "tank" }], bench: [] }] },
            g2: { v: 2, kaders: [] },
        } }));
        const done = kaderStore.migrateLegacy({ now: "2026-10-01T00:00:00.000Z", charOfFor: () => () => null });
        expect(done).toEqual([{ guildId: "g1", kaders: 1, roster: 1, bench: 0, variants: 0 }]);
        expect(kaderStore.readPlanner("g1").kaders[0].players["111111111111111111"]).toMatchObject({ state: "roster", decision: null });
        expect(kaderStore.migrateLegacy({ now: "x", charOfFor: () => () => null })).toEqual([]);
    });

    // The privacy rule of docs/kaderplaner.md: only the Kaderplaner's own
    // modules (and the start's migration) read this store.
    it("is read by the Kaderplaner alone", () => {
        const SRC = path.join(__dirname, "..", "..", "src");
        const readers = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.name.endsWith(".js") && /require\(\s*["'][^"']*kaderStore["']\s*\)/.test(fs.readFileSync(full, "utf8"))) {
                    readers.push(path.relative(SRC, full).split(path.sep).join("/"));
                }
            }
        };
        walk(SRC);
        expect(readers.sort()).toEqual(["stores/settingsMigration.js", "web/apiRoutes/kader.js"]);
    });
});
