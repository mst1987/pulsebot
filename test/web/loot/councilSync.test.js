// The slim council payload for the sync tool: pure mapping, plain object literals.
const { councilSyncPayload, councilSyncPayloadV2, classFileFor, MAX_ITEMS } = require("../../../src/web/loot/councilSync");

const row = (over = {}) => ({
    key: "gemli",
    character: "Gemli",
    className: "Priest",
    specLabel: "Shadow",
    role: "caster",
    needScore: 0.824,
    needParts: { drought: 1, share: 0.6, need: 0.4 },
    lootCount: 2,
    lootTotal: 5,
    otherCount: 1,
    lastAwardAt: 1791000000123,
    daysSinceLoot: 12,
    bis: {
        tier: "t6", source: "wowsims", owned: 2, total: 3,
        items: [{ id: 1, owned: true }, { id: 30000, owned: false }, { id: 30000, owned: false }],
    },
    items: [
        { itemId: 5, itemName: "Old", awardedAt: 1000000, boss: "A", reason: "ms", reasonLabel: "", eventLabel: "" },
        {
            itemId: 30001, itemName: "New", awardedAt: 1791000000123, boss: "Lady Vashj",
            reason: "ms", reasonLabel: "Main Spec", eventLabel: "SSC/TK Mittwoch", itemIconUrl: "x",
        },
    ],
    gear: { items: [] },
    ...over,
});

const built = (rows) => ({ rows, avgLootCount: 3.4, bisTier: "t6" });

describe("classFileFor", () => {
    it("maps the stored spelling to the uppercase token", () => {
        expect(classFileFor("Priest")).toBe("PRIEST");
        expect(classFileFor("warlock")).toBe("WARLOCK");
        expect(classFileFor("Death Knight")).toBe("DEATHKNIGHT");
        expect(classFileFor("Magier")).toBe("MAGE");
    });

    it("is empty when unknown", () => {
        expect(classFileFor("")).toBe("");
        expect(classFileFor(undefined)).toBe("");
        expect(classFileFor("Gnome")).toBe("");
    });
});

describe("councilSyncPayload", () => {
    const ctx = { categoryId: "123", categories: [{ id: "123", name: "SSC/TK Mittwoch" }], role: "caster", bisTierDerived: true, now: 1791234567890 };

    it("carries format, version, filter, categories, weights and the average", () => {
        const p = councilSyncPayload(built([]), ctx);
        expect(p).toEqual({
            format: "eventhelper-council",
            version: 1,
            generatedAt: 1791234567,
            filter: { category: "123", categoryName: "SSC/TK Mittwoch", role: "caster", bisTier: "t6", bisTierDerived: true },
            categories: [{ id: "123", name: "SSC/TK Mittwoch" }],
            weights: { drought: 50, share: 40, need: 10 },
            avgLootCount: 3.4,
            raiders: [],
        });
    });

    it("leaves the category name empty without a category", () => {
        const p = councilSyncPayload(built([]), { categories: ctx.categories });
        expect(p.filter).toMatchObject({ category: "", categoryName: "", role: "", bisTierDerived: false });
    });

    it("maps one raider: seconds, integer percentages, missing BiS ids, newest item first", () => {
        const [r] = councilSyncPayload(built([row()]), ctx).raiders;
        expect(r).toEqual({
            character: "Gemli",
            classFile: "PRIEST",
            specLabel: "Shadow",
            role: "caster",
            need: 82,
            parts: { drought: 100, share: 60, need: 40 },
            lootCount: 2,
            lootTotal: 5,
            otherCount: 1,
            lastAwardAt: 1791000000,
            daysSinceLoot: 12,
            bis: { tier: "t6", source: "wowsims", owned: 2, total: 3, missing: [30000, 30000] },
            items: [
                { itemId: 30001, itemName: "New", awardedAt: 1791000000, boss: "Lady Vashj", reason: "Main Spec", event: "SSC/TK Mittwoch" },
                { itemId: 5, itemName: "Old", awardedAt: 1000, boss: "A", reason: "ms", event: "" },
            ],
        });
    });

    it("keeps the roster order and encodes never-looted as 0 / -1", () => {
        const never = row({ character: "Zed", lastAwardAt: 0, daysSinceLoot: null, items: [], needScore: 0.5 });
        const p = councilSyncPayload(built([row(), never]), ctx);
        expect(p.raiders.map((r) => r.character)).toEqual(["Gemli", "Zed"]);
        expect(p.raiders[1]).toMatchObject({ lastAwardAt: 0, daysSinceLoot: -1, items: [], need: 50 });
    });

    it("caps the items at the 25 newest", () => {
        const items = Array.from({ length: 40 }, (_, i) => ({ itemId: i + 1, awardedAt: (i + 1) * 1000 }));
        const [r] = councilSyncPayload(built([row({ items })]), ctx).raiders;
        expect(r.items).toHaveLength(MAX_ITEMS);
        expect(r.items[0].itemId).toBe(40);
    });

    it("gives an empty class token and empty BiS block for an unknown class and no BiS list", () => {
        const [r] = councilSyncPayload(built([row({ className: "", bis: { tier: "", source: "", owned: 0, total: 0, items: [] } })]), ctx).raiders;
        expect(r.classFile).toBe("");
        expect(r.bis).toEqual({ tier: "", source: "", owned: 0, total: 0, missing: [] });
    });
});

describe("councilSyncPayloadV2", () => {
    const opts = { role: "caster", tierIds: ["t6"], contentIds: [], bisTier: "", charVersion: "tbc" };

    it("sends one entry per category with its filter, instances and raiders carrying a key", () => {
        const p = councilSyncPayloadV2([
            { id: "c1", name: "Mittwoch", opts, built: built([row()]), instances: [{ id: "bt", name: "Der Schwarze Tempel", short: "BT", zoneNames: [] }] },
            { id: 2, name: "", opts: { ...opts, role: "", bisTier: "t5", charVersion: "" }, built: { rows: [], bisTier: "t5" } },
        ], { now: 1791234567890 });
        expect(p).toMatchObject({ format: "eventhelper-council", version: 2, generatedAt: 1791234567, weights: { drought: 50, share: 40, need: 10 } });
        expect(p.categories).toHaveLength(2);
        expect(p.categories[0]).toMatchObject({
            id: "c1", name: "Mittwoch", lootSystem: "lootcouncil",
            filter: { role: "caster", tiers: ["t6"], contents: [], bisTier: "t6", bisTierDerived: true, version: "tbc" },
            instances: [{ id: "bt" }],
            avgLootCount: 3.4,
        });
        expect(p.categories[0].raiders[0]).toMatchObject({ key: "gemli", character: "Gemli", classFile: "PRIEST", need: 82 });
        // The v1 fields stay as they are, plus the key.
        expect(Object.keys(p.categories[0].raiders[0])).toEqual(["key", ...Object.keys(councilSyncPayload(built([row()])).raiders[0])]);
        expect(p.categories[1]).toMatchObject({
            id: "2", name: "2", instances: [], avgLootCount: 0, raiders: [],
            filter: { role: "", bisTier: "t5", bisTierDerived: false, version: "" },
        });
    });

    it("is an empty list without Loot-Council categories", () => {
        expect(councilSyncPayloadV2([]).categories).toEqual([]);
        expect(councilSyncPayloadV2().categories).toEqual([]);
    });
});
