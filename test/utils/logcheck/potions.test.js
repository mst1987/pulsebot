const { analyzePotions, potionsByName, POTION_TYPES, POTION_FILTER } = require("../../../src/utils/logcheck/potions");

const fights = { end: 400 };

function makeWcl(table) {
    return { getCasts: jest.fn(async () => table) };
}

describe("logcheck/potions analyzePotions", () => {
    test("counts destruction / haste / mana and sorts by total", async () => {
        const wcl = makeWcl({
            entries: [
                { name: "Fewer", type: "Rogue", abilities: [{ guid: 28507, total: 1, icon: "haste.jpg" }] },
                { name: "More", type: "Warlock", abilities: [
                    { guid: 28508, total: 2 },   // Destruction
                    { guid: 28499, total: 3 },   // Super Mana
                    { guid: 38929, total: 1 },   // Fel Mana -> mana
                ] },
            ],
        });
        const out = await analyzePotions(wcl, "rep", fights);
        expect(out.players[0]).toEqual({
            name: "More",
            type: "Warlock",
            destruction: 2,
            haste: 0,
            mana: 4,
            total: 6,
            byType: { destruction: 2, superMana: 3, felMana: 1 },
        });
        expect(out.players[1]).toMatchObject({ name: "Fewer", haste: 1, total: 1 });
        expect(out.icons.haste).toBe("haste.jpg");
    });

    test("breaks the mana total down by source, listing only the types actually used", async () => {
        const wcl = makeWcl({
            entries: [
                { name: "Heal", type: "Priest", abilities: [
                    { guid: 28499, total: 4 },   // Super Mana Potion
                    { guid: 41618, total: 6 },   // Bottled Nethergon Energy (Tempest Keep)
                    { guid: 27869, total: 2 },   // Dark Rune
                ] },
            ],
        });
        const out = await analyzePotions(wcl, "rep", fights);
        expect(out.players[0].mana).toBe(12);
        expect(out.players[0].byType).toEqual({ superMana: 4, nethergon: 6, darkRune: 2 });
        // `types` drives the table head — only what turned up, in config order
        expect(out.types.map((t) => t.key)).toEqual(["superMana", "nethergon", "darkRune"]);
        expect(out.types[0]).toMatchObject({ group: "mana", label: "Super-Manatrank", itemId: 22832 });
    });

    test("counts the mana sources the old three-id list missed", async () => {
        const ids = {
            majorMana: 17531, greaterMana: 11903, runicMana: 43186, cenarion: 41617,
            demonicRune: 16666, madAlchemist: 45051, manaInfusion: 28760,
        };
        const wcl = makeWcl({
            entries: [{
                name: "Drinker",
                type: "Mage",
                abilities: Object.values(ids).map((guid) => ({ guid, total: 1 })),
            }],
        });
        const out = await analyzePotions(wcl, "rep", fights);
        expect(out.players[0].mana).toBe(Object.keys(ids).length);
        expect(out.players[0].byType).toEqual(
            Object.fromEntries(Object.keys(ids).map((k) => [k, 1])),
        );
    });

    test("the API filter asks for every configured potion id", () => {
        for (const type of POTION_TYPES) {
            for (const id of type.ids) expect(POTION_FILTER).toContain(id);
        }
        // spell ids must not be claimed by two types at once
        const all = POTION_TYPES.flatMap((t) => t.ids);
        expect(new Set(all).size).toBe(all.length);
    });

    test("a group with nothing drunk still gets an icon for its column head", async () => {
        const wcl = makeWcl({
            entries: [{ name: "Mana only", type: "Priest", abilities: [{ guid: 28499, total: 1 }] }],
        });
        const out = await analyzePotions(wcl, "rep", fights);
        expect(out.icons.destruction).toBeTruthy();
        expect(out.icons.haste).toBeTruthy();
    });

    test("players with no potions are excluded; empty result is null", async () => {
        const wcl = makeWcl({
            entries: [{ name: "Dry", type: "Mage", abilities: [{ guid: 12345, total: 9 }] }],
        });
        expect(await analyzePotions(wcl, "rep", fights)).toBeNull();
    });

    test("API error returns null", async () => {
        const wcl = { getCasts: jest.fn(async () => { throw new Error("x"); }) };
        expect(await analyzePotions(wcl, "rep", fights)).toBeNull();
    });
});

describe("logcheck/potions potionsByName", () => {
    test("builds a name -> counts lookup", () => {
        const potions = {
            players: [
                { name: "Alice", destruction: 1, haste: 0, mana: 2, total: 3, byType: { superMana: 2 } },
                { name: "Bob", destruction: 0, haste: 5, mana: 0, total: 5 },
            ],
        };
        expect(potionsByName(potions)).toEqual({
            Alice: { destruction: 1, haste: 0, mana: 2, byType: { superMana: 2 } },
            Bob: { destruction: 0, haste: 5, mana: 0, byType: {} },
        });
    });

    test("null / empty input yields an empty map", () => {
        expect(potionsByName(null)).toEqual({});
        expect(potionsByName({ players: [] })).toEqual({});
    });
});
