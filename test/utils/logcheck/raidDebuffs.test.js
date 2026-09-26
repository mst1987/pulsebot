const {
    analyzeRaidDebuffs, debuffRowsForFight, classCounts, mainTargetEvents, summarize,
} = require("../../../src/utils/logcheck/raidDebuffs");
const { DEBUFFS, expectedDebuffs, debuffByGuid } = require("../../../src/config/raidDebuffs");
const { fight: gruulFight } = require("../../factories/wcl");

const SUNDER = 25225;   // Sunder Armor rank 6
const COE = 27228;      // Curse of the Elements rank 4
const FF = 26993;       // Faerie Fire rank 5
const MISERY = 33198;   // Misery rank 3

const fight = gruulFight();
const fights = { end: 500000, fights: [{ id: 1, boss: 0, name: "Trash", start_time: 0, end_time: 1000 }, fight] };

function sunderEvents(base, targetID = 30) {
    const ev = (dt, type, stack) => ({ timestamp: base + dt, type, targetID, stack, ability: { guid: SUNDER, name: "Sunder Armor" } });
    return [
        ev(2000, "applydebuff"), ev(3500, "applydebuffstack", 2), ev(5000, "applydebuffstack", 3),
        ev(6500, "applydebuffstack", 4), ev(8000, "applydebuffstack", 5), ev(20000, "refreshdebuff", 5),
        ev(60000, "removedebuff"), ev(70000, "applydebuff"),
    ];
}

describe("config/raidDebuffs", () => {
    it("lists every id once, with provider, label, icon and group on every entry", () => {
        const seen = new Set();
        for (const d of DEBUFFS) {
            expect(d.key).toBeTruthy();
            expect(d.label).toBeTruthy();
            expect(d.icon).toBeTruthy();
            expect(d.provider).toBeTruthy();
            expect(d.group).toBeTruthy();
            expect(["class", "seen", "never"]).toContain(d.expect);
            expect(d.ids.length).toBeGreaterThan(0);
            for (const id of d.ids) {
                expect(seen.has(id)).toBe(false);
                seen.add(id);
            }
        }
    });

    it("resolves any rank to its debuff", () => {
        expect(debuffByGuid(SUNDER).key).toBe("sunder");
        expect(debuffByGuid("7386").key).toBe("sunder");
        expect(debuffByGuid(COE).key).toBe("coe");
        expect(debuffByGuid(1)).toBeNull();
        expect(debuffByGuid(undefined)).toBeNull();
    });

    it("expects class-provided debuffs only when the class raided", () => {
        const withLock = expectedDebuffs({ Warrior: 2, Warlock: 1, Druid: 1 }, new Set());
        expect(withLock.has("sunder")).toBe(true);
        expect(withLock.has("coe")).toBe(true);
        expect(withLock.has("ff")).toBe(true);
        const noLock = expectedDebuffs({ Warrior: 2 }, new Set());
        expect(noLock.has("coe")).toBe(false);
        expect(noLock.has("ff")).toBe(false);
    });

    it("expects spec-gated debuffs only once they were seen somewhere in the raid", () => {
        expect(expectedDebuffs({ Priest: 3 }, new Set()).has("misery")).toBe(false);
        expect(expectedDebuffs({ Priest: 3 }, new Set(["misery"])).has("misery")).toBe(true);
        // seen but the class is not in the roster (a pet or a mislabelled actor): still not expected
        expect(expectedDebuffs({}, new Set(["misery"])).has("misery")).toBe(false);
    });

    it("never expects the optional ones", () => {
        const all = expectedDebuffs({ Warlock: 3, Hunter: 2 }, new Set(["recklessness", "scorpidSting"]));
        expect(all.has("recklessness")).toBe(false);
        expect(all.has("scorpidSting")).toBe(false);
    });
});

describe("logcheck/raidDebuffs — rows for one fight", () => {
    const auras = [
        { guid: SUNDER, name: "Sunder Armor", totalUptime: 100000, abilityIcon: "ability_warrior_sunder", bands: [{ startTime: 302000, endTime: 360000 }, { startTime: 370000, endTime: 420000 }] },
        { guid: FF, name: "Faerie Fire", totalUptime: 118000, abilityIcon: "spell_nature_faeriefire", bands: [{ startTime: 290000, endTime: 425000 }] },
        { guid: 99999, name: "Something Else", totalUptime: 5, bands: [{ startTime: 300000, endTime: 300005 }] },
    ];

    it("keeps the intervals, the uptime and the gaps per debuff", () => {
        const rows = debuffRowsForFight(fight, auras, {}, new Set(["sunder", "ff"]));
        const sunder = rows.find((r) => r.key === "sunder");
        expect(sunder.bands).toEqual([[2000, 60000], [70000, 120000]]);
        expect(sunder.uptimePct).toBe(90);
        expect(sunder.gapCount).toBe(2);
        expect(sunder.longestGap).toBe(10000);
        expect(sunder.firstAt).toBe(2000);
        expect(sunder.icon).toBe("ability_warrior_sunder");
        expect(sunder.expected).toBe(true);
        expect(sunder.missing).toBe(false);
        const ff = rows.find((r) => r.key === "ff");
        expect(ff.bands).toEqual([[0, 120000]]);
        expect(ff.uptimePct).toBe(100);
        expect(rows.find((r) => r.key === "unknown")).toBeUndefined();
    });

    it("lists an expected debuff that never landed as missing, and drops an unexpected absent one", () => {
        const rows = debuffRowsForFight(fight, auras, {}, new Set(["sunder", "ff", "coe"]));
        const coe = rows.find((r) => r.key === "coe");
        expect(coe.missing).toBe(true);
        expect(coe.uptimePct).toBe(0);
        expect(coe.bands).toEqual([]);
        expect(rows.find((r) => r.key === "misery")).toBeUndefined();
    });

    it("shows a debuff that landed although nobody expected it", () => {
        const rows = debuffRowsForFight(fight, auras, {}, new Set());
        expect(rows.map((r) => r.key).sort()).toEqual(["ff", "sunder"]);
        expect(rows.every((r) => r.expected === false && r.missing === false)).toBe(true);
    });

    it("follows the stack height of a stacking debuff and measures the time to full stacks", () => {
        const rows = debuffRowsForFight(fight, auras, { sunder: sunderEvents(300000) }, new Set(["sunder"]));
        const sunder = rows.find((r) => r.key === "sunder");
        expect(sunder.maxStacks).toBe(5);
        expect(sunder.stacks.map((b) => b.stacks)).toEqual([1, 2, 3, 4, 5, 1]);
        expect(sunder.stacks[4]).toEqual({ from: 8000, to: 60000, stacks: 5 });
        expect(sunder.timeToMax).toBe(8000);
        expect(sunder.targets).toBe(1);
        // 6 s climbing plus 50 s at one stack after the re-apply, of 108 s uptime
        expect(sunder.belowMaxPct).toBe(52);
    });

    it("has no stack data when a stacking debuff never got any events", () => {
        const rows = debuffRowsForFight(fight, auras, {}, new Set(["sunder"]));
        const sunder = rows.find((r) => r.key === "sunder");
        expect(sunder.stacks).toEqual([]);
        expect(sunder.timeToMax).toBeNull();
        expect(sunder.belowMaxPct).toBe(0);
    });

    it("does not mark a member of an exclusive group missing when another member covered it", () => {
        // a rogue's Expose Armor instead of Sunder: the armour slot was filled
        const expose = DEBUFFS.find((d) => d.key === "expose");
        const exposeAuras = [{ guid: expose.ids[expose.ids.length - 1], name: "Expose Armor", totalUptime: 100000, bands: [{ startTime: 300000, endTime: 420000 }] }];
        const rows = debuffRowsForFight(fight, exposeAuras, {}, new Set(["sunder", "expose"]));
        expect(rows.find((r) => r.key === "expose").uptimePct).toBe(100);
        expect(rows.find((r) => r.key === "sunder")).toBeUndefined();
    });

    it("reports an exclusive group nobody covered once, on its first expected member", () => {
        const rows = debuffRowsForFight(fight, [], {}, new Set(["jow", "jol", "joc", "demoRoar"]));
        expect(rows.map((r) => r.key)).toEqual(["jow", "demoRoar"]);
        expect(rows.every((r) => r.missing)).toBe(true);
    });
});

describe("logcheck/raidDebuffs — helpers", () => {
    it("counts the roster per class", () => {
        expect(classCounts([{ type: "Warrior" }, { type: "Warrior" }, { type: "Mage" }, {}])).toEqual({ Warrior: 2, Mage: 1 });
    });

    it("picks the target with the most events on a council fight", () => {
        const a = sunderEvents(0, 30);
        const b = sunderEvents(0, 31).slice(0, 3);
        const picked = mainTargetEvents([...b, ...a]);
        expect(picked.events).toHaveLength(a.length);
        expect(picked.events[0].targetID).toBe(30);
        expect(picked.targets).toBe(2);
    });

    it("summarizes per debuff across the fights", () => {
        const rows = summarize([
            { debuffs: [{ key: "sunder", label: "Sunder Armor", expected: true, uptimePct: 90, missing: false, maxStacks: 5, belowMaxPct: 20 }] },
            { debuffs: [{ key: "sunder", label: "Sunder Armor", expected: true, uptimePct: 70, missing: false, maxStacks: 5, belowMaxPct: 40 }, { key: "coe", label: "CoE", expected: true, uptimePct: 0, missing: true, maxStacks: 0 }] },
            { debuffs: null },
        ]);
        expect(rows).toEqual([
            expect.objectContaining({ key: "sunder", fights: 2, missing: 0, avgUptime: 80, avgBelowMax: 30 }),
            expect.objectContaining({ key: "coe", fights: 1, missing: 1, avgUptime: 0, avgBelowMax: null }),
        ]);
    });
});

describe("logcheck/raidDebuffs — analyzeRaidDebuffs", () => {
    const players = [{ name: "Brokk", type: "Warrior" }, { name: "Farin", type: "Warlock" }, { name: "Elun", type: "Priest" }];

    function wcl(overrides = {}) {
        return {
            getDebuffs: jest.fn(async () => ({ auras: [
                { guid: SUNDER, name: "Sunder Armor", totalUptime: 100000, bands: [{ startTime: 302000, endTime: 420000 }] },
                { guid: MISERY, name: "Misery", totalUptime: 50000, bands: [{ startTime: 310000, endTime: 360000 }] },
            ] })),
            getAllEvents: jest.fn(async () => sunderEvents(300000)),
            ...overrides,
        };
    }

    it("fills every boss fight of the timeline and returns the raid summary", async () => {
        const client = wcl();
        const timeline = { fights: [{ id: 3, boss: "Gruul the Dragonkiller", deaths: [], debuffs: null }] };
        const result = await analyzeRaidDebuffs(client, "abc", fights, players, timeline);

        expect(client.getDebuffs).toHaveBeenCalledTimes(1);
        expect(client.getDebuffs).toHaveBeenCalledWith("abc", 300000, 420000, { hostility: 1 });
        expect(client.getAllEvents).toHaveBeenCalledTimes(1);
        const [, view, start, end, extra, opts] = client.getAllEvents.mock.calls[0];
        expect(view).toBe("debuffs");
        expect([start, end]).toEqual([300000, 420000]);
        expect(extra.hostility).toBe(1);
        expect(extra.filter).toMatch(/^ability\.id in \(\d+(,\d+)*\)$/);
        expect(extra.filter).toContain(String(SUNDER));
        expect(opts.maxPages).toBeGreaterThan(50);

        const rows = timeline.fights[0].debuffs;
        expect(rows.find((r) => r.key === "sunder").stacks.length).toBeGreaterThan(0);
        // Misery was seen, so the shadow priest is expected; CoE from the warlock is expected and missing
        expect(rows.find((r) => r.key === "misery").expected).toBe(true);
        expect(rows.find((r) => r.key === "coe").missing).toBe(true);
        expect(result.expected).toEqual(expect.arrayContaining(["sunder", "coe", "misery"]));
        expect(result.rows.find((r) => r.key === "coe").missing).toBe(1);
    });

    it("leaves a fight null when its table cannot be fetched, and goes on with the others", async () => {
        let n = 0;
        const client = wcl({ getDebuffs: jest.fn(async () => { if (n++ === 0) throw new Error("boom"); return { auras: [] }; }) });
        const timeline = { fights: [{ id: 3, debuffs: null }, { id: 4, debuffs: null }] };
        const twoFights = { fights: [fight, { ...fight, id: 4, start_time: 430000, end_time: 500000 }] };
        await analyzeRaidDebuffs(client, "abc", twoFights, players, timeline);
        expect(timeline.fights[0].debuffs).toBeNull();
        expect(Array.isArray(timeline.fights[1].debuffs)).toBe(true);
    });

    it("keeps the bands when the event pull fails", async () => {
        const client = wcl({ getAllEvents: jest.fn(async () => { throw new Error("boom"); }) });
        const timeline = { fights: [{ id: 3, debuffs: null }] };
        await analyzeRaidDebuffs(client, "abc", fights, players, timeline);
        const sunder = timeline.fights[0].debuffs.find((r) => r.key === "sunder");
        expect(sunder.uptimePct).toBe(98);
        expect(sunder.stacks).toEqual([]);
    });

    it("is null without a timeline", async () => {
        expect(await analyzeRaidDebuffs(wcl(), "abc", fights, players, null)).toBeNull();
        expect(await analyzeRaidDebuffs(wcl(), "abc", fights, players, { fights: [] })).toBeNull();
    });
});
