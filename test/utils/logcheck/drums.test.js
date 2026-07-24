const { analyzeDrums } = require("../../../src/utils/logcheck/drums");

const fights = { end: 500 };

function makeWcl(table) {
    return { getCasts: jest.fn(async () => table) };
}

describe("logcheck/drums analyzeDrums", () => {
    test("counts drums per type and sorts by total desc", async () => {
        const wcl = makeWcl({
            entries: [
                { name: "Low", type: "Hunter", abilities: [{ guid: 35476, total: 2, icon: "d.jpg" }] },
                { name: "High", type: "Warrior", abilities: [
                    { guid: 35475, total: 3 },  // War
                    { guid: 35476, total: 4 },  // Battle
                ] },
            ],
        });
        const out = await analyzeDrums(wcl, "rep", fights);
        expect(out.players).toHaveLength(2);
        expect(out.players[0]).toEqual({ name: "High", type: "Warrior", total: 7, byType: { War: 3, Battle: 4 } });
        expect(out.players[1]).toMatchObject({ name: "Low", total: 2, byType: { Battle: 2 } });
        expect(out.icon).toBe("d.jpg");
    });

    test("merges the TBC and fresh re-issue GUIDs into the same category", async () => {
        const wcl = makeWcl({
            entries: [
                { name: "Mix", type: "Shaman", abilities: [
                    { guid: 35476, total: 1 },   // Battle (classic)
                    { guid: 351355, total: 2 },  // Battle (fresh)
                ] },
            ],
        });
        const out = await analyzeDrums(wcl, "rep", fights);
        expect(out.players[0].byType).toEqual({ Battle: 3 });
        expect(out.players[0].total).toBe(3);
    });

    test("players who cast no drums are excluded", async () => {
        const wcl = makeWcl({
            entries: [{ name: "None", type: "Mage", abilities: [{ guid: 99999, total: 5 }] }],
        });
        expect(await analyzeDrums(wcl, "rep", fights)).toBeNull();
    });

    test("empty table returns null", async () => {
        expect(await analyzeDrums(makeWcl({ entries: [] }), "rep", fights)).toBeNull();
    });

    test("API error returns null", async () => {
        const wcl = { getCasts: jest.fn(async () => { throw new Error("nope"); }) };
        expect(await analyzeDrums(wcl, "rep", fights)).toBeNull();
    });
});
