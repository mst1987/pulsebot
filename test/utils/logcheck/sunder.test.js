const { analyzeSunder } = require("../../../src/utils/logcheck/sunder");

const fights = { end: 300 };
const idToPlayer = {
    1: { name: "Warri", type: "Warrior" },
    2: { name: "Pala", type: "Paladin" },
};

function makeWcl(events) {
    return { getAllEvents: jest.fn(async () => events) };
}

describe("logcheck/sunder analyzeSunder", () => {
    test("counts applications and how many landed below 5 stacks", async () => {
        const wcl = makeWcl([
            { type: "applydebuff", sourceID: 1, stack: 1 },        // below 5
            { type: "applydebuffstack", sourceID: 1, stack: 3 },   // below 5
            { type: "applydebuffstack", sourceID: 1, stack: 5 },   // at cap
            { type: "refreshdebuff", sourceID: 1, stack: 5 },      // at cap
            { type: "removedebuff", sourceID: 1, stack: 5 },       // ignored type
        ]);
        const rows = await analyzeSunder(wcl, "rep", fights, idToPlayer);
        expect(rows).toEqual([{ name: "Warri", type: "Warrior", total: 4, below5: 2 }]);
    });

    test("applydebuff without a stack field defaults to 1 (below 5)", async () => {
        const wcl = makeWcl([{ type: "applydebuff", sourceID: 2 }]);
        const rows = await analyzeSunder(wcl, "rep", fights, idToPlayer);
        expect(rows[0]).toEqual({ name: "Pala", type: "Paladin", total: 1, below5: 1 });
    });

    test("ignores events from unknown sources and pets, sorts by total", async () => {
        const wcl = makeWcl([
            { type: "applydebuff", sourceID: 1, stack: 1 },
            { type: "applydebuff", sourceID: 2, stack: 1 },
            { type: "applydebuff", sourceID: 2, stack: 2 },
            { type: "applydebuff", sourceID: 99, stack: 1 },  // unknown -> dropped
            { type: "applydebuff", stack: 1 },                 // no sourceID -> dropped
        ]);
        const rows = await analyzeSunder(wcl, "rep", fights, idToPlayer);
        expect(rows.map((r) => r.name)).toEqual(["Pala", "Warri"]);
        expect(rows[0].total).toBe(2);
    });

    test("no matching events returns null", async () => {
        expect(await analyzeSunder(makeWcl([]), "rep", fights, idToPlayer)).toBeNull();
    });

    test("API error returns null", async () => {
        const wcl = { getAllEvents: jest.fn(async () => { throw new Error("fail"); }) };
        expect(await analyzeSunder(wcl, "rep", fights, idToPlayer)).toBeNull();
    });
});
