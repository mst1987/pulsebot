// In-memory fs so the store never touches the repo disk (same shim as
// lootStore.test.js — lootStats reads through the real store).
jest.mock("fs", () => {
    const store = new Map();
    const enoent = (p) => {
        const e = new Error(`ENOENT: no such file '${p}'`);
        e.code = "ENOENT";
        return e;
    };
    return {
        __store: store,
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn((p, data) => { store.set(p, String(data)); }),
        readFileSync: jest.fn((p) => {
            if (!store.has(p)) throw enoent(p);
            return store.get(p);
        }),
    };
});

// Class/spec resolution has three sources of its own (see characterInfo.js) —
// none of them belong in an aggregation test, so the annotated list is stubbed.
jest.mock("../../src/web/characterInfo", () => ({
    annotatedCharacters: jest.fn(() => []),
}));

const fs = require("fs");
const { addImport } = require("../../src/web/lootStore.js");
const { annotatedCharacters } = require("../../src/web/characterInfo");
const { reasonsByCharacter, itemCatalog, lootStats } = require("../../src/web/lootStats.js");

beforeEach(() => {
    fs.__store.clear();
    annotatedCharacters.mockReturnValue([]);
});

// 30105 = Serpent Spine Longbow (SSC / Lady Vashj), 28830 = Dragonspine Trophy
// (Gruul) — real ids, so the content resolution is exercised for real.
const item = (over = {}) => ({
    source: "rclc", rawId: "r1", itemId: 30105, itemName: "Serpent Spine Longbow",
    player: "Foo-Thunderstrike", character: "Foo", characterKey: "foo", realm: "Thunderstrike",
    response: "BiS", offspec: false, boss: "", awardedAt: 1000, awardedBy: "ML",
    ...over,
});

describe("web/lootStats", () => {
    describe("reasonsByCharacter", () => {
        it("splits a raider's loot into reason buckets, strongest first", () => {
            addImport("ev1", [
                item({ rawId: "a", response: "BiS" }),
                item({ rawId: "b", response: "Off Spec", offspec: true }),
                item({ rawId: "c", response: "Off Spec", offspec: true }),
            ], { eventLabel: "SSC" });

            const [row] = reasonsByCharacter();
            expect(row.character).toBe("Foo");
            expect(row.count).toBe(3);
            expect(row.reasons.map((r) => [r.reason, r.count])).toEqual([["bis", 1], ["offspec", 2]]);
            // The items behind a bucket travel with it — that is what the hover shows.
            expect(row.reasons[1].items).toHaveLength(2);
            expect(row.reasons[1].items[0].itemName).toBe("Serpent Spine Longbow");
        });

        it("keeps raiders whose class is still unknown", () => {
            addImport("ev1", [item()], {});
            const [row] = reasonsByCharacter();
            expect(row.className).toBe("");
            expect(row.count).toBe(1);
        });

        it("takes class and spec from the annotated character list", () => {
            annotatedCharacters.mockReturnValue([{ key: "foo", className: "Hunter", spec: "Beast Mastery" }]);
            addImport("ev1", [item()], {});
            expect(reasonsByCharacter()[0]).toMatchObject({ className: "Hunter", spec: "Beast Mastery" });
        });

        it("sorts raiders by how much loot they got", () => {
            addImport("ev1", [
                item({ rawId: "a" }),
                item({ rawId: "b" }),
                item({ rawId: "c", character: "Bar", characterKey: "bar" }),
            ], {});
            expect(reasonsByCharacter().map((r) => r.character)).toEqual(["Foo", "Bar"]);
        });
    });

    describe("itemCatalog", () => {
        it("groups awards by item and resolves the raid from the item id", () => {
            addImport("ev1", [
                item({ rawId: "a" }),
                item({ rawId: "b", character: "Bar", characterKey: "bar", response: "Off Spec", offspec: true }),
            ], { eventLabel: "SSC-Raid" });

            const [entry] = itemCatalog();
            expect(entry).toMatchObject({ itemId: 30105, contentId: "ssc", tier: "t5", boss: "Lady Vashj", count: 2 });
            expect(entry.awards.map((a) => a.character).sort()).toEqual(["Bar", "Foo"]);
            expect(entry.awards.map((a) => a.reason).sort()).toEqual(["bis", "offspec"]);
            expect(entry.awards[0].eventLabel).toBe("SSC-Raid");
        });

        it("resolves the content of a Gargul row that has no instance at all", () => {
            addImport("ev1", [item({
                source: "gargul", rawId: "g1", itemId: 28830, itemName: "", boss: "", instance: "",
                response: "Main Spec",
            })], {});
            expect(itemCatalog()[0]).toMatchObject({ itemId: 28830, contentId: "gruul", tier: "t4" });
        });

        it("leaves an unknown item without a content instead of guessing one", () => {
            addImport("ev1", [item({ rawId: "x", itemId: 12345, itemName: "Random Thing" })], {});
            expect(itemCatalog()[0]).toMatchObject({ itemId: 12345, contentId: "", tier: "" });
        });

        it("fills a missing name from a later import of the same item", () => {
            addImport("ev1", [item({ source: "gargul", rawId: "g1", itemName: "", awardedAt: 500 })], {});
            addImport("ev2", [item({ rawId: "r2", itemName: "Serpent Spine Longbow", awardedAt: 900 })], {});
            expect(itemCatalog()[0].itemName).toBe("Serpent Spine Longbow");
        });

        it("marks tier tokens with their tier", () => {
            addImport("ev1", [item({ rawId: "t", itemId: 30239, itemName: "Gloves of the Vanquished Champion" })], {});
            expect(itemCatalog()[0].tokenTier).toBe("t5");
        });

        it("sorts the most-awarded item first", () => {
            addImport("ev1", [
                item({ rawId: "a" }),
                item({ rawId: "b" }),
                item({ rawId: "c", itemId: 28830, itemName: "Dragonspine Trophy" }),
            ], {});
            expect(itemCatalog().map((i) => i.itemId)).toEqual([30105, 28830]);
        });
    });

    describe("lootStats", () => {
        it("only offers filters for raids and tiers that actually occur", () => {
            addImport("ev1", [item()], {});
            const stats = lootStats();
            expect(stats.contents.map((c) => c.id)).toEqual(["ssc"]);
            expect(stats.tiers.map((t) => t.id)).toEqual(["t5"]);
            expect(stats.unknownContentCount).toBe(0);
        });

        it("counts the items whose raid could not be resolved", () => {
            addImport("ev1", [item({ rawId: "x", itemId: 12345 })], {});
            expect(lootStats().unknownContentCount).toBe(1);
        });

        it("ships the full reason catalog, not just the reasons in use", () => {
            addImport("ev1", [item()], {});
            const ids = lootStats().reasons.map((r) => r.id);
            expect(ids).toContain("bis");
            expect(ids).toContain("pvp");
        });
    });
});
