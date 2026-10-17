// scripts/seed-test-raid.js writes a whole test raid into the local stores - but only when it is started as a script. A `require`
// (a test, a syntax check) must run nothing and write nothing: once a require by mistake created an event and rebuilt "BT Demo".
//
// Deterministic in any environment (CI: no .env.dev, no data/, a cold Jest cache): the module is loaded once BEFORE the spies (Jest
// transforms it then and may write its own cache files with fs), and loaded again in a fresh module registry with the spies on - that
// second load runs the script's top level exactly like a `require` does, without Jest's cache writes. Only writes of the project count
// (data/, the stores), never Jest's.
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../scripts/seed-test-raid.js");
const ROOT = path.join(__dirname, "../..");

/** A write the script could have caused: a path inside the project (not node_modules, not a cache). */
const ownWrite = (target) => {
    const p = path.resolve(String(target || ""));
    return p.startsWith(ROOT) && !p.includes(`${path.sep}node_modules${path.sep}`) && !p.includes(`${path.sep}.cache${path.sep}`);
};

describe("seed-test-raid", () => {
    afterEach(() => jest.restoreAllMocks());

    it("does nothing when it is required: no file of the project written, nothing printed, no exit", () => {
        // warm-up: Jest's transform (and its cache writes) happens here, not under the spies
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
        expect(typeof mod.seedPlan).toBe("function");
        expect(mod.ROSTER).toHaveLength(25);
        expect(mod.TEMPLATE_NAME).toBe("BT Demo");
    });

    it("Illidan's phase 2 animation survives a save untouched: every frame, change and loop names an object of its board", () => {
        const { cleanBoard } = require("../../src/services/raidplan/raidplanBoard");
        const seed = require(FILE);
        const raw = seed.illidanBoard("bt/illidan-stormrage", seed.demoSlots(), false);
        const { board, dropped } = cleanBoard(raw, { allowedUserIds: [], allowTokens: false });
        expect(dropped).toBe(0);
        const [scene] = board.scenes;
        const [want] = raw.scenes;
        expect(scene.stepId).toBe("illkite");
        expect(scene.frames.map((f) => [f.at, f.changes.length])).toEqual(want.frames.map((f) => [f.at, f.changes.length]));
        expect(scene.loops.map((l) => [l.obj, l.from, l.trail])).toEqual(want.loops.map((l) => [l.obj, l.from, l.trail]));
        // the glaives, flames, leash circles and the Fireball's splash start hidden and appear in their frame; the tank rows place
        // nothing of their own meanwhile
        expect(scene.frames[0].changes.filter((c) => c.hidden === true).map((c) => c.obj).sort()).toEqual(["icon:flame1", "icon:flame2", "icon:glaivee", "icon:glaivew", "zone:fireball", "zone:leashe", "zone:leashw"]);
        expect(board.autoPlace).toBe(false);
        // a tank starts kiting where it stands after the frames, and its flame follows on the same path a second later
        const tank2 = scene.loops.find((l) => l.obj === "slot:illtk2");
        const flame1 = scene.loops.find((l) => l.obj === "icon:flame1");
        expect(flame1.path).toEqual(tank2.path);
        expect(flame1.from - tank2.from).toBe(1);
        expect(board.slots.find((s) => s.id === "illtk2")).toMatchObject({ x: tank2.path[0][0], y: tank2.path[0][1] });
        // the auto demo places nothing by hand
        expect(seed.illidanBoard("bt/illidan-stormrage", seed.demoSlots(), true)).toMatchObject({ slots: [], icons: [], scenes: [] });
    });

    it("starts only as a script (require.main === module), never by a bare call; its stores are loaded inside main / seedPlan only", () => {
        const src = fs.readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
        expect(src).toContain("if (require.main === module) main();");
        expect(src).not.toMatch(/^main\(\);$/m);
        // at the top level only fs: every store (which could write) is required inside a function
        const top = src.split("\n").filter((l) => /^const .*require\(/.test(l));
        expect(top).toEqual(["const fs = require(\"fs\");"]);
    });
});
