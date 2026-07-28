const { analyzeRpb, rpbSummaryLines } = require("../../../../src/utils/logcheck/rpb");

const fights = {
    end: 10000,
    zone: 1008,
    enemies: [],
    fights: [
        { id: 1, boss: 0, start_time: 0, end_time: 10_000 },
        { id: 2, boss: 601, start_time: 10_000, end_time: 40_000, kill: true },
    ],
};
const players = [
    { id: 1, name: "Mage", type: "Mage" },
    { id: 2, name: "Holy", type: "Priest" },
];

/** A WCL double that answers every table the RPB touches with empty-but-valid data. */
function makeWcl(overrides = {}) {
    return {
        getSummary: jest.fn(async () => ({
            composition: [
                { id: 1, specs: [{ role: "dps", spec: "Fire" }] },
                { id: 2, specs: [{ role: "healer" }] },
            ],
            playerDetails: { dps: [], healers: [], tanks: [] },
        })),
        getCasts: jest.fn(async () => ({ entries: [] })),
        getBuffs: jest.fn(async () => ({ auras: [] })),
        getDamageTaken: jest.fn(async () => ({ entries: [] })),
        getDamageDone: jest.fn(async () => ({ entries: [] })),
        getDeaths: jest.fn(async () => ({ entries: [] })),
        getInterrupts: jest.fn(async () => ({ entries: [] })),
        ...overrides,
    };
}

describe("rpb analyzeRpb", () => {
    test("assigns roles and groups the roster by them", async () => {
        const result = await analyzeRpb(makeWcl(), "rep", fights, players);
        expect(result.roles).toEqual({ Mage: "Caster", Holy: "Healer" });
        expect(result.byRole.Caster.map((p) => p.name)).toEqual(["Mage"]);
        expect(result.byRole.Healer.map((p) => p.name)).toEqual(["Holy"]);
        expect(result.byRole.Tank).toEqual([]);
    });

    test("fetches one summary per boss fight only", async () => {
        const wcl = makeWcl();
        await analyzeRpb(wcl, "rep", fights, players);
        expect(wcl.getSummary).toHaveBeenCalledTimes(1);
    });

    test("fetches the cast tables once per player, not once per analyzer", async () => {
        const wcl = makeWcl();
        await analyzeRpb(wcl, "rep", fights, players);
        // two calls per player: the full table and the trash-only one
        expect(wcl.getCasts).toHaveBeenCalledTimes(players.length * 2);
        expect(wcl.getBuffs).toHaveBeenCalledTimes(players.length);
    });

    test("reports raid and boss seconds", async () => {
        const result = await analyzeRpb(makeWcl(), "rep", fights, players);
        expect(result.raidSeconds).toBe(40);
        expect(result.bossSeconds).toBe(30);
    });

    test("a failing sub-analyzer leaves the rest of the result intact", async () => {
        const wcl = makeWcl({
            getInterrupts: jest.fn(async () => { throw new Error("interrupts down"); }),
        });
        const result = await analyzeRpb(wcl, "rep", fights, players);
        expect(result.interrupts).toBeNull();
        expect(result.roles).toBeDefined();
        expect(result.validation).not.toBeNull();
    });

    test("a player whose cast table fails is skipped without aborting", async () => {
        const wcl = makeWcl({
            getCasts: jest.fn(async (id, s, e, opts = {}) => {
                if (opts.sourceid === 1) throw new Error("nope");
                return { entries: [] };
            }),
        });
        const result = await analyzeRpb(wcl, "rep", fights, players);
        expect(result.usage.map((u) => u.name)).toEqual(["Holy"]);
        expect(result.roles.Mage).toBe("Caster");
    });

    test("no players returns null", async () => {
        expect(await analyzeRpb(makeWcl(), "rep", fights, [])).toBeNull();
        expect(await analyzeRpb(makeWcl(), "rep", fights, null)).toBeNull();
    });
});

describe("rpb rpbSummaryLines", () => {
    test("returns nothing without a result", () => {
        expect(rpbSummaryLines(null)).toEqual([]);
    });

    test("summarises roles, deaths, interrupts and validity", () => {
        const lines = rpbSummaryLines({
            byRole: { Tank: [{}, {}], Healer: [{}], Caster: [], Physical: [] },
            damage: { players: [{ deaths: 2 }, { deaths: 1 }] },
            interrupts: { players: [{}, {}] },
            validation: { valid: true },
        });
        expect(lines.join("\n")).toContain("Tank 2");
        expect(lines.join("\n")).toContain("Healer 1");
        expect(lines.join("\n")).toContain("3");
        expect(lines.join("\n")).toContain("✅");
    });

    test("flags a log that misses the trash requirements", () => {
        const lines = rpbSummaryLines({ byRole: {}, validation: { valid: false } });
        expect(lines.join("\n")).toContain("⚠️");
    });

    test("omits the verdict when no requirements are known", () => {
        const lines = rpbSummaryLines({ byRole: {}, validation: { valid: null } });
        expect(lines.join("\n")).not.toContain("Trash-Anforderungen");
    });
});
