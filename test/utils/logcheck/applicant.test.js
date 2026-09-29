const { analyzeApplicant, applicantSource } = require("../../../src/utils/logcheck/applicant");
const { normalizeVersionSettings, normalizeBlock } = require("../../../src/stores/versionSettingsSchema");

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
        expect(res.consumables).toEqual({ name: "ZuG", type: "Warlock", flask: 100, elixir: 0, buffed: 100, food: 0, weaponOiled: false });
        expect(res.potions).toEqual({ name: "ZuG", type: "Warlock", destruction: 2, haste: 0, mana: 0, byType: { destruction: 2 }, total: 2 });
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
        expect(res.overview.map((p) => `${p.encounterName}:${p.reportID}`)).toEqual(["Gruul:BBB", "Magtheridon:CCC"]);
        expect(res.gearIssues).toBeUndefined();
    });
});

// #553: the realm, region and log site come from the application's version.
describe("logcheck/applicant per game version (#553)", () => {
    const CLASSIC = {
        blizzardRegion: "eu", blizzardRealmSlug: "firemaw", blizzardNamespace: "profile-classic1x-eu",
        wclUrlTemplate: "https://vanilla.warcraftlogs.com/character/{region}/{realm}/{char}",
    };
    const TBC = { blizzardRegion: "eu", blizzardRealmSlug: "thunderstrike", wclUrlTemplate: "https://fresh.warcraftlogs.com/character/eu/thunderstrike/{char}" };
    const config = (blocks) => ({ mainVersion: "tbc", versionSettings: normalizeVersionSettings(blocks) });

    afterEach(() => {
        delete process.env.APPLY_WCL_REALM;
        delete process.env.APPLY_WCL_REGION;
    });

    test("asks the Classic realm on the vanilla site and links the report there", async () => {
        const wcl = fullWcl();
        const res = await analyzeApplicant(wcl, "Zug", { className: "Warlock" }, { versionId: "classic", config: config({ tbc: TBC, classic: CLASSIC }) });
        expect(wcl.getParses).toHaveBeenCalledWith("Zug", "firemaw", "eu", "dps", { site: "https://vanilla.warcraftlogs.com" });
        expect(res).toMatchObject({ versionId: "classic", reportUrl: "https://vanilla.warcraftlogs.com/reports/BBB" });
    });

    test("TBC keeps its realm and fresh site", async () => {
        const wcl = fullWcl();
        const res = await analyzeApplicant(wcl, "Zug", {}, { versionId: "tbc", config: config({ tbc: TBC }) });
        expect(wcl.getParses).toHaveBeenCalledWith("Zug", "thunderstrike", "eu", "dps", { site: "https://fresh.warcraftlogs.com" });
        expect(res.reportUrl).toBe("https://fresh.warcraftlogs.com/reports/BBB");
    });

    test("a version without realm or log site is not asked at all", async () => {
        const wcl = fullWcl();
        const cfg = config({ tbc: TBC, classic: { ...CLASSIC, blizzardRealmSlug: "" } });
        expect(applicantSource("classic", { config: cfg })).toMatchObject({ ready: false, realm: "", site: "https://vanilla.warcraftlogs.com" });
        expect(await analyzeApplicant(wcl, "Zug", {}, { versionId: "classic", config: cfg })).toBeNull();
        expect(await analyzeApplicant(wcl, "Zug", {}, { versionId: "forever", config: cfg })).toBeNull();
        expect(wcl.getParses).not.toHaveBeenCalled();
    });

    test("APPLY_WCL_REALM / _REGION only stand in for an empty TBC realm", () => {
        process.env.APPLY_WCL_REALM = "Spineshatter";
        process.env.APPLY_WCL_REGION = "EU";
        const empty = config({ tbc: { ...normalizeBlock({}), wclUrlTemplate: TBC.wclUrlTemplate }, classic: { ...CLASSIC, blizzardRealmSlug: "" } });
        expect(applicantSource("tbc", { config: empty })).toMatchObject({ realm: "spineshatter", region: "eu", ready: true });
        expect(applicantSource("classic", { config: empty })).toMatchObject({ realm: "", ready: false });
        expect(applicantSource("tbc", { config: config({ tbc: TBC }) }).realm).toBe("thunderstrike");
    });
});
