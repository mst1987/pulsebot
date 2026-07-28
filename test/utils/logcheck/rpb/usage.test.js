const {
    countUsage,
    classCooldownsFor,
    analyzeInterrupts,
    usageForPlayer,
    bossSecondsOf,
} = require("../../../../src/utils/logcheck/rpb/usage");
const rpbData = require("../../../../src/config/rpbData");

const tracked = [
    { name: "Potion", label: "Trank", ids: ["10", "11"] },
    { name: "Bandage", label: "Verband", ids: ["20"], cooldown: 60 },
];

describe("rpb/usage countUsage", () => {
    test("splits usage into trash and bosses", () => {
        const all = [{ guid: 10, total: 7 }];
        const trash = [{ guid: 10, total: 2 }];
        const [row] = countUsage(all, trash, tracked);
        expect(row).toMatchObject({ label: "Trank", total: 7, trash: 2, bosses: 5 });
    });

    test("sums several ids of the same entry", () => {
        const all = [{ guid: 10, total: 3 }, { guid: 11, total: 4 }];
        const [row] = countUsage(all, [], tracked);
        expect(row.total).toBe(7);
        expect(row.bosses).toBe(7);
    });

    test("drops entries that were never used", () => {
        expect(countUsage([], [], tracked)).toEqual([]);
    });

    test("keeps the cooldown when the config carries one", () => {
        const rows = countUsage([{ guid: 20, total: 1 }], [], tracked);
        expect(rows[0].cooldown).toBe(60);
    });

    test("carries the icon and spell id so the report can render a real WoW icon", () => {
        const all = [{ guid: 10, total: 3, abilityIcon: "spell_frost_frostbolt02.jpg" }];
        const [row] = countUsage(all, [], tracked);
        expect(row.icon).toBe("spell_frost_frostbolt02.jpg");
        expect(row.spellId).toBe(10);
    });

    test("picks the most-used rank as the row's icon when several ids matched", () => {
        const all = [
            { guid: 10, total: 2, abilityIcon: "low.jpg" },
            { guid: 11, total: 9, abilityIcon: "high.jpg" },
        ];
        const [row] = countUsage(all, [], tracked);
        expect(row.icon).toBe("high.jpg");
        expect(row.spellId).toBe(11);
    });

    test("an entry without an icon simply has none — no placeholder is invented", () => {
        const [row] = countUsage([{ guid: 10, total: 1 }], [], tracked);
        expect(row.icon).toBeUndefined();
        expect(row.spellId).toBe(10);
    });

    test("boss usage never goes negative when trash exceeds the total", () => {
        const [row] = countUsage([{ guid: 10, total: 2 }], [{ guid: 10, total: 5 }], tracked);
        expect(row.bosses).toBe(0);
    });

    test("tolerates null tables", () => {
        expect(countUsage(null, null, tracked)).toEqual([]);
    });
});

describe("rpb/usage classCooldownsFor", () => {
    const shamanCd = rpbData.CLASS_COOLDOWNS.Shaman.find((c) => c.cooldown);

    test("adds how many uses the boss time would have allowed", () => {
        const all = [{ guid: Number(shamanCd.ids[0]), total: 1 }];
        const rows = classCooldownsFor("Shaman", all, [], shamanCd.cooldown * 4);
        const row = rows.find((r) => r.name === shamanCd.name);
        expect(row.possibleUses).toBe(4);
    });

    test("omits possibleUses without boss time", () => {
        const all = [{ guid: Number(shamanCd.ids[0]), total: 1 }];
        const row = classCooldownsFor("Shaman", all, [], 0).find((r) => r.name === shamanCd.name);
        expect(row.possibleUses).toBeUndefined();
    });

    test("an unknown class yields no rows", () => {
        expect(classCooldownsFor("Deathknight", [{ guid: 1, total: 1 }], [], 100)).toEqual([]);
    });
});

describe("rpb/usage analyzeInterrupts", () => {
    const fights = { end: 1000 };

    /** The v1 interrupts endpoint nests the spells one level below entries. */
    function nested(spells) {
        return { entries: [{ entries: spells }] };
    }

    test("re-keys the API's spell-centric shape by player", async () => {
        const wcl = {
            getInterrupts: jest.fn(async () => nested([
                {
                    name: "Fireball", guid: 36805,
                    details: [
                        { name: "Willijem", type: "Rogue", total: 3 },
                        { name: "Shockholic", type: "Shaman", total: 2 },
                    ],
                },
                {
                    name: "Frostbolt", guid: 36990,
                    details: [{ name: "Willijem", type: "Rogue", total: 1 }],
                },
            ])),
        };
        const result = await analyzeInterrupts(wcl, "rep", fights);
        const willijem = result.players.find((p) => p.name === "Willijem");
        expect(willijem.count).toBe(4);
        expect(willijem.type).toBe("Rogue");
        expect(willijem.spells).toEqual([
            { name: "Fireball", count: 3, spellId: 36805, icon: "" },
            { name: "Frostbolt", count: 1, spellId: 36990, icon: "" },
        ]);
    });

    test("carries the interrupted spell's icon so the report can show it", async () => {
        const wcl = {
            getInterrupts: jest.fn(async () => nested([{
                name: "Lightning Bolt",
                guid: 25449,
                abilityIcon: "spell_nature_lightning.jpg",
                details: [{ name: "Gnomigon", type: "Mage", total: 1 }],
            }])),
        };
        const result = await analyzeInterrupts(wcl, "rep", fights);
        expect(result.players[0].spells[0]).toEqual({
            name: "Lightning Bolt", count: 1, spellId: 25449, icon: "spell_nature_lightning.jpg",
        });
    });

    test("records which ability a player interrupted with", async () => {
        const wcl = {
            getInterrupts: jest.fn(async () => nested([
                {
                    name: "Fireball",
                    guid: 36805,
                    details: [{ name: "Gnomigon", type: "Mage", total: 2, abilities: [{ name: "Counterspell", total: 2 }] }],
                },
                {
                    name: "Frostbolt",
                    guid: 36990,
                    details: [{ name: "Gnomigon", type: "Mage", total: 1, abilities: [{ name: "Counterspell", total: 1 }] }],
                },
            ])),
        };
        const result = await analyzeInterrupts(wcl, "rep", fights);
        expect(result.players[0].kicks).toEqual([{ name: "Counterspell", count: 3 }]);
    });

    test("a player without ability details still gets an empty kick list", async () => {
        const wcl = {
            getInterrupts: jest.fn(async () => nested([
                { name: "Fireball", guid: 1, details: [{ name: "Silent", type: "Rogue", total: 1 }] },
            ])),
        };
        const result = await analyzeInterrupts(wcl, "rep", fights);
        expect(result.players[0].kicks).toEqual([]);
    });

    test("also accepts a flat (un-nested) entries shape", async () => {
        const wcl = {
            getInterrupts: jest.fn(async () => ({
                entries: [{ name: "Heal", details: [{ name: "Rogue", type: "Rogue", total: 2 }] }],
            })),
        };
        const result = await analyzeInterrupts(wcl, "rep", fights);
        expect(result.players[0].count).toBe(2);
    });

    test("sorts players by interrupt count", async () => {
        const wcl = {
            getInterrupts: jest.fn(async () => nested([{
                name: "Bolt",
                details: [
                    { name: "Few", type: "Mage", total: 1 },
                    { name: "Many", type: "Rogue", total: 5 },
                ],
            }])),
        };
        const result = await analyzeInterrupts(wcl, "rep", fights);
        expect(result.players.map((p) => p.name)).toEqual(["Many", "Few"]);
    });

    test("a detail without a total counts as one interrupt", async () => {
        const wcl = {
            getInterrupts: jest.fn(async () => nested([
                { name: "Bolt", details: [{ name: "R", type: "Rogue" }] },
            ])),
        };
        const result = await analyzeInterrupts(wcl, "rep", fights);
        expect(result.players[0].count).toBe(1);
    });

    test("names an unnamed spell by its guid", async () => {
        const wcl = {
            getInterrupts: jest.fn(async () => nested([
                { guid: 4242, details: [{ name: "R", type: "Rogue", total: 1 }] },
            ])),
        };
        const result = await analyzeInterrupts(wcl, "rep", fights);
        expect(result.players[0].spells[0].name).toBe("Spell 4242");
    });

    test("empty table and API errors return null", async () => {
        expect(await analyzeInterrupts({ getInterrupts: async () => ({ entries: [] }) }, "r", fights)).toBeNull();
        expect(await analyzeInterrupts({ getInterrupts: async () => nested([]) }, "r", fights)).toBeNull();
        expect(await analyzeInterrupts({
            getInterrupts: async () => { throw new Error("x"); },
        }, "r", fights)).toBeNull();
    });
});

describe("rpb/usage usageForPlayer and bossSecondsOf", () => {
    test("collects every tracked category for a player", () => {
        const result = usageForPlayer({ name: "P", type: "Mage" }, [], [], 100);
        expect(Object.keys(result)).toEqual(
            expect.arrayContaining(["classCooldowns", "trinketsAndRacials", "consumables", "engineering", "absorbs"]),
        );
    });

    test("bossSecondsOf sums boss fights only, excluding Kalecgos", () => {
        const fights = {
            fights: [
                { boss: 0, start_time: 0, end_time: 5000 },
                { boss: 601, start_time: 5000, end_time: 15000 },
                { boss: 724, start_time: 15000, end_time: 25000 },
            ],
        };
        expect(bossSecondsOf(fights)).toBe(10);
    });
});
