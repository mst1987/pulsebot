// scripts/seed-loot-raid.js (#1037) writes a raid group with a stored loot snapshot into the local
// stores - only when it is started as a script; a `require` runs nothing and writes nothing (same
// guard as seed-test-raid). Its snapshot comes from the local game data alone: real Kara BiS ids,
// all three sources, overlaps between raiders, and no request (test/setup/noNetwork.js).
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../scripts/seed-loot-raid.js");
const ROOT = path.join(__dirname, "../..");

const ownWrite = (target) => {
    const p = path.resolve(String(target || ""));
    return p.startsWith(ROOT) && !p.includes(`${path.sep}node_modules${path.sep}`) && !p.includes(`${path.sep}.cache${path.sep}`);
};

describe("seed-loot-raid", () => {
    afterEach(() => jest.restoreAllMocks());

    it("does nothing when it is required: no file of the project written, nothing printed, no exit", () => {
        jest.isolateModules(() => { require(FILE); });
        const write = jest.spyOn(fs, "writeFileSync");
        const rename = jest.spyOn(fs, "renameSync");
        const mkdir = jest.spyOn(fs, "mkdirSync");
        const log = jest.spyOn(console, "log").mockImplementation(() => {});
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        const exit = jest.spyOn(process, "exit").mockImplementation(() => {});
        let mod = null;
        jest.isolateModules(() => { mod = require(FILE); });
        expect(write.mock.calls.filter((c) => ownWrite(c[0]))).toEqual([]);
        expect(rename.mock.calls.filter((c) => ownWrite(c[1]))).toEqual([]);
        expect(mkdir.mock.calls.filter((c) => ownWrite(c[0]))).toEqual([]);
        expect(log).not.toHaveBeenCalled();
        expect(err).not.toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();
        expect(typeof mod.main).toBe("function");
        expect(mod.TITLE).toBe("Kara Loot Test");
        expect(mod.RAIDS).toBe(5);
    });

    it("starts only as a script, its stores are loaded inside functions only", () => {
        const src = fs.readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
        expect(src).toContain("if (require.main === module) main();");
        expect(src).not.toMatch(/^main\(\);$/m);
        const top = src.split("\n").filter((l) => /^const .*require\(/.test(l));
        expect(top).toEqual(["const fs = require(\"fs\");"]);
    });

    it("50 characters: 10 tanks, 15 healers, 25 damage dealers, valid TBC specs, unique names", () => {
        const { roster } = require(FILE);
        const { spec } = require("../../src/config/gameVersions");
        const chars = roster();
        expect(chars).toHaveLength(50);
        expect(new Set(chars.map(([n]) => n.toLowerCase())).size).toBe(50);
        const roles = { tank: 0, healer: 0, dps: 0 };
        for (const [, key] of chars) {
            const s = spec(key, "tbc");
            expect(s).toBeTruthy();
            roles[s.role === "tank" || s.role === "healer" ? s.role : "dps"]++;
        }
        expect(roles).toEqual({ tank: 10, healer: 15, dps: 25 });
    });

    it("the snapshot holds all three sources from real drop data, with overlaps, and loads no API client", () => {
        const { roster, lootSnapshot } = require(FILE);
        const chars = roster();
        const snap = lootSnapshot(chars, (i) => `u${i}`);
        expect(snap).toMatchObject({ versionId: "tbc", instanceIds: ["kara"] });
        expect(snap.counts).toMatchObject({ signups: 50, softres: 15, gear: 25 });
        expect(snap.counts.bis + snap.counts.spec).toBe(35);
        expect(snap.counts.bis).toBeGreaterThan(0);
        expect(snap.counts.spec).toBeGreaterThanOrEqual(10);
        // every numeric item is in the item table with a name (from the local TBC table, not invented)
        const ids = Object.values(snap.wants).flatMap((byChar) => Object.values(byChar)).flatMap((w) => w.items.map((x) => x.itemId));
        const numeric = ids.filter((id) => typeof id === "number");
        expect(numeric.length).toBeGreaterThan(0);
        for (const id of numeric) expect(snap.items[id].name).not.toBe("");
        // several raiders want the same item: something for the goal to spread
        const seen = new Map();
        for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1);
        expect([...seen.values()].some((n) => n > 1)).toBe(true);
        // no API call: test/setup/noNetwork.js would have thrown on any request
    });
});
