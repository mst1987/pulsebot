// Golden master for the classlist consolidation (#428): before config/classlist.js
// became an alias table over gameVersions/classes.js, every consumer's answer
// was recorded for all 66 Raid-Helper names, every Raid-Helper spec name and an
// unknown one (test/fixtures/golden/classlistConsumers.json, with
// Math.random pinned to 0). The consumers must answer the same, except
// for the changes listed below — each one on purpose.
const golden = require("../fixtures/golden/classlistConsumers.json");
const classlist = require("../../src/config/classlist");
const setupView = require("../../src/utils/setupView");
const helper = require("../../src/utils/helper");
const recruitment = require("../../src/utils/recruitmentSpecs");
const fillSetup = require("../../src/utils/fillSetup");
const { specKeyFromRaidHelper } = require("../../src/web/eventSources");

const EMOJIS = ["holypala", "protpala", "retribution", "paladin", "fury", "arms", "protection", "warrior", "assassination",
    "sublety", "combat", "rogue", "discipline", "shadow", "holypriest", "priest", "survival", "marksman", "beastmaster",
    "demonology", "affliction", "destruction", "warlock", "firemage", "arcane", "frostmage", "mage", "feral", "guardian",
    "balance", "restoration", "druid", "unholy", "frostdk", "blooddk", "deathknight", "restosham", "elemental",
    "enhancement", "shaman"];
const interaction = { guild: { emojis: { cache: { find: (fn) => {
    const hit = EMOJIS.find((name) => fn({ name }));
    return hit ? `:${hit}:` : undefined;
} } } } };
const CLASS_NAMES = ["", "Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid", "Tank", "DK"];

// Deliberate changes, by name and output. A value patches the recorded answer
// (for tankCandidates: its first row).
const WARRIOR_KNOWN = {
    // Raid-Helper's class-only warrior used to carry the generic class "Tank",
    // so the setup view could not name its class; the class is known now.
    enrichSlot: { className: "Warrior", classColor: "#C79C6E" },
    specProfile: { className: "Warrior", classColor: "#C79C6E" },
    tankCandidates: { className: "Warrior" },
};
const EXPECTED_CHANGES = {
    WARRIOR: WARRIOR_KNOWN,
    Warrior: WARRIOR_KNOWN,
    // A survival hunter is ranged in TBC (the rule set); "melee" was Season of
    // Discovery's; Raid-Helper's class-only hunter always meant survival.
    Survival: { enrichSlot: { role: "ranged" } },
    SV: { enrichSlot: { role: "ranged" } },
    HUNTER: { enrichSlot: { role: "ranged" } },
    // Death knight specs have a role now instead of the generic "dps".
    Unholy_DPS: { enrichSlot: { role: "melee" } },
    UnholyDK: { enrichSlot: { role: "melee" } },
    Frost_DPS: { enrichSlot: { role: "melee" } },
    FrostDK: { enrichSlot: { role: "melee" } },
    // "BloodDK" is the blood tank like its two siblings, under their name.
    BloodDK: {
        enrichSlot: { specName: "Blood Tank", role: "tank" },
        specProfile: { specName: "Blood Tank" },
        tankCandidates: { specName: "Blood Tank" },
    },
};

function expected(name, output) {
    const recorded = golden[name][output];
    const patch = (EXPECTED_CHANGES[name] || {})[output];
    if (!patch) return recorded;
    if (Array.isArray(recorded)) return [{ ...recorded[0], ...patch }, ...recorded.slice(1)];
    return { ...recorded, ...patch };
}

const names = Object.keys(golden).filter((n) => n !== "__catalog");

describe("classlist golden master", () => {
    let random;
    beforeAll(() => {
        random = jest.spyOn(Math, "random").mockReturnValue(0);
    });
    afterAll(() => random.mockRestore());

    it("covers the 66 Raid-Helper names, their spec names and an unknown one", () => {
        expect(Object.keys(classlist.ALIASES)).toEqual(names.slice(0, 66));
        expect(names).toContain("Destruction");
        expect(names).toContain("Unknown");
    });

    describe.each(names)("%s", (name) => {
        it("reads the same in the setup view (web)", () => {
            expect(setupView.enrichSlot({ name: "P", spec: name })).toEqual(expected(name, "enrichSlot"));
            expect(setupView.specProfile(name)).toEqual(expected(name, "specProfile"));
            expect(setupView.tankCandidates([{ name: "P", spec: name }])).toEqual(expected(name, "tankCandidates"));
        });

        it("lands in the same raidsheet cells with the same colour", () => {
            const write = fillSetup.buildSetupWrite([{ name: "P", spec: name, group: 1 }], { columns: { spellkicks: "J", decurse: "K" } });
            const ranges = write.writeData.filter((w) => JSON.stringify(w.values).includes("\"P\"")).map((w) => w.range);
            expect(ranges).toEqual(expected(name, "fillSetupRanges"));
            expect(JSON.parse(JSON.stringify(write.playerColors))).toEqual(expected(name, "fillSetupColors"));
        });

        it("shows the same emoji and signs up with the same class and spec", () => {
            expect(helper.getCharacterIcon(interaction, name)).toBe(expected(name, "characterIcon"));
            expect(helper.formatSpecs(name, "1")).toEqual(expected(name, "formatSpecs1"));
        });

        it("maps to the same rule-set spec key for every class", () => {
            const keys = Object.fromEntries(CLASS_NAMES.map((c) => [c || "-", specKeyFromRaidHelper(c, name)]));
            expect(keys).toEqual(expected(name, "specKey"));
        });

        it("sends its role for the Season-of-Discovery template (was the sodclazz string)", () => {
            const entry = classlist.entryFor(name);
            const recorded = golden[name].formatSpecs40;
            if (!entry) {
                expect(helper.formatSpecs(name, "40")).toEqual(recorded);
                return;
            }
            expect(helper.formatSpecs(name, "40")).toEqual([{ className: entry.role || undefined, specName: recorded[0].specName }]);
            // Same role as the old field wherever it had one, but lower case —
            // bar the survival hunter, see EXPECTED_CHANGES.
            const old = recorded[0].className;
            if (old && !["Survival", "SV"].includes(name)) expect(entry.role).toBe(old.toLowerCase());
        });
    });

    it("keeps the recruitment catalog, with `role` in place of `sodclazz`", () => {
        const withoutRole = recruitment.SPEC_CATALOG.map(({ role, ...rest }) => { void role; return rest; });
        const recordedWithout = golden.__catalog.map(({ sodclazz, ...rest }) => { void sodclazz; return rest; });
        expect(withoutRole).toEqual(recordedWithout);
        const changed = { Survival: "ranged", Blood_Tank: "tank", Frost_DPS: "melee", Unholy_DPS: "melee" };
        golden.__catalog.forEach((old, i) => {
            const want = changed[old.key] || String(old.sodclazz || "").toLowerCase();
            expect(recruitment.SPEC_CATALOG[i].role).toBe(want);
        });
    });
});

describe("classlist entries against the old table", () => {
    // The old fields per name; `clazz: "Tank"` was Raid-Helper's class name, not
    // a WoW class — `clazz` is the real class now and `raidhelperClass` keeps
    // the "Tank" the API needs.
    it.each(names.slice(0, 66))("%s", (name) => {
        const old = golden[name].classlist;
        const entry = classlist.entryFor(name);
        expect(entry.icon).toBe(old.icon);
        expect(entry.spec).toBe(old.spec);
        expect(entry.name).toBe(name === "BloodDK" ? "Blood Tank" : old.name);
        if (old.clazz === "Tank") {
            expect(entry.raidhelperClass).toBe("Tank");
            expect(entry.clazz).not.toBe("Tank");
        } else {
            expect(entry.clazz).toBe(old.clazz);
            expect(entry.raidhelperClass).toBe(old.clazz);
        }
    });

    it("gives the protection paladin its real class", () => {
        expect(classlist.entryFor("ProtPala")).toMatchObject({ clazz: "Paladin", role: "tank", raidhelperClass: "Tank" });
        expect(classlist.entryFor("Protection1").clazz).toBe("Paladin");
    });
});
