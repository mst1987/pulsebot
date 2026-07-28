const {
    analyzeValidation,
    zoneTagsOf,
    killsByNpcId,
    detectZones,
    ZONE_TAGS,
} = require("../../../../src/utils/logcheck/rpb/validate");
const rpbData = require("../../../../src/config/rpbData");

describe("rpb/validate zoneTagsOf", () => {
    test("maps the report zone id to its tags", () => {
        expect(zoneTagsOf({ zone: 1010 })).toEqual(["SSC", "TK"]);
        expect(zoneTagsOf({ zone: 1007 })).toEqual(["Kara"]);
    });

    test("unknown zone ids yield no tags", () => {
        // a fresh-realm SSC+TK report reports zone 1056, which is not listed
        expect(zoneTagsOf({ zone: 1056 })).toEqual([]);
        expect(zoneTagsOf({})).toEqual([]);
    });

    test("every mapped tag has requirements in the generated data", () => {
        for (const tags of Object.values(ZONE_TAGS)) {
            for (const tag of tags) {
                expect(rpbData.TRASH_REQUIREMENTS[tag]).toBeDefined();
            }
        }
    });
});

describe("rpb/validate detectZones", () => {
    test("recognises a zone from the trash that actually died", () => {
        const sscReq = rpbData.TRASH_REQUIREMENTS.SSC[0];
        const kills = { [sscReq.ids[0]]: 3 };
        expect(detectZones(kills)).toContain("SSC");
    });

    test("no matching trash means no zone", () => {
        expect(detectZones({})).toEqual([]);
        expect(detectZones({ 999999: 5 })).toEqual([]);
    });

    test("orders zones by how many of their requirements were seen", () => {
        const ssc = rpbData.TRASH_REQUIREMENTS.SSC;
        const tk = rpbData.TRASH_REQUIREMENTS.TK;
        const kills = {};
        for (const r of ssc) kills[r.ids[0]] = 1;      // all SSC entries seen
        kills[tk[0].ids[0]] = 1;                        // one TK entry seen
        const zones = detectZones(kills);
        expect(zones.indexOf("SSC")).toBeLessThan(zones.indexOf("TK"));
    });
});

describe("rpb/validate killsByNpcId", () => {
    test("counts deaths per npc guid", () => {
        const deaths = { entries: [{ guid: 21251 }, { guid: 21251 }, { guid: 21301 }] };
        expect(killsByNpcId(deaths, {})).toEqual({ 21251: 2, 21301: 1 });
    });

    test("resolves the guid through fights.enemies when the entry lacks one", () => {
        const deaths = { entries: [{ id: 5 }, { id: 5 }] };
        const fights = { enemies: [{ id: 5, guid: 21229 }] };
        expect(killsByNpcId(deaths, fights)).toEqual({ 21229: 2 });
    });

    test("entries without a resolvable guid are ignored", () => {
        expect(killsByNpcId({ entries: [{ id: 99 }] }, { enemies: [] })).toEqual({});
        expect(killsByNpcId(null, {})).toEqual({});
    });
});

describe("rpb/validate analyzeValidation", () => {
    const sscReq = rpbData.TRASH_REQUIREMENTS.SSC[0];
    const fights = {
        end: 10000,
        zone: 1010, // SSC / TK on the classic realms
        fights: [
            { id: 1, boss: 601, start_time: 0, end_time: 1000, kill: true },
            { id: 2, boss: 602, start_time: 1000, end_time: 2000, kill: false },
        ],
        enemies: [],
    };

    test("reports the requirement as met when enough trash died", async () => {
        const entries = [];
        for (let i = 0; i < sscReq.minimum; i++) entries.push({ guid: Number(sscReq.ids[0]) });
        const wcl = { getDeaths: jest.fn(async () => ({ entries })) };

        const result = await analyzeValidation(wcl, "rep", fights);
        const row = result.requirements.find((r) => r.name === sscReq.name);
        expect(row.killed).toBe(sscReq.minimum);
        expect(row.ok).toBe(true);
    });

    test("marks the log invalid when trash is missing", async () => {
        const wcl = { getDeaths: jest.fn(async () => ({ entries: [] })) };
        const result = await analyzeValidation(wcl, "rep", fights);
        expect(result.valid).toBe(false);
        expect(result.requirements.every((r) => r.killed === 0)).toBe(true);
    });

    test("counts killed bosses and total boss fights", async () => {
        const wcl = { getDeaths: jest.fn(async () => ({ entries: [] })) };
        const result = await analyzeValidation(wcl, "rep", fights);
        expect(result.bossesKilled).toBe(1);
        expect(result.bossesTotal).toBe(2);
    });

    test("detects the zone from the killed trash even when the zone id is unknown", async () => {
        // fresh-realm reports carry a zone id that is not in the map at all
        const entries = [];
        for (let i = 0; i < sscReq.minimum; i++) entries.push({ guid: Number(sscReq.ids[0]) });
        const wcl = { getDeaths: jest.fn(async () => ({ entries })) };

        const freshReport = { ...fights, zone: 1056 };
        const result = await analyzeValidation(wcl, "rep", freshReport);
        expect(result.zones).toContain("SSC");
        expect(result.requirements.length).toBeGreaterThan(0);
    });

    test("a zone without requirements reports bosses only", async () => {
        const wcl = { getDeaths: jest.fn(async () => ({ entries: [] })) };
        const unknownZone = { ...fights, zone: 999 };
        const result = await analyzeValidation(wcl, "rep", unknownZone);
        expect(result.valid).toBeNull();
        expect(result.requirements).toEqual([]);
        expect(result.note).toMatch(/keine Trash-Anforderungen/i);
    });

    test("a report without boss fights and without requirements returns null", async () => {
        const wcl = { getDeaths: jest.fn(async () => ({ entries: [] })) };
        expect(await analyzeValidation(wcl, "rep", { zone: 999, fights: [] })).toBeNull();
    });

    test("an API error returns null", async () => {
        const wcl = { getDeaths: jest.fn(async () => { throw new Error("boom"); }) };
        expect(await analyzeValidation(wcl, "rep", fights)).toBeNull();
    });
});
