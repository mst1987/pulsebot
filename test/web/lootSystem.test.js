const {
    LOOT_SYSTEMS, LOOT_SYSTEM_LABELS, normalizeLootSystem, normalizeCategoryLootSystem,
    categoryLootSystem, resolveLootSystem,
} = require("../../src/web/lootSystem");

describe("lootSystem", () => {
    it("knows four systems, each with a German label", () => {
        expect(LOOT_SYSTEMS).toEqual(["softres", "lootcouncil", "gdkp", "other"]);
        for (const s of LOOT_SYSTEMS) expect(LOOT_SYSTEM_LABELS[s]).toBeTruthy();
    });

    it("normalises a system and drops anything unknown", () => {
        expect(normalizeLootSystem(" lootcouncil ")).toBe("lootcouncil");
        expect(normalizeLootSystem("dkp")).toBe("");
        expect(normalizeLootSystem(null)).toBe("");
        expect(normalizeCategoryLootSystem({ c1: "gdkp", c2: "", c3: "nope", " ": "softres" })).toEqual({ c1: "gdkp" });
        expect(normalizeCategoryLootSystem(["softres"])).toEqual({});
        expect(normalizeCategoryLootSystem(null)).toEqual({});
    });

    describe("categoryLootSystem", () => {
        it("takes the category's own setting first", () => {
            const config = { categoryLootSystem: { c1: "gdkp" }, categoryLootTool: { c1: "rclc" } };
            expect(categoryLootSystem(config, "c1")).toEqual({ system: "gdkp", source: "category" });
        });

        it("reads RCLootcouncil as Loot-Council when nothing is set", () => {
            expect(categoryLootSystem({ categoryLootTool: { c1: "rclc" } }, "c1")).toEqual({ system: "lootcouncil", source: "addon" });
        });

        it("falls back to Softres — the behaviour before the setting existed", () => {
            expect(categoryLootSystem({ categoryLootTool: { c1: "gargul" } }, "c1")).toEqual({ system: "softres", source: "default" });
            expect(categoryLootSystem({}, "")).toEqual({ system: "softres", source: "default" });
            expect(categoryLootSystem(undefined, "c1")).toEqual({ system: "softres", source: "default" });
        });
    });

    describe("resolveLootSystem", () => {
        const lc = { categoryLootSystem: { c1: "lootcouncil" } };

        it("offers softres for a softres raid", () => {
            expect(resolveLootSystem({ config: {}, categoryId: "c1" })).toMatchObject({
                system: "softres", label: "Softres", source: "default", softres: true, softresExtra: false,
            });
        });

        it("hides softres for a Loot-Council raid", () => {
            expect(resolveLootSystem({ config: lc, categoryId: "c1" })).toMatchObject({
                system: "lootcouncil", label: "Loot-Council", source: "category", categoryLabel: "Loot-Council", softres: false,
            });
        });

        it("lets one raid override the category, in both directions", () => {
            expect(resolveLootSystem({ config: lc, categoryId: "c1", override: { system: "softres" } })).toMatchObject({
                system: "softres", source: "event", categorySystem: "lootcouncil", softres: true,
            });
            expect(resolveLootSystem({ config: {}, categoryId: "c1", override: { system: "gdkp" } })).toMatchObject({
                system: "gdkp", source: "event", categorySystem: "softres", softres: false,
            });
        });

        it("switches softres on in addition for a non-softres raid", () => {
            expect(resolveLootSystem({ config: lc, categoryId: "c1", override: { softres: true } })).toMatchObject({
                system: "lootcouncil", source: "category", softresExtra: true, softres: true,
            });
            // "in addition" means nothing for a softres raid
            expect(resolveLootSystem({ config: {}, categoryId: "c1", override: { softres: true } }).softresExtra).toBe(false);
        });

        it("keeps a softres list that already exists visible", () => {
            expect(resolveLootSystem({ config: lc, categoryId: "c1", softresList: { url: "https://softres.it/raid/x" } }).softres).toBe(true);
            expect(resolveLootSystem({ config: lc, categoryId: "c1", softresList: { url: "" } }).softres).toBe(false);
        });

        it("ignores an unknown override", () => {
            expect(resolveLootSystem({ config: lc, categoryId: "c1", override: { system: "dkp" } })).toMatchObject({ system: "lootcouncil", source: "category" });
        });
    });
});
