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
        expect(scene.loops).toEqual([]);
        // the glaives, flames and every zone (leash circles, the Fireball's splash, the green and the blue fire) start hidden and appear
        // in their frame; the tank rows place nothing of their own meanwhile
        expect(scene.frames[0].changes.filter((c) => c.hidden === true).map((c) => c.obj).sort()).toEqual(["icon:flame1", "icon:flame2", "icon:glaivee", "icon:glaivew", ...board.zones.map((z) => `zone:${z.id}`)].sort());
        expect(board.autoPlace).toBe(false);
        // stop and go: in every kite step the flame has stood, lays its green fire, then the druid moves on and only after him the flame
        const moves = (obj) => scene.frames.flatMap((f) => f.changes.filter((c) => c.obj === obj && c.x !== undefined).map((c) => ({ f, c })));
        // (the first two moves: his place in phase 1, then out to where he takes his flame)
        const kiteSteps = moves("slot:illtk2").slice(2);
        expect(kiteSteps.length).toBeGreaterThanOrEqual(5);
        for (const { f, c } of kiteSteps) {
            const fire = f.changes.find((x) => /^zone:blazew\d+$/.test(x.obj) && x.hidden === false);
            const flame = f.changes.find((x) => x.obj === "icon:flame1" && x.x !== undefined);
            expect(fire.delay + fire.dur).toBeLessThanOrEqual(c.delay);
            expect(flame.delay).toBeGreaterThan(c.delay);
        }
        // the green fire stays: once laid, no frame takes it away
        expect(scene.frames.slice(1).flatMap((f) => f.changes).filter((c) => /^zone:blaze/.test(c.obj) && c.hidden === true)).toEqual([]);
        // the Eye Blast: the blue fire lies across the west druid's way, he waits during the beam and then goes through it (behind him the
        // green fire), and it goes again later
        const eye = scene.frames.find((f) => f.changes.some((c) => c.obj === "icon:illidanb" && c.badge === "spell_fire_fireball02"));
        expect(eye.changes.some((c) => c.obj === "slot:illtk2")).toBe(false);
        const blue = board.zones.filter((z) => /^bluefire/.test(z.id));
        expect(eye.changes.filter((c) => /^zone:bluefire/.test(c.obj) && c.hidden === false)).toHaveLength(blue.length);
        const at = (i) => scene.frames.indexOf(eye) + i;
        const before = moves("slot:illtk2").filter(({ f }) => scene.frames.indexOf(f) < at(0)).pop().c;
        const through = moves("slot:illtk2").find(({ f }) => scene.frames.indexOf(f) === at(1)).c;
        // the strip is turned: measured in pixels of the 16:9 map along its length (along) and across it (across), his way from
        // before to through crosses its middle line within its length, and both his stops lie off the strip
        expect(blue).toEqual([expect.objectContaining({ type: "fire", enter: "w" })]);
        const [z] = blue;
        const rad = (z.rotation * Math.PI) / 180;
        const local = ({ x, y }) => {
            const dx = (x - (z.x + z.w / 2)) * 16, dy = (y - (z.y + z.h / 2)) * 9;
            return { along: dx * Math.cos(rad) + dy * Math.sin(rad), across: dy * Math.cos(rad) - dx * Math.sin(rad) };
        };
        const a = local(before), b = local(through);
        expect(Math.sign(a.across)).not.toBe(Math.sign(b.across));
        expect(Math.min(Math.abs(a.across), Math.abs(b.across))).toBeGreaterThan((z.h * 9) / 2);
        const cross = a.along + (b.along - a.along) * (a.across / (a.across - b.across));
        expect(Math.abs(cross)).toBeLessThan((z.w * 16) / 2);
        // the green fire flares up from its middle
        expect(board.zones.filter((zz) => /^blaze/.test(zz.id)).every((zz) => zz.type === "fire" && zz.enter === "grow")).toBe(true);
        expect(scene.frames.slice(at(2)).flatMap((f) => f.changes).filter((c) => /^zone:bluefire/.test(c.obj) && c.hidden === true)).toHaveLength(blue.length);
        // a druid's slot stands where he takes his flame
        expect(board.slots.find((s) => s.id === "illtk2")).toMatchObject({ x: moves("slot:illtk2")[1].c.x, y: moves("slot:illtk2")[1].c.y });
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
