const { analyzeApplicant } = require("../../../src/utils/logcheck/applicant");

const fights = { end: 100, fights: [{ id: 1, boss: 1, start_time: 0, end_time: 100 }] };

// A whole-raid casts table (no filter) vs. the potion-filtered casts table.
function castTable(name) {
    return { entries: [{ name, type: "Warlock", total: 5000, gear: [], abilities: [] }] };
}
function potionTable(name) {
    return { entries: [{ name, type: "Warlock", abilities: [{ guid: 28508, total: 2 }] }] };
}

const parses = [
    { encounterName: "Gruul", percentile: 90, startTime: 1000, reportID: "AAA" },
    { encounterName: "Gruul", percentile: 95, startTime: 2000, reportID: "BBB" },
    { encounterName: "Magtheridon", percentile: 80, startTime: 500, reportID: "CCC" },
];

function fullWcl(charName = "Zug") {
    return {
        getParses: jest.fn(async () => parses),
        getFights: jest.fn(async () => fights),
        getCasts: jest.fn(async (report, start, end, opts) =>
            (opts && opts.filter ? potionTable(charName) : castTable(charName))),
        getBuffs: jest.fn(async () => ({ auras: [{ guid: "28518", bands: [{ startTime: 0, endTime: 100 }] }] })),
    };
}

describe("logcheck/applicant analyzeApplicant", () => {
    test("returns null when the character has no parses", async () => {
        const wcl = { getParses: jest.fn(async () => []) };
        expect(await analyzeApplicant(wcl, "Nobody")).toBeNull();
    });

    test("returns null when the parses request throws", async () => {
        const wcl = { getParses: jest.fn(async () => { throw new Error("404"); }) };
        expect(await analyzeApplicant(wcl, "Nobody")).toBeNull();
    });

    test("builds overview (best parse per boss, desc) and picks the latest report", async () => {
        const wcl = fullWcl();
        const res = await analyzeApplicant(wcl, "Zug", { className: "Warlock" });
        expect(res.overview.map((p) => `${p.encounterName}:${p.percentile}`))
            .toEqual(["Gruul:95", "Magtheridon:80"]);
        expect(res.last.reportID).toBe("BBB");
    });

    test("analyzes gear, consumables and potions from the latest raid", async () => {
        const wcl = fullWcl();
        const res = await analyzeApplicant(wcl, "Zug", { className: "Warlock" });
        expect(Array.isArray(res.gearIssues)).toBe(true);
        expect(res.gearIssues.length).toBeGreaterThan(0); // empty gear -> missing-slot issues
        expect(res.consumables).toMatchObject({ name: "Zug", flask: 100 });
        expect(res.potions).toMatchObject({ name: "Zug", destruction: 2 });
    });

    test("matches the character entry case-insensitively", async () => {
        const wcl = fullWcl("ZuG");
        const res = await analyzeApplicant(wcl, "zug", { className: "Warlock" });
        expect(res.consumables).toBeTruthy();
        expect(res.potions).toBeTruthy();
    });

    test("relevant potions depend on class/spec", async () => {
        // getFights throws so the last-raid analysis is skipped, but `relevant` is still set.
        const base = () => ({
            getParses: jest.fn(async () => parses),
            getFights: jest.fn(async () => { throw new Error("skip"); }),
        });
        const caster = await analyzeApplicant(base(), "Zug", { className: "Mage" });
        expect(caster.relevant).toEqual(["destruction", "mana"]);
        expect(caster.gearIssues).toBeUndefined(); // last-raid analysis was skipped

        const healer = await analyzeApplicant(base(), "Zug", { spec: "holy" });
        expect(healer.relevant).toEqual(["mana"]);

        const physical = await analyzeApplicant(base(), "Zug", { className: "Rogue", spec: "combat" });
        expect(physical.relevant).toEqual(["haste"]);
    });

    test("shadow-priest spec counts as a caster", async () => {
        const wcl = {
            getParses: jest.fn(async () => parses),
            getFights: jest.fn(async () => { throw new Error("skip"); }),
        };
        const res = await analyzeApplicant(wcl, "Zug", { className: "Priest", spec: "shadow" });
        expect(res.relevant).toEqual(["destruction", "mana"]);
    });

    test("no matching casts entry leaves gear/consumables unset", async () => {
        const wcl = fullWcl("SomeoneElse");
        const res = await analyzeApplicant(wcl, "Zug", { className: "Warlock" });
        expect(res.overview).toBeDefined();
        expect(res.gearIssues).toBeUndefined();
    });
});
