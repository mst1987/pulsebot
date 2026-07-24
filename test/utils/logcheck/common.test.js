const { VALID_CLASSES, selectPlayers } = require("../../../src/utils/logcheck/common");

describe("logcheck/common selectPlayers", () => {
    test("keeps only known-class entries with total > 20", () => {
        const table = {
            entries: [
                { name: "Zug", type: "Warrior", total: 5000 },
                { name: "Afk", type: "Warrior", total: 10 },   // too little activity
                { name: "Pet", type: "Pet", total: 9999 },     // not a raider class
                { name: "Nada", type: "Mage", total: 0 },      // zero total
            ],
        };
        const players = selectPlayers(table);
        expect(players.map((p) => p.name)).toEqual(["Zug"]);
    });

    test("sorts by class then name", () => {
        const table = {
            entries: [
                { name: "Bob", type: "Warrior", total: 100 },
                { name: "Ann", type: "Warrior", total: 100 },
                { name: "Cara", type: "Mage", total: 100 },
            ],
        };
        const players = selectPlayers(table);
        // Mage sorts before Warrior; within Warrior, Ann before Bob
        expect(players.map((p) => `${p.type}:${p.name}`)).toEqual([
            "Mage:Cara",
            "Warrior:Ann",
            "Warrior:Bob",
        ]);
    });

    test("total of exactly 20 is excluded (needs > 20)", () => {
        const table = { entries: [{ name: "Edge", type: "Rogue", total: 20 }] };
        expect(selectPlayers(table)).toEqual([]);
    });

    test("missing total defaults to 0 and is excluded", () => {
        const table = { entries: [{ name: "NoTotal", type: "Priest" }] };
        expect(selectPlayers(table)).toEqual([]);
    });

    test("empty / undefined table returns an empty array", () => {
        expect(selectPlayers(undefined)).toEqual([]);
        expect(selectPlayers({})).toEqual([]);
        expect(selectPlayers({ entries: [] })).toEqual([]);
    });

    test("exports the nine playable classes", () => {
        expect(VALID_CLASSES).toContain("Warrior");
        expect(VALID_CLASSES).toContain("Druid");
        expect(VALID_CLASSES).toHaveLength(9);
    });
});
