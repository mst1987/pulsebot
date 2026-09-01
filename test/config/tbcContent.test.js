const {
    CONTENTS, TIERS, RAID_LOOT, content, tier, sourceForItem, contentForInstance, contentsForText, contentForLoot, tokenTier,
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

        // The encounter is what a raider calls the kill. The table used to be
        // scraped from Wowhead, which names whichever NPC technically holds the
        // loot, so items were credited to "Essence of Anger" or "Grand Warlock
        // Alythess" — bosses no raid ever announces.
        it.each([
            [32345, "bt", "Reliquary of the Lost"],  // not "Essence of Anger"
            [32331, "bt", "The Illidari Council"],   // not "High Nethermancer Zerevor"
            [34189, "swp", "Eredar Twins"],          // not "Grand Warlock Alythess"
            [30311, "tk", "Kael'thas Sunstrider"],   // Warp Slicer, not the npc "Warp Slicer"
            [28585, "kara", "The Wizard of Oz"],     // not "The Crone", one of its four npcs
            [28589, "kara", "Opera Event"],          // shared by all three plays
        ])("credits %p to the encounter, not the npc holding the loot", (itemId, expectedContent, expectedBoss) => {
            expect(sourceForItem(itemId)).toEqual({ content: expectedContent, boss: expectedBoss });
        });

        // Encounters the scraped table had no attribution for at all: their
        // drops sat in the catch-all bucket, so every one of them inherited
        // whatever boss the export happened to name.
        it.each([
            [30095, "ssc", "Leotheras the Blind"],   // Fang of the Leviathan
            [30056, "ssc", "Hydross the Unstable"],
            [32323, "bt", "Teron Gorefiend"],
            [32232, "bt", "High Warlord Naj'entus"],
            [34164, "swp", "Kalecgos"],
            [34228, "swp", "M'uru"],
            [33191, "za", "Nalorakk"],
        ])("attributes %p, which the scraped table left unassigned", (itemId, expectedContent, expectedBoss) => {
            expect(sourceForItem(itemId)).toEqual({ content: expectedContent, boss: expectedBoss });
        });

        it("says Trash for a trash drop rather than leaving it to the export", () => {
            expect(sourceForItem(23633)).toEqual({ content: "kara", boss: "Trash" });
            expect(sourceForItem(30021)).toEqual({ content: "ssc", boss: "Trash" });
        });

        it("leaves an item that drops in several raids out of the table", () => {
            // 32428 comes off both Hyjal and Black Temple trash, and 30183 off
            // both SSC and TK trash — the id alone cannot place either, so only
            // the export's instance string still can.
            expect(sourceForItem(32428)).toBeNull();
            expect(sourceForItem(30183)).toBeNull();
        });

        it("leaves the boss empty for a drop no single encounter owns", () => {
            // Badge of Justice drops from every boss of the raid.
            expect(sourceForItem(29434)).toEqual({ content: "za", boss: "" });
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

        // RCLootcouncil names the encounter that was current when the item was
        // *awarded* — an item handed out from the bag after the next pull
        // carries the wrong boss, and a whole raid night ends up filed under its
        // last kill. The item id says where it actually dropped.
        it("overrides the boss the export named", () => {
            // Leggings of Murderous Intent, awarded during the Vashj fight.
            expect(contentForLoot({ itemId: 29995, boss: "Lady Vashj", instance: "Serpentshrine Cavern-25 Player" }))
                .toEqual({ contentId: "tk", boss: "Kael'thas Sunstrider" });
        });

        // The reported case: a Leotheras drop handed out during the Vashj pull
        // was shown as a Vashj drop, because the scraped table knew no boss for
        // it and the export's boss won by default.
        it("overrides the export for an item the scraped table could not place", () => {
            expect(contentForLoot({ itemId: 30095, boss: "Lady Vashj", instance: "Serpentshrine Cavern-25 Player" }))
                .toEqual({ contentId: "ssc", boss: "Leotheras the Blind" });
        });

        it("keeps a trash drop trash, whichever pull it was handed out on", () => {
            expect(contentForLoot({ itemId: 30021, boss: "Lady Vashj" }))
                .toEqual({ contentId: "ssc", boss: "Trash" });
        });

        it("keeps the export's boss for a drop no single encounter owns", () => {
            // Badge of Justice — in the table, but under "".
            expect(contentForLoot({ itemId: 29434, boss: "Zul'jin" }))
                .toEqual({ contentId: "za", boss: "Zul'jin" });
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

    describe("contentsForText", () => {
        it("names every raid a combined night mentions, in CONTENTS order", () => {
            expect(contentsForText("SSC/TK Donnerstag")).toEqual(["ssc", "tk"]);
            expect(contentsForText("Hyjal + BT")).toEqual(["hyjal", "bt"]);
            expect(contentsForText("Gruul & Mag")).toEqual(["gruul", "mag"]);
        });

        it("also understands the instance strings an export writes", () => {
            expect(contentsForText("Serpentshrine Cavern-25 Player")).toEqual(["ssc"]);
            expect(contentsForText("Der Schwarze Tempel")).toEqual(["bt"]);
        });

        it("answers nothing rather than guessing", () => {
            expect(contentsForText("Raidabend")).toEqual([]);
            expect(contentsForText("")).toEqual([]);
            expect(contentsForText(null)).toEqual([]);
        });

        it("does not match an abbreviation inside another word", () => {
            // "BT" in "Debt", "ZA" in "Zangarmarschen" — the short forms only
            // count on word boundaries.
            expect(contentsForText("Debt Zangarmarschen")).toEqual([]);
        });
    });

    it("content/tier look up their metadata and return null when unknown", () => {
        expect(content("ssc").short).toBe("SSC");
        expect(content("nope")).toBeNull();
        expect(tier("t5").label).toBe("Tier 5");
        expect(tier("t9")).toBeNull();
    });
});
