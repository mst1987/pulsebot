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

describe("utils/wowsims — what the binary gets wrong, and what we do about it", () => {
    const claData = require("../../../src/config/claData");
    const { equipmentFor } = require("../../../src/utils/wowsims/loadout");

    const META = Number(claData.META_GEM_IDS[0]);
    const BLUE = Number(claData.BLUE_GEM_IDS[0]);
    const RED = Number(claData.RED_GEM_IDS[0]);
    const gearWith = (gems) => ({ items: [{ slot: 0, itemId: 31064, gems, enchantId: 0, itemLevel: 146 }] });

    describe("an inactive meta gem", () => {
        // ⚠️ Measured against the pinned binary: WoWSims does NOT check a meta
        // gem's colour requirement, so an inactive one still contributes. A
        // raider who socketed wrongly would be simulated as if they had not.
        it("is dropped from the loadout, with a warning", () => {
            // 34220 (Chaotic Skyfire Diamond) wants two blue gems.
            const { items, warnings } = equipmentFor(gearWith([34220, RED, RED]));
            expect(items[0].gems[0]).toBe(0);
            expect(warnings.join(" ")).toMatch(/Meta-Edelstein inaktiv/);
        });

        it("stays when the requirement is met", () => {
            const { items, warnings } = equipmentFor(gearWith([34220, BLUE, BLUE]));
            expect(items[0].gems[0]).toBe(34220);
            expect(warnings.join(" ")).not.toMatch(/Meta/);
        });

        it("leaves the other gems alone either way", () => {
            const { items } = equipmentFor(gearWith([34220, RED, RED]));
            expect(items[0].gems.slice(1)).toEqual([RED, RED]);
        });

        it("does nothing to a loadout without a meta gem", () => {
            const { items, warnings } = equipmentFor(gearWith([BLUE, RED]));
            expect(items[0].gems).toEqual([BLUE, RED]);
            expect(warnings).toEqual([]);
        });

        it("uses the same rule as the gear check, so the two cannot disagree", () => {
            const { metaGemActive } = require("../../../src/utils/logcheck/gearIssues");
            expect(metaGemActive(34220, 0, 0, 2)).toBe(true);
            expect(metaGemActive(34220, 3, 0, 0)).toBe(false);
            expect(META).toBeGreaterThan(0);
        });
    });

    describe("a gem the binary does not know", () => {
        // ⚠️ It aborts the WHOLE run, not just that item — so without a retry
        // one exotic gem costs that raider their number completely.
        it("is recognised in the error text", () => {
            const msg = "When parsing item 31064, socket 0 had gem with id: 41285\nThis gem is not in the database.";
            expect(engine.parseUnknownGemId(msg)).toBe(41285);
        });

        it("is not mistaken for some other failure", () => {
            expect(engine.parseUnknownGemId("wowsimcli lieferte kein Ergebnis")).toBeNull();
            expect(engine.parseUnknownGemId("")).toBeNull();
            expect(engine.parseUnknownGemId(null)).toBeNull();
        });

        it("is removed from every socket it sits in, without touching the rest", () => {
            const request = {
                raid: { parties: [{ players: [{ equipment: { items: [
                    { id: 1, gems: [41285, 32196] },
                    { id: 2, gems: [32196] },
                    { id: 3 },
                ] } }] }] },
            };
            const stripped = engine.stripGem(request, 41285);
            const items = stripped.raid.parties[0].players[0].equipment.items;
            expect(items[0].gems).toEqual([0, 32196]);
            expect(items[1].gems).toEqual([32196]);
            expect(items[2].gems).toBeUndefined();
        });

        it("does not modify the request it was given", () => {
            const request = { raid: { parties: [{ players: [{ equipment: { items: [{ id: 1, gems: [41285] }] } }] }] } };
            engine.stripGem(request, 41285);
            expect(request.raid.parties[0].players[0].equipment.items[0].gems).toEqual([41285]);
        });
    });
});

describe("utils/wowsims/engine — the WoWSims export", () => {
    const gear = {
        character: "Devihra",
        className: "Priest",
        items: [
            { slot: 0, itemId: 31064, itemLevel: 146, gems: [25893], enchantId: 3002 },
            { slot: 4, itemId: 31065, itemLevel: 146, gems: [], enchantId: 2661 },
        ],
    };

    it("carries everything the page's own run uses", () => {
        // An export that left any of it out would reproduce a different number
        // than the page shows — worse than no export, because it would make the
        // page look wrong.
        const exp = engine.buildIndividualExport({ gear, specEntry: specByKey("Priest-Shadow") });
        expect(exp.supported).toBe(true);
        expect(exp.data.player.equipment.items).toHaveLength(2);
        expect(exp.data.player.talentsString).toBe(specByKey("Priest-Shadow").talents);
        expect(exp.data.player.rotation).toBeTruthy();
        expect(exp.data.player.consumables).toBeTruthy();
        expect(exp.data.raidBuffs).toBeTruthy();
        expect(exp.data.partyBuffs).toBeTruthy();
        expect(exp.data.debuffs).toBeTruthy();
        expect(exp.data.encounter.targets[0].level).toBe(73);
    });

    it("builds the same player the simulation runs", () => {
        const exp = engine.buildIndividualExport({ gear, specEntry: specByKey("Priest-Shadow") });
        const req = engine.buildRequest({ gear, specEntry: specByKey("Priest-Shadow") });
        expect(exp.data.player).toEqual(req.request.raid.parties[0].players[0]);
    });

    it("refuses a spec WoWSims cannot simulate, with a reason", () => {
        const exp = engine.buildIndividualExport({ gear, specEntry: specByKey("Druid-Restoration") });
        expect(exp.supported).toBe(false);
        expect(exp.data).toBeNull();
        expect(exp.warnings.join(" ")).toMatch(/keine Simulation/i);
    });

    it("names the release it belongs to", () => {
        const exp = engine.buildIndividualExport({ gear, specEntry: specByKey("Priest-Shadow") });
        expect(exp.sim).toContain(engine.WOWSIMS_VERSION);
    });
});
