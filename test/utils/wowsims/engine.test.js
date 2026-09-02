const fs = require("fs");
const path = require("path");
const engine = require("../../../src/utils/wowsims/engine");
const { specByKey } = require("../../../src/config/casterSpecs");

// No test here runs the binary — buildRequest is pure, and isAvailable() is
// driven purely by the env var. That is the point of the split: the request
// shape is the part that can break silently (WoWSims discards unknown fields
// without a word), so it is the part that is asserted.
const gear = {
    character: "Devihra",
    className: "Priest",
    items: [
        { slot: 0, itemId: 31064, itemLevel: 146, gems: [25893], enchantId: 3002 },
        { slot: 4, itemId: 31065, itemLevel: 146, gems: [], enchantId: 2661 },
    ],
};

describe("utils/wowsims/engine", () => {
    const savedPath = process.env.WOWSIMCLI_PATH;
    afterEach(() => {
        if (savedPath === undefined) delete process.env.WOWSIMCLI_PATH;
        else process.env.WOWSIMCLI_PATH = savedPath;
    });

    describe("isAvailable", () => {
        it("is false without WOWSIMCLI_PATH", () => {
            delete process.env.WOWSIMCLI_PATH;
            expect(engine.isAvailable()).toBe(false);
        });

        it("is false when the path points at nothing", () => {
            process.env.WOWSIMCLI_PATH = path.join(__dirname, "does-not-exist.exe");
            expect(engine.isAvailable()).toBe(false);
        });

        it("is true for a file that exists", () => {
            process.env.WOWSIMCLI_PATH = __filename;
            expect(engine.isAvailable()).toBe(true);
        });
    });

    describe("buildRequest", () => {
        it("builds a one-player raid the binary can run", () => {
            const { supported, request } = engine.buildRequest({ gear, specEntry: specByKey("Priest-Shadow") });
            expect(supported).toBe(true);
            expect(request.raid.parties).toHaveLength(1);
            expect(request.raid.parties[0].players).toHaveLength(1);
            expect(request.raid.parties[0].players[0].equipment.items).toHaveLength(2);
        });

        it("always sends an encounter target with a level", () => {
            // An empty target list leaves primaryTarget undefined and the sim
            // dies reading .level off it.
            const { request } = engine.buildRequest({ gear, specEntry: specByKey("Mage-Arcane") });
            expect(request.encounter.targets.length).toBeGreaterThan(0);
            expect(request.encounter.targets[0].level).toBe(73);
        });

        it("pins the random seed, so an unchanged loadout gives an unchanged number", () => {
            // Without it the sim's own noise would show up as a phantom delta on
            // an item that changes nothing.
            const a = engine.buildRequest({ gear, specEntry: specByKey("Priest-Shadow") });
            const b = engine.buildRequest({ gear, specEntry: specByKey("Priest-Shadow") });
            expect(a.request.simOptions.randomSeed).toBe("1");
            expect(JSON.stringify(a.request)).toBe(JSON.stringify(b.request));
        });

        it("puts the swapped item into the request", () => {
            const { request } = engine.buildRequest({
                gear, specEntry: specByKey("Priest-Shadow"), swap: { slot: 0, itemId: 32478 },
            });
            expect(request.raid.parties[0].players[0].equipment.items[0].id).toBe(32478);
        });

        it("refuses a spec WoWSims does not model, with a reason", () => {
            const built = engine.buildRequest({ gear, specEntry: specByKey("Druid-Restoration") });
            expect(built.supported).toBe(false);
            expect(built.request).toBeNull();
            expect(built.warnings.join(" ")).toMatch(/keine Simulation/i);
        });

        it("refuses a null spec instead of throwing", () => {
            expect(engine.buildRequest({ gear, specEntry: null }).supported).toBe(false);
        });

        it("carries the spec's own buff set, not a shared one", () => {
            // A spec must not receive the buff it supplies itself, or it is
            // counted twice and outranks the others for the wrong reason.
            const shadow = engine.buildRequest({ gear, specEntry: specByKey("Priest-Shadow") });
            expect(shadow.request.raid.debuffs.misery).toBeUndefined();
            const lock = engine.buildRequest({
                gear: { ...gear, className: "Warlock" }, specEntry: specByKey("Warlock-Destruction"),
            });
            expect(lock.request.raid.debuffs.misery).toBe(true);
        });
    });

    describe("simulate without a binary", () => {
        it("answers 'not available' instead of failing", async () => {
            delete process.env.WOWSIMCLI_PATH;
            const res = await engine.simulate({ gear, specEntry: specByKey("Priest-Shadow") });
            expect(res.available).toBe(false);
            expect(res.dps).toBeNull();
        });
    });

    it("pins the same WoWSims release as the data generator", () => {
        // The protojson schema, the vendored rotations and the embedded item DB
        // all hang on the release, so the pins move together.
        const script = fs.readFileSync(path.join(__dirname, "..", "..", "..", "scripts", "fetch-wowsims-data.js"), "utf8");
        const fetchBin = fs.readFileSync(path.join(__dirname, "..", "..", "..", "scripts", "fetch-wowsimcli.js"), "utf8");
        const simVersion = (script.match(/SIM_VERSION\s*=\s*"([^"]+)"/) || [])[1];
        const binVersion = (fetchBin.match(/VERSION\s*=\s*"([^"]+)"/) || [])[1];
        expect(simVersion).toBe(engine.WOWSIMS_VERSION);
        expect(binVersion).toBe(engine.WOWSIMS_VERSION);
    });
});
