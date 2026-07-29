const {
    CONTENTS, TIERS, RAID_LOOT, content, tier, sourceForItem, contentForInstance, contentForLoot, tokenTier,
} = require("../../src/config/tbcContent");

describe("tbcContent", () => {
    describe("the generated raid loot table", () => {
        it("covers every content the metadata lists", () => {
            for (const c of CONTENTS) {
                expect(Object.keys(RAID_LOOT[c.id] || {}).length).toBeGreaterThan(0);
            }
        });

        it("assigns every item id to exactly one raid", () => {
            const seen = new Map();
            for (const [contentId, byBoss] of Object.entries(RAID_LOOT)) {
                for (const ids of Object.values(byBoss)) {
                    for (const id of ids) {
                        expect(seen.has(id) ? `${id} also in ${seen.get(id)}` : id).toBe(id);
                        seen.set(id, contentId);
                    }
                }
            }
        });

        it("gives every content a tier that exists", () => {
            const tierIds = TIERS.map((t) => t.id);
            for (const c of CONTENTS) expect(tierIds).toContain(c.tier);
        });
    });

    describe("sourceForItem", () => {
        // Spot checks across the tiers — a regenerated table that silently
        // dropped a raid would still pass the structural tests above.
        it.each([
            [28830, "gruul", "Gruul the Dragonkiller"], // Dragonspine Trophy
            [30105, "ssc", "Lady Vashj"],               // Serpent Spine Longbow
            [29987, "tk", "Kael'thas Sunstrider"],
            [30902, "hyjal", "Archimonde"],
            [32837, "bt", "Illidan Stormrage"],         // Warglaive of Azzinoth
        ])("resolves %p to %p", (itemId, expectedContent, expectedBoss) => {
            expect(sourceForItem(itemId)).toEqual({ content: expectedContent, boss: expectedBoss });
        });

        it("returns null for an id the table does not know", () => {
            expect(sourceForItem(1)).toBeNull();
            expect(sourceForItem(0)).toBeNull();
            expect(sourceForItem("nope")).toBeNull();
        });
    });

    describe("contentForInstance", () => {
        it.each([
            ["Serpentshrine Cavern-25 Player", "ssc"],
            ["Höhle des Schlangenschreins", "ssc"],
            ["Tempest Keep", "tk"],
            ["Das Auge", "tk"],
            ["Gruul's Lair", "gruul"],
            ["Der Schwarze Tempel", "bt"],
        ])("reads %p as %p", (instance, expected) => {
            expect(contentForInstance(instance)).toBe(expected);
        });

        it("returns an empty string when nothing matches", () => {
            expect(contentForInstance("Scholomance")).toBe("");
            expect(contentForInstance("")).toBe("");
        });
    });

    describe("contentForLoot", () => {
        it("resolves a Gargul row, which carries nothing but the item id", () => {
            expect(contentForLoot({ itemId: 30105 })).toEqual({ contentId: "ssc", boss: "Lady Vashj" });
        });

        it("keeps the boss the export named", () => {
            expect(contentForLoot({ itemId: 30105, boss: "Lady Vashj (Hardmode)" }))
                .toEqual({ contentId: "ssc", boss: "Lady Vashj (Hardmode)" });
        });

        it("falls back to the instance string for an unknown item", () => {
            expect(contentForLoot({ itemId: 1, instance: "Black Temple-25 Player", boss: "Illidan" }))
                .toEqual({ contentId: "bt", boss: "Illidan" });
        });

        it("leaves the content empty rather than guessing a raid", () => {
            expect(contentForLoot({ itemId: 1 })).toEqual({ contentId: "", boss: "" });
            expect(contentForLoot(null)).toEqual({ contentId: "", boss: "" });
        });
    });

    describe("tokenTier", () => {
        it.each([
            ["Chestguard of the Fallen Defender", "t4"],
            ["Gloves of the Vanquished Champion", "t5"],
            ["Leggings of the Forgotten Conqueror", "t6"],
            ["Handschuhe des gefallenen Helden", "t4"],
        ])("recognises %p as %p", (name, expected) => {
            expect(tokenTier(name)).toBe(expected);
        });

        it("is empty for anything that is not a set token", () => {
            expect(tokenTier("Dragonspine Trophy")).toBe("");
            expect(tokenTier("Warglaive of Azzinoth")).toBe("");
            expect(tokenTier("")).toBe("");
        });
    });

    it("content/tier look up their metadata and return null when unknown", () => {
        expect(content("ssc").short).toBe("SSC");
        expect(content("nope")).toBeNull();
        expect(tier("t5").label).toBe("Tier 5");
        expect(tier("t9")).toBeNull();
    });
});
