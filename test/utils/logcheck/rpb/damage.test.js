const {
    analyzeDamage,
    topAvoidableAbilities,
    reflectFilter,
    REFLECT_EXCLUDED_IDS,
    MAX_ABILITIES,
} = require("../../../../src/utils/logcheck/rpb/damage");
const rpbData = require("../../../../src/config/rpbData");

const fights = {
    end: 10000,
    fights: [
        { id: 1, boss: 0, start_time: 0, end_time: 1000 },
        { id: 2, boss: 601, start_time: 1000, end_time: 3000 },
    ],
};
const players = [
    { id: 1, name: "Tank", type: "Warrior" },
    { id: 2, name: "Heal", type: "Priest" },
];

// two abilities that really exist in the generated tracked list
const tracked = rpbData.DAMAGE_TAKEN.slice(0, 2);

describe("rpb/damage topAvoidableAbilities", () => {
    test("keeps only tracked abilities present in the report, sorted by total", () => {
        const byAbility = {
            entries: [
                { guid: Number(tracked[0].ids[0]), total: 100, sources: [{ name: "Mob A" }] },
                { guid: Number(tracked[1].ids[0]), total: 900, sources: [{ name: "Mob B" }] },
                { guid: 999999, total: 5000, sources: [] },   // untracked -> ignored
            ],
        };
        const top = topAvoidableAbilities(byAbility);
        expect(top).toHaveLength(2);
        expect(top[0].total).toBe(900);
        expect(top[1].total).toBe(100);
    });

    test("cleans source names and de-duplicates them", () => {
        const byAbility = {
            entries: [{
                guid: Number(tracked[0].ids[0]),
                total: 10,
                sources: [{ name: "[Boss] UNUSED" }, { name: "Mob A" }, { name: "Mob A" }],
            }],
        };
        const [ability] = topAvoidableAbilities(byAbility);
        expect(ability.sources).toEqual(["Boss", "Mob A"]);
    });

    test("carries the ability's icon and id through to the column head", () => {
        const byAbility = {
            entries: [{
                guid: Number(tracked[0].ids[0]),
                total: 10,
                abilityIcon: "spell_fire_selfdestruct.jpg",
                sources: [{ name: "Mob A" }],
            }],
        };
        const [ability] = topAvoidableAbilities(byAbility);
        expect(ability.icon).toBe("spell_fire_selfdestruct.jpg");
        expect(ability.spellId).toBe(Number(tracked[0].ids[0]));
    });

    test("an ability the log carried no icon for stays empty instead of guessing one", () => {
        const byAbility = {
            entries: [{ guid: Number(tracked[0].ids[0]), total: 10, sources: [] }],
        };
        const [ability] = topAvoidableAbilities(byAbility);
        expect(ability.icon).toBe("");
        expect(ability.spellId).toBeNull();
    });

    test("caps the list at MAX_ABILITIES", () => {
        const entries = rpbData.DAMAGE_TAKEN.map((t, i) => ({
            guid: Number(t.ids[0]),
            total: 1000 - i,
            sources: [],
        }));
        expect(topAvoidableAbilities({ entries }).length).toBeLessThanOrEqual(MAX_ABILITIES);
    });

    test("empty or missing input yields an empty list", () => {
        expect(topAvoidableAbilities(null)).toEqual([]);
        expect(topAvoidableAbilities({ entries: [] })).toEqual([]);
    });
});

describe("rpb/damage reflectFilter", () => {
    test("excludes every known self-damage ability and Kalecgos", () => {
        const f = reflectFilter();
        expect(f).toContain("target.name=source.name");
        expect(f).toContain(`encounterid != ${rpbData.EXCLUDED_ENCOUNTER_ID}`);
        for (const id of REFLECT_EXCLUDED_IDS) {
            expect(f).toContain(`ability.id!='${id}'`);
        }
    });
});

describe("rpb/damage analyzeDamage", () => {
    function makeWcl(overrides = {}) {
        return {
            getDamageTaken: jest.fn(async (id, s, e, opts = {}) => {
                if (opts.by === "ability") {
                    return {
                        entries: [
                            { guid: Number(tracked[0].ids[0]), total: 500, sources: [{ name: "Mob" }] },
                        ],
                    };
                }
                if (opts.filter && opts.filter.includes("target.name=source.name")) {
                    return { entries: [{ name: "Tank", total: 42 }] };
                }
                // per-player table
                return { entries: [{ guid: Number(tracked[0].ids[0]), total: opts.sourceid === 1 ? 300 : 200 }] };
            }),
            getDamageDone: jest.fn(async () => ({ entries: [{ name: "Heal", total: 7 }] })),
            getDeaths: jest.fn(async (id, s, e, opts = {}) => (
                opts.encounter === 0
                    ? { entries: [{ name: "Tank" }] }
                    : { entries: [{ name: "Tank" }, { name: "Tank" }, { name: "Heal" }] }
            )),
            ...overrides,
        };
    }

    test("builds per-player rows with avoidable totals, reflect, hostile and deaths", async () => {
        const result = await analyzeDamage(makeWcl(), "rep", fights, players);
        expect(result.abilities).toHaveLength(1);
        expect(result.players).toHaveLength(2);

        const tank = result.players.find((p) => p.name === "Tank");
        expect(tank.avoidableTotal).toBe(300);
        expect(tank.perAbility[0]).toBe(300);
        expect(tank.reflected).toBe(42);
        expect(tank.deaths).toBe(2);
        expect(tank.deathsTrash).toBe(1);

        const heal = result.players.find((p) => p.name === "Heal");
        expect(heal.hostile).toBe(7);
        expect(heal.deaths).toBe(1);
    });

    test("sorts players by avoidable damage descending", async () => {
        const result = await analyzeDamage(makeWcl(), "rep", fights, players);
        expect(result.players.map((p) => p.name)).toEqual(["Tank", "Heal"]);
    });

    test("a failing per-player table leaves that player at zero", async () => {
        const wcl = makeWcl({
            getDamageTaken: jest.fn(async (id, s, e, opts = {}) => {
                if (opts.by === "ability") {
                    return { entries: [{ guid: Number(tracked[0].ids[0]), total: 500, sources: [] }] };
                }
                if (opts.sourceid === 1) throw new Error("boom");
                return { entries: [{ guid: Number(tracked[0].ids[0]), total: 200 }] };
            }),
        });
        const result = await analyzeDamage(wcl, "rep", fights, players);
        expect(result.players.find((p) => p.name === "Tank").avoidableTotal).toBe(0);
        expect(result.players.find((p) => p.name === "Heal").avoidableTotal).toBe(200);
    });

    test("failing raid-wide extras degrade to zero instead of throwing", async () => {
        const wcl = makeWcl({
            getDamageDone: jest.fn(async () => { throw new Error("nope"); }),
            getDeaths: jest.fn(async () => { throw new Error("nope"); }),
        });
        const result = await analyzeDamage(wcl, "rep", fights, players);
        expect(result.players.every((p) => p.hostile === 0 && p.deaths === 0)).toBe(true);
    });

    test("no players returns null", async () => {
        expect(await analyzeDamage(makeWcl(), "rep", fights, [])).toBeNull();
    });

    test("skips the trash deaths call when the report has no trash", async () => {
        const wcl = makeWcl();
        const bossOnly = { end: 5000, fights: [{ id: 1, boss: 601, start_time: 0, end_time: 1000 }] };
        await analyzeDamage(wcl, "rep", bossOnly, players);
        const trashCalls = wcl.getDeaths.mock.calls.filter((c) => c[3] && c[3].encounter === 0);
        expect(trashCalls).toHaveLength(0);
    });
});
