const { analyzePotions, potionsByName } = require("../../../src/utils/logcheck/potions");

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
            name: "More", type: "Warlock", destruction: 2, haste: 0, mana: 4, total: 6,
        });
        expect(out.players[1]).toMatchObject({ name: "Fewer", haste: 1, total: 1 });
        expect(out.icons.haste).toBe("haste.jpg");
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
                { name: "Alice", destruction: 1, haste: 0, mana: 2, total: 3 },
                { name: "Bob", destruction: 0, haste: 5, mana: 0, total: 5 },
            ],
        };
        expect(potionsByName(potions)).toEqual({
            Alice: { destruction: 1, haste: 0, mana: 2 },
            Bob: { destruction: 0, haste: 5, mana: 0 },
        });
    });

    test("null / empty input yields an empty map", () => {
        expect(potionsByName(null)).toEqual({});
        expect(potionsByName({ players: [] })).toEqual({});
    });
});
