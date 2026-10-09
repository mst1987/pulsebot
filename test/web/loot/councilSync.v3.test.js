// Council format version 3 (#670): every role, the roster status, loot points,
// tenure, the drought state and each category's own weighting - pure mapping
// over plain object literals (the item classes come from the real tables).
const { councilSyncPayloadV2, councilSyncPayloadV3, itemClassesFor, VERSION_3 } = require("../../../src/web/loot/councilSync");

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1791000000000;

// Real ids from config/generated/tbcRaidLoot.json (SSC):
const TRINKET = 30626; // Sextant of Unstable Currents
const WEAPON = 30103; // Fang of Vashj
const SET = 30245; // Leggings of the Vanquished Champion
const FREQUENT = 30021; // Wildfury Greatstaff (trash)
const NORMAL = 30099; // Frayed Tether of the Drowned

const WEIGHTS = {
    scope: "category",
    classes: { trinket: 2.5, bisWeapon: 2, weapon: 1.5, set: 1, normal: 1, frequent: 0.5 },
    items: { [NORMAL]: { weight: 3, name: "Frayed Tether" } },
    need: { drought: 40, share: 30, need: 10, tenure: 20 },
    needShares: { drought: 0.4, share: 0.3, need: 0.1, tenure: 0.2 },
    tenureDays: 60,
    droughtDays: 30,
};

const row = (over = {}) => ({
    key: "gemli",
    character: "Gemli",
    className: "Priest",
    specLabel: "Shadow",
    role: "caster",
    needScore: 0.612,
    needParts: { drought: 0.5, share: 0.25, need: 0.4, tenure: 0.75 },
    lootCount: 2,
    lootPoints: 2.5,
    lootTotal: 3,
    otherCount: 1,
    lastAwardAt: T0,
    daysSinceLoot: 4,
    droughtDays: 19,
    joinedAt: T0 - 45 * DAY + 123,
    joinedFrom: "roster",
    tenureDays: 45,
    status: "trial",
    bis: {
        tier: "t5", source: "wowsims", owned: 1, total: 3,
        items: [{ id: WEAPON, owned: false }, { id: TRINKET, owned: true }, { id: SET, owned: false }],
    },
    items: [
        { itemId: SET, itemName: "Leggings", awardedAt: T0 - 10 * DAY, weight: 1, weightClass: "set", reasonLabel: "BiS" },
        { itemId: FREQUENT, itemName: "Staff", awardedAt: T0, weight: 0.5, weightClass: "frequent", reasonLabel: "Upgrade" },
    ],
    ...over,
});

const opts = { role: "", tierIds: [], contentIds: [], bisTier: "", charVersion: "tbc" };
const entry = (over = {}) => ({
    id: "c1", name: "Mittwoch", opts,
    built: { rows: [row()], avgLootCount: 2, avgLootPoints: 2.5, bisTier: "t5", weights: WEIGHTS },
    instances: [{ id: "ssc", name: "Höhle des Schlangenschreins", short: "SSC", zoneNames: [] }],
    ...over,
});

describe("councilSyncPayloadV3", () => {
    it("is version 3 with the category's own weighting on top and in the category", () => {
        const p = councilSyncPayloadV3([entry()], { now: T0 + 999 });
        expect(VERSION_3).toBe(3);
        expect(p).toMatchObject({ format: "eventhelper-council", version: 3, generatedAt: Math.floor(T0 / 1000) });
        const weights = {
            drought: 40, share: 30, need: 10, tenure: 20,
            shares: { drought: 0.4, share: 0.3, need: 0.1, tenure: 0.2 },
            droughtDays: 30, tenureDays: 60, scope: "category",
        };
        expect(p.weights).toEqual(weights);
        expect(p.categories[0].weights).toEqual(weights);
        expect(p.categories[0].itemWeights).toEqual({
            classes: { trinket: 2.5, bisWeapon: 2, weapon: 1.5, set: 1, normal: 1, frequent: 0.5 },
            overrides: { [String(NORMAL)]: 3 },
        });
        expect(p.categories[0]).toMatchObject({
            id: "c1", name: "Mittwoch", lootSystem: "lootcouncil", avgLootCount: 2, avgLootPoints: 2.5,
            filter: { role: "", tiers: [], contents: [], bisTier: "t5", bisTierDerived: true, version: "tbc" },
            instances: [{ id: "ssc" }],
        });
    });

    it("keeps exact shares for a weighting that does not add up to round percents", () => {
        const third = 1 / 3;
        const p = councilSyncPayloadV3([entry({
            built: { rows: [], weights: { ...WEIGHTS, needShares: { drought: third, share: third, need: third, tenure: 0 } } },
        })]);
        expect(p.categories[0].weights).toMatchObject({ drought: 33, share: 33, need: 33, tenure: 0 });
        expect(p.categories[0].weights.shares.drought).toBe(third);
    });

    it("maps a raider: the v2 fields plus status, points, tenure, drought state and BiS weapons", () => {
        const [r] = councilSyncPayloadV3([entry()]).categories[0].raiders;
        expect(r).toMatchObject({
            key: "gemli", character: "Gemli", classFile: "PRIEST", specLabel: "Shadow", role: "caster",
            need: 61, parts: { drought: 50, share: 25, need: 40, tenure: 75 },
            lootCount: 2, lootTotal: 3, otherCount: 1, lastAwardAt: Math.floor(T0 / 1000), daysSinceLoot: 4,
            status: "trial", lootPoints: 2.5, droughtDays: 19,
            joinedAt: Math.floor((T0 - 45 * DAY + 123) / 1000), tenureDays: 45,
            bisWeapons: [WEAPON],
            bis: { tier: "t5", owned: 1, total: 3, missing: [WEAPON, SET] },
        });
        // The counter after the newest award: 30 -> set (w 1) resets to 0, +10 days, staff (w 0.5) halves it.
        expect(r.droughtBase).toBe(5);
        expect(r.items[0]).toEqual({
            itemId: FREQUENT, itemName: "Staff", awardedAt: Math.floor(T0 / 1000), boss: "", reason: "Upgrade", event: "",
            weight: 0.5, weightClass: "frequent",
        });
        // Every v2 field is still there.
        const v2 = councilSyncPayloadV2([entry()]).categories[0].raiders[0];
        for (const key of Object.keys(v2)) expect(r).toHaveProperty(key);
    });

    it("carries every council role - no legacy filter - and the view's role as it is", () => {
        const rows = ["caster", "healer", "tank", "melee", "ranged"].map((role) => row({ key: role, character: role, role }));
        const p = councilSyncPayloadV3([entry({ built: { rows, weights: WEIGHTS } }), entry({ id: "t", opts: { ...opts, role: "tank" } })]);
        expect(p.categories[0].raiders.map((r) => r.role)).toEqual(["caster", "healer", "tank", "melee", "ranged"]);
        expect(p.categories[1].filter.role).toBe("tank");
    });

    it("fills defaults for a row without the #667/#668 fields and a raider who never got anything", () => {
        const bare = row({
            status: undefined, lootPoints: undefined, droughtDays: undefined, joinedAt: 0, tenureDays: undefined,
            needParts: { drought: 1, share: 0.5, need: 0.5 }, lootCount: 0, lastAwardAt: 0, daysSinceLoot: null, items: [],
            bis: { tier: "", source: "", owned: 0, total: 0, items: [] },
        });
        const [r] = councilSyncPayloadV3([entry({ built: { rows: [bare] } })]).categories[0].raiders;
        expect(r).toMatchObject({
            status: "", lootPoints: 0, droughtDays: 30, droughtBase: 30, joinedAt: 0, tenureDays: 0,
            parts: { tenure: 0 }, bisWeapons: [], daysSinceLoot: -1,
        });
    });

    it("falls back to the server's weighting when the roster carries none", () => {
        const p = councilSyncPayloadV3([entry({ built: { rows: [] } })]);
        expect(p.categories[0].weights).toMatchObject({ drought: 45, share: 30, need: 10, tenure: 15, droughtDays: 30, tenureDays: 90 });
        expect(p.categories[0].itemWeights.classes).toEqual({ trinket: 2, bisWeapon: 2, weapon: 1.5, set: 1, normal: 1, frequent: 0.5 });
        expect(councilSyncPayloadV3([]).weights).toMatchObject({ drought: 45, tenure: 15 });
        expect(councilSyncPayloadV3([]).categories).toEqual([]);
    });
});

describe("itemClassesFor", () => {
    it("classes every drop of the category's raids, weapons without the raider-specific BiS half", () => {
        const classes = itemClassesFor([{ id: "ssc" }]);
        expect(classes[String(TRINKET)]).toBe("trinket");
        expect(classes[String(WEAPON)]).toBe("weapon");
        expect(classes[String(SET)]).toBe("set");
        expect(classes[String(FREQUENT)]).toBe("frequent");
        // "normal" is the addon's default and stays out.
        expect(classes[String(NORMAL)]).toBeUndefined();
        expect(Object.values(classes)).not.toContain("bisWeapon");
        expect(Object.values(classes)).not.toContain("override");
    });

    it("knows only the category's raids, and every raid without a template", () => {
        expect(itemClassesFor([{ id: "kara" }])[String(TRINKET)]).toBeUndefined();
        const all = itemClassesFor([]);
        expect(all[String(TRINKET)]).toBe("trinket");
        expect(Object.keys(all).length).toBeGreaterThan(Object.keys(itemClassesFor([{ id: "ssc" }])).length);
        // An instance the loot table does not know (Forever) counts as none.
        expect(itemClassesFor([{ id: "forever-ony" }])).toEqual(all);
    });
});
