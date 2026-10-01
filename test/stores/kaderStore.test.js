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

    describe("revisions and the activity log (Live)", () => {
        const KADER = { id: "k1", name: "Hyjal", players: { "111111111111111111": { state: "pool", interview: { note: "x" } } }, questions: [{ id: "q1", text: "Voice", type: "text" }] };

        it("reads a planner stored before they existed as revision 0 without a log, and writes it back unchanged", () => {
            fs.writeFileSync(file, JSON.stringify({ guilds: { g1: { v: 2, kaders: [KADER] } } }));
            const p = kaderStore.readPlanner("g1");
            expect(p.rev).toBeUndefined();
            expect(p.kaders[0].rev).toBeUndefined();
            expect(p.kaders[0].activity).toBeUndefined();
            expect(p.kaders[0].players["111111111111111111"].interview.rev).toBeUndefined();
            expect(kaderStore.liveState("g1", "k1")).toEqual({ found: true, rev: 0, sharedRev: 0, activity: [] });
            // idempotent: writing what was read changes nothing
            kaderStore.writePlanner("g1", p);
            expect(kaderStore.readPlanner("g1")).toEqual(p);
        });

        it("keeps revisions and the log, and drops what is no revision or no known line", () => {
            kaderStore.writePlanner("g1", {
                v: 2, rev: 7, sharedRev: 3,
                assignments: { "111111111111111111": { characters: [{ id: "c1", name: "A B", className: "Mage", specs: [] }], rev: 5, by: "u", at: "t" } },
                kaders: [{
                    ...KADER, rev: 6,
                    questions: [{ id: "q1", text: "Voice", type: "text", rev: 4 }],
                    players: { "111111111111111111": { state: "pool", interview: { rev: 6 } } },
                    activity: [
                        { rev: 6, at: "t", by: "u", type: "state", playerId: "111111111111111111", from: "pool", to: "selected", note: "GEHEIM" },
                        { rev: "7", type: "state" }, { rev: 8, type: "hack" }, null,
                    ],
                }],
            });
            const p = kaderStore.readPlanner("g1");
            expect(p).toMatchObject({ rev: 7, sharedRev: 3 });
            expect(p.assignments["111111111111111111"]).toMatchObject({ rev: 5, by: "u", at: "t" });
            expect(p.kaders[0]).toMatchObject({ rev: 6, questions: [{ id: "q1", rev: 4 }] });
            expect(p.kaders[0].players["111111111111111111"].interview.rev).toBe(6);
            expect(p.kaders[0].activity).toEqual([{ rev: 6, at: "t", by: "u", type: "state", playerId: "111111111111111111", from: "pool", to: "selected" }]);
        });

        it("answers the live state of a Kader, fresh after every write, and nothing for one that is not there", () => {
            kaderStore.writePlanner("g1", { v: 2, sharedRev: 2, kaders: [{ ...KADER, rev: 2 }] });
            expect(kaderStore.liveState("g1", "k1")).toMatchObject({ found: true, rev: 2, sharedRev: 2 });
            expect(kaderStore.liveState("g1", "nope")).toEqual({ found: false, rev: 0, sharedRev: 2, activity: [] });
            expect(kaderStore.liveState("g2", "k1").found).toBe(false);
            kaderStore.writePlanner("g1", { v: 2, sharedRev: 2, kaders: [{ ...KADER, rev: 3 }] });
            expect(kaderStore.liveState("g1", "k1").rev).toBe(3);
            // an edit by hand counts too (another size, another mtime)
            const raw = JSON.parse(fs.readFileSync(file, "utf8"));
            raw.guilds.g1.kaders[0].rev = 12345;
            fs.writeFileSync(file, JSON.stringify(raw));
            expect(kaderStore.liveState("g1", "k1").rev).toBe(12345);
        });
    });
});

// The privacy rule of docs/kaderplaner.md: wishes, answers, notes, votes and
// comments never leave the Kaderplaner — not into a profile, the roster, another
// API or a log.
describe("the Kaderplaner's data stays in the Kaderplaner", () => {
    const SRC = path.join(__dirname, "..", "..", "src");
    /** Every backend module (web client left out) whose source matches `re`, as a path below src/. */
    function modulesMatching(re) {
        const out = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== "web-client" && entry.name !== "node_modules") walk(full);
                } else if (entry.name.endsWith(".js") && re.test(fs.readFileSync(full, "utf8"))) {
                    out.push(path.relative(SRC, full).split(path.sep).join("/"));
                }
            }
        };
        walk(SRC);
        return out.sort();
    }
    const OWN = (rel) => rel.startsWith("services/kader/") || rel.startsWith("web/kader/") || rel === "web/apiRoutes/kader.js" || rel === "stores/kaderStore.js";

    it("is read by the Kaderplaner alone (and the start's migration)", () => {
        expect(modulesMatching(/require\(\s*["'][^"']*kaderStore["']\s*\)/)).toEqual(["stores/settingsMigration.js", "web/apiRoutes/kader.js"]);
    });

    it("keeps its rules and its view to itself: nothing else requires them", () => {
        const users = modulesMatching(/require\(\s*["'][^"']*(services\/kader\/|\/kader\/kader|\.\/kader(Model|Players|Questions|Setups|Migration|AutoAssign|View|Source))[^"']*["']\s*\)/);
        expect(users.filter((rel) => !OWN(rel))).toEqual(["stores/settingsMigration.js"]);
    });

    it("writes nothing of a Kader into a log", () => {
        const logging = modulesMatching(/\b(console\.\w+|logger\.\w+)\s*\(|require\(\s*["'][^"']*\/logger["']\s*\)/).filter(OWN);
        expect(logging).toEqual([]);
    });
});
