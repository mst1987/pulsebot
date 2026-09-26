// Die reinen Umrechnungen hinter scripts/fetch-wowsims-data.js. Kein Netz:
// geprüft wird an handgebauten Items in der Form der WoWSims-Item-DB
// (assets/database/db.json), deren Werte nach Stat-Index geschlüsselt sind.
const {
    medianIlvl,
    statsOf,
    isRaidItem,
    BIS_FILES,
    BIS_MELEE,
    APL_FILES,
    TIER_ILVL_HINT,
    TYPE_TO_SLOTS,
} = require("../../scripts/fetch-wowsims-data");

describe("scripts/fetch-wowsims-data", () => {
    describe("medianIlvl", () => {
        it("nimmt den Median und lässt fehlende Itemlevel (0) weg", () => {
            expect(medianIlvl([120, 0, 110, 130])).toBe(120);
            expect(medianIlvl([100, 130, 110, 120])).toBe(120);
        });

        it("gibt 0 für ein leeres Set", () => {
            expect(medianIlvl([])).toBe(0);
            expect(medianIlvl([0, 0])).toBe(0);
        });
    });

    describe("statsOf", () => {
        it("übersetzt Stat-Indizes in unsere Schlüssel und liest Itemlevel und Waffenschaden", () => {
            const item = {
                scalingOptions: {
                    0: {
                        // 5 Zaubermacht, 12 Zaubertreffer, 2 Ausdauer = 0 fällt weg,
                        // 33 ist bewusst nicht übernommen, 35 mp5.
                        stats: { 5: 40, 12: "10", 2: 0, 33: 7, 35: 6 },
                        ilvl: 141,
                        weaponDamageMin: 100,
                        weaponDamageMax: 200,
                    },
                },
            };
            expect(statsOf(item)).toEqual({
                stats: { spellPower: 40, spellHit: 10, mp5: 6 },
                ilvl: 141,
                damage: { min: 100, max: 200 },
            });
        });

        it("nimmt die erste Skalierung, wenn es keine '0' gibt", () => {
            expect(statsOf({ scalingOptions: { 3: { stats: { 0: 5, 17: 30 }, ilvl: 70 } } })).toEqual({
                stats: { strength: 5, attackPower: 30 },
                ilvl: 70,
                damage: { min: 0, max: 0 },
            });
        });

        it("kommt ohne Skalierung mit leeren Werten aus", () => {
            expect(statsOf({})).toEqual({ stats: {}, ilvl: 0, damage: { min: 0, max: 0 } });
        });
    });

    describe("isRaidItem", () => {
        it("schneidet Grün und schlechter immer ab", () => {
            expect(isRaidItem({ quality: 2 }, { spellPower: 40 })).toBe(false);
        });

        it("verlangt einen Wert, der für eine Rolle zählt", () => {
            expect(isRaidItem({ quality: 4 }, { stamina: 30, intellect: 20 })).toBe(false);
            expect(isRaidItem({ quality: 3 }, { spellHaste: 12 })).toBe(true);
            expect(isRaidItem({ quality: 4 }, { attackPower: 40 })).toBe(true);
            expect(isRaidItem({ quality: 4 }, { defense: 20 })).toBe(true);
        });
    });

    describe("Tabellen", () => {
        it("ordnet Ringe und Schmuck beiden WCL-Slots zu", () => {
            expect(TYPE_TO_SLOTS[11]).toEqual([10, 11]);
            expect(TYPE_TO_SLOTS[12]).toEqual([12, 13]);
            expect(TYPE_TO_SLOTS[13]).toEqual([15, 16]);
        });

        it("führt jedes BiS-Set unter einem bekannten Tier und als gear.json", () => {
            for (const sets of Object.values({ ...BIS_FILES, ...BIS_MELEE })) {
                for (const { tier, file } of sets) {
                    expect(Object.keys(TIER_ILVL_HINT)).toContain(tier);
                    expect(file).toMatch(/^ui\/.+\.gear\.json$/);
                }
            }
        });

        it("führt jede Rotation als apl.json", () => {
            for (const file of Object.values(APL_FILES)) expect(file).toMatch(/^ui\/.+\.apl\.json$/);
        });
    });
});
