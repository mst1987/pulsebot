const { analyzeBossUptimes } = require("../../../src/utils/logcheck/bossUptimes");

describe("logcheck/bossUptimes analyzeBossUptimes", () => {
    test("computes per-boss debuff uptime percentages", async () => {
        const fights = {
            fights: [
                { name: "Gruul", boss: 1, kill: true, start_time: 0, end_time: 100 },
                { name: "Trash", boss: 0, start_time: 100, end_time: 200 }, // ignored
            ],
        };
        const wcl = {
            getDebuffs: jest.fn(async () => ({
                auras: [
                    { name: "Faerie Fire", totalUptime: 80 },
                    { name: "Judgement of Wisdom", totalUptime: 50 },
                ],
            })),
        };
        const out = await analyzeBossUptimes(wcl, "rep", fights);
        expect(out.rows).toHaveLength(1);
        expect(out.rows[0]).toMatchObject({
            boss: "Gruul", kill: true, faerie: 80, expose: 0, jWisdom: 50, jLight: 0,
        });
        expect(out.metrics.map((m) => m.key)).toEqual(["faerie", "expose", "jWisdom", "jLight"]);
        expect(wcl.getDebuffs).toHaveBeenCalledTimes(1); // only the boss fight
    });

    test("uptime is capped at 100%", async () => {
        const fights = { fights: [{ name: "Mag", boss: 2, kill: false, start_time: 0, end_time: 100 }] };
        const wcl = {
            getDebuffs: jest.fn(async () => ({ auras: [{ name: "Expose Armor", totalUptime: 150 }] })),
        };
        const out = await analyzeBossUptimes(wcl, "rep", fights);
        expect(out.rows[0].expose).toBe(100);
    });

    test("sums multiple auras matching the same metric name", async () => {
        const fights = { fights: [{ name: "Boss", boss: 3, start_time: 0, end_time: 100 }] };
        const wcl = {
            getDebuffs: jest.fn(async () => ({
                auras: [
                    { name: "Faerie Fire", totalUptime: 30 },
                    { name: "Faerie Fire (Feral)", totalUptime: 40 },
                ],
            })),
        };
        const out = await analyzeBossUptimes(wcl, "rep", fights);
        expect(out.rows[0].faerie).toBe(70);
    });

    test("zero-duration fights are skipped", async () => {
        const fights = {
            fights: [
                { name: "Instant", boss: 1, start_time: 50, end_time: 50 },
                { name: "Real", boss: 1, start_time: 0, end_time: 100 },
            ],
        };
        const wcl = { getDebuffs: jest.fn(async () => ({ auras: [] })) };
        const out = await analyzeBossUptimes(wcl, "rep", fights);
        expect(out.rows).toHaveLength(1);
        expect(out.rows[0].boss).toBe("Real");
        expect(wcl.getDebuffs).toHaveBeenCalledTimes(1);
    });

    test("no boss fights returns null", async () => {
        const wcl = { getDebuffs: jest.fn() };
        expect(await analyzeBossUptimes(wcl, "rep", { fights: [{ name: "T", boss: 0 }] })).toBeNull();
        expect(wcl.getDebuffs).not.toHaveBeenCalled();
    });

    test("a per-fight API error skips that fight (null when all fail)", async () => {
        const fights = { fights: [{ name: "Boss", boss: 1, start_time: 0, end_time: 100 }] };
        const wcl = { getDebuffs: jest.fn(async () => { throw new Error("x"); }) };
        expect(await analyzeBossUptimes(wcl, "rep", fights)).toBeNull();
    });
});
