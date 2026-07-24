const { analyzeConsumables } = require("../../../src/utils/logcheck/consumables");

// GUIDs taken from src/config/claData.js CONSUMABLES.
const FLASK = "28518";
const BATTLE = "28501";
const GUARDIAN = "28509";
const FOOD = "33257";

function band(start, end) {
    return { startTime: start, endTime: end };
}

// Single boss fight spanning the whole report.
const fights = {
    end: 100,
    fights: [
        { id: 1, boss: 1, start_time: 0, end_time: 100 },
        { id: 2, boss: 0, start_time: 100, end_time: 150 }, // trash, ignored
    ],
};

function makeWcl(buffsById) {
    return {
        getBuffs: jest.fn(async (report, start, end, opts) => buffsById[opts.sourceid]),
    };
}

describe("logcheck/consumables analyzeConsumables", () => {
    test("player with a flask is fully buffed on the boss fight", async () => {
        const wcl = makeWcl({
            10: { auras: [{ guid: FLASK, abilityIcon: "flask.jpg", bands: [band(0, 100)] }] },
        });
        const players = [{ id: 10, name: "Flasky", type: "Mage" }];
        const { players: rows, icons } = await analyzeConsumables(wcl, "rep", fights, players);

        expect(rows[0]).toMatchObject({
            name: "Flasky", type: "Mage",
            flask: 100, elixir: 0, buffed: 100, food: 0, weaponOiled: false,
        });
        expect(icons.flask).toBe("flask.jpg");
        // only the boss fight is queried, trash is filtered out
        expect(wcl.getBuffs).toHaveBeenCalledTimes(1);
    });

    test("battle + guardian elixir counts as buffed but not as flask", async () => {
        const wcl = makeWcl({
            11: { auras: [
                { guid: BATTLE, bands: [band(0, 100)] },
                { guid: GUARDIAN, bands: [band(0, 100)] },
            ] },
        });
        const rows = (await analyzeConsumables(wcl, "rep", fights, [{ id: 11, name: "Elix", type: "Warrior" }])).players;
        expect(rows[0]).toMatchObject({ flask: 0, elixir: 100, buffed: 100 });
    });

    test("only a battle elixir (no guardian) is NOT counted as buffed", async () => {
        const wcl = makeWcl({
            12: { auras: [{ guid: BATTLE, bands: [band(0, 100)] }] },
        });
        const rows = (await analyzeConsumables(wcl, "rep", fights, [{ id: 12, name: "Half", type: "Rogue" }])).players;
        expect(rows[0]).toMatchObject({ flask: 0, elixir: 0, buffed: 0 });
    });

    test("food-only player: food covered, everything else missing", async () => {
        const wcl = makeWcl({
            13: { auras: [{ guid: FOOD, bands: [band(0, 100)] }] },
        });
        const rows = (await analyzeConsumables(wcl, "rep", fights, [{ id: 13, name: "Hungry", type: "Priest" }])).players;
        expect(rows[0]).toMatchObject({ flask: 0, elixir: 0, buffed: 0, food: 100 });
    });

    test("player with no buffs data (API failure) reports all zeros", async () => {
        const wcl = { getBuffs: jest.fn(async () => { throw new Error("boom"); }) };
        const rows = (await analyzeConsumables(wcl, "rep", fights, [{ id: 14, name: "Nada", type: "Druid" }])).players;
        expect(rows[0]).toMatchObject({ flask: 0, elixir: 0, buffed: 0, food: 0 });
    });

    test("weapon with a temporary enchant is flagged as oiled", async () => {
        const wcl = makeWcl({ 15: { auras: [] } });
        const players = [{
            id: 15, name: "Oiled", type: "Shaman",
            gear: [{ slot: 15, temporaryEnchant: "3789" }],
        }];
        const rows = (await analyzeConsumables(wcl, "rep", fights, players)).players;
        expect(rows[0].weaponOiled).toBe(true);
    });

    test("weapon temporaryEnchant of '0' is not oiled", async () => {
        const wcl = makeWcl({ 16: { auras: [] } });
        const players = [{ id: 16, name: "Dry", type: "Shaman", gear: [{ slot: 15, temporaryEnchant: "0" }] }];
        const rows = (await analyzeConsumables(wcl, "rep", fights, players)).players;
        expect(rows[0].weaponOiled).toBe(false);
    });

    test("partial coverage: flask only on one of two boss fights = 50%", async () => {
        const twoFights = {
            end: 200,
            fights: [
                { id: 1, boss: 1, start_time: 0, end_time: 100 },
                { id: 2, boss: 1, start_time: 100, end_time: 200 },
            ],
        };
        const wcl = makeWcl({
            20: { auras: [
                // present on both fights (some tracked aura), flask only on the first
                { guid: FOOD, bands: [band(0, 200)] },
                { guid: FLASK, bands: [band(0, 99)] },
            ] },
        });
        const rows = (await analyzeConsumables(wcl, "rep", twoFights, [{ id: 20, name: "Semi", type: "Mage" }])).players;
        expect(rows[0].flask).toBe(50);
        expect(rows[0].food).toBe(100);
    });

    test("empty player list returns empty results", async () => {
        const wcl = makeWcl({});
        const out = await analyzeConsumables(wcl, "rep", fights, []);
        expect(out.players).toEqual([]);
    });
});
