const {
    analyzeTotems, analyzeShamanFight, summarize, twistCycles, presenceBands, downtimesBetween, roleFor,
} = require("../../../src/utils/logcheck/totems");
const { TOTEMS, SLOTS, totemByCast, totemByBuff } = require("../../../src/config/totems");

const def = (key) => TOTEMS.find((d) => d.key === key);
const castId = (key) => def(key).castIds[def(key).castIds.length - 1];
const buffId = (key) => def(key).buffIds[def(key).buffIds.length - 1];

const START = 300000;
const END = 420000; // a 2-minute fight

const cast = (key, at) => ({ type: "cast", timestamp: START + at, sourceID: 7, ability: { guid: castId(key), name: def(key).name } });
const aura = (key, bands) => ({ guid: buffId(key), name: def(key).name, bands: bands.map(([a, z]) => ({ startTime: START + a, endTime: START + z })) });

/** A twisting enhancement shaman: Windfury every 10 s, Grace of Air 4 s after each. */
function twistingCasts(until = 120000, cycle = 10000) {
    const out = [];
    for (let t = 1000; t < until; t += cycle) {
        out.push(cast("windfury", t));
        out.push(cast("graceOfAir", t + 4000));
    }
    return out;
}

describe("config/totems", () => {
    it("lists every cast and buff id once, each totem with slot, duration, label and icon", () => {
        const seen = new Set();
        for (const d of TOTEMS) {
            expect(SLOTS).toContain(d.slot);
            expect(d.duration).toBeGreaterThan(0);
            expect(d.label).toBeTruthy();
            expect(d.icon).toBeTruthy();
            expect(d.castIds.length).toBeGreaterThan(0);
            for (const id of [...d.castIds, ...d.buffIds]) {
                expect(seen.has(id)).toBe(false);
                seen.add(id);
            }
        }
        expect(["windfury", "graceOfAir", "wrathOfAir", "totemOfWrath", "strengthOfEarth", "manaSpring", "manaTide", "tremor"].every((k) => def(k))).toBe(true);
    });

    it("resolves any rank of a cast or a party buff to its totem", () => {
        expect(totemByCast(def("windfury").castIds[0]).key).toBe("windfury");
        expect(totemByCast(String(castId("strengthOfEarth"))).key).toBe("strengthOfEarth");
        expect(totemByBuff(buffId("windfury")).key).toBe("windfury");
        expect(totemByCast(1)).toBeNull();
        expect(totemByBuff(undefined)).toBeNull();
    });
});

describe("logcheck/totems — helpers", () => {
    it("counts a twist cycle only when another air totem was dropped between two Windfury drops", () => {
        expect(twistCycles([1000, 11000, 21000, 40000], [5000, 15000])).toEqual([10000, 10000]);
        expect(twistCycles([1000, 11000], [])).toEqual([]);
        expect(twistCycles([1000], [5000])).toEqual([]);
    });

    it("lets a totem without a buff stand until the next drop in its slot, its duration or the end", () => {
        const tremor = def("tremor");
        expect(presenceBands([1000, 50000], [1000, 30000, 50000], tremor, 100000)).toEqual([[1000, 30000], [50000, 100000]]);
        expect(presenceBands([1000], [1000], { ...tremor, duration: 20 }, 100000)).toEqual([[1000, 21000]]);
    });

    it("measures gaps inside a window and ignores sub-second flickers", () => {
        const d = downtimesBetween([[0, 10000], [10500, 30000], [45000, 60000]], 5000, 60000);
        expect(d.gaps).toEqual([[30000, 45000]]);
        expect(d.uptimePct).toBe(72);
        expect(d.longestGap).toBe(15000);
        expect(downtimesBetween([[0, 10]], 10, 10).gaps).toEqual([]);
    });

    it("reads the role off the totem choice", () => {
        expect(roleFor(new Set(["windfury", "manaSpring"]))).toBe("melee");
        expect(roleFor(new Set(["totemOfWrath"]))).toBe("caster");
        expect(roleFor(new Set(["manaSpring", "tremor"]))).toBe("healer");
        expect(roleFor(new Set(["tremor"]))).toBe("");
    });
});

describe("logcheck/totems — analyzeShamanFight", () => {
    it("recognises twisting from the drops and measures the Windfury uptime from the party buff", () => {
        // the buff the party actually carried: up from every drop for 9.5 s, the
        // next drop comes at +10 s — half a second short, under the gap floor
        const wfBands = [];
        for (let t = 1000; t < 120000; t += 10000) wfBands.push([t, Math.min(120000, t + 9500)]);
        const r = analyzeShamanFight({
            name: "Dorn", type: "Shaman",
            casts: [...twistingCasts(), cast("strengthOfEarth", 500), cast("manaSpring", 800)],
            auras: [aura("windfury", wfBands), aura("graceOfAir", [[5000, 120000]]), aura("strengthOfEarth", [[500, 120000]]), aura("manaSpring", [[800, 120000]])],
            start: START, end: END, deathAt: null,
        });
        expect(r.role).toBe("melee");
        expect(r.twisting.detected).toBe(true);
        expect(r.twisting.cycles).toBe(11);
        expect(r.twisting.avgCycleMs).toBe(10000);
        // the half-second between linger and next drop is under the gap floor
        expect(r.twisting.gapCount).toBe(0);
        expect(r.twisting.wfUptimePct).toBe(95);
        expect(r.rows.map((x) => x.key)).toEqual(["windfury", "graceOfAir", "strengthOfEarth", "manaSpring"]);
        const wf = r.rows[0];
        expect(wf.markers).toHaveLength(12);
        expect(wf.markers[0]).toEqual({ at: 1000, icon: def("windfury").icon, label: def("windfury").label });
        expect(wf.band[0]).toEqual([1000, 10500]);
        expect(r.slots.air.uptimePct).toBe(100);
        expect(r.slots.earth.uptimePct).toBe(100);
        expect(r.slots.water.uptimePct).toBe(100);
        expect(r.slots.fire).toBeUndefined();
    });

    it("reports Windfury gaps as downtime when the shaman twisted too slowly", () => {
        const casts = twistingCasts(120000, 13000); // 13 s cycles: 3 s without Windfury each time
        const wfBands = [];
        for (let t = 1000; t < 120000; t += 13000) wfBands.push([t, Math.min(120000, t + 10000)]);
        const r = analyzeShamanFight({ name: "Dorn", casts, auras: [aura("windfury", wfBands)], start: START, end: END, deathAt: null });
        expect(r.twisting.detected).toBe(true);
        expect(r.twisting.avgCycleMs).toBe(13000);
        expect(r.twisting.gapCount).toBe(9);
        expect(r.twisting.downtimeMs).toBe(9 * 3000); // three seconds without Windfury per cycle
        expect(r.twisting.longestGap).toBe(3000);
        expect(r.rows[0].downtimes[0]).toEqual([11000, 14000]);
    });

    it("sees no twisting when Windfury stood alone, and a full uptime", () => {
        const r = analyzeShamanFight({
            name: "Dorn", casts: [cast("windfury", 1000)], auras: [aura("windfury", [[1000, 120000]])],
            start: START, end: END, deathAt: null,
        });
        expect(r.twisting).toEqual(expect.objectContaining({ detected: false, cycles: 0, avgCycleMs: null, wfUptimePct: 100, gapCount: 0 }));
    });

    it("stops judging at the shaman's death, so the rest of the fight is not a gap", () => {
        const r = analyzeShamanFight({
            name: "Dorn", casts: [cast("windfury", 1000)], auras: [aura("windfury", [[1000, 61000]])],
            start: START, end: END, deathAt: 60000,
        });
        expect(r.judgedUntil).toBe(60000);
        expect(r.diedAt).toBe(60000);
        expect(r.twisting.wfUptimePct).toBe(100);
        expect(r.twisting.gapCount).toBe(0);
    });

    it("draws presence for a totem without a party buff and covers its slot with it", () => {
        const r = analyzeShamanFight({
            name: "Dorn", casts: [cast("tremor", 2000), cast("tremor", 70000)], auras: [], start: START, end: END, deathAt: null,
        });
        const row = r.rows[0];
        expect(row.buffed).toBe(false);
        expect(row.uptimePct).toBeNull();
        expect(row.downtimes).toEqual([]);
        // the second drop takes over seamlessly, so the presence is one band
        expect(row.band).toEqual([[2000, 120000]]);
        expect(r.slots.earth.uptimePct).toBe(100);
        expect(r.role).toBe("");
        expect(r.twisting).toBeNull();
    });

    it("reads a caster shaman off Totem of Wrath and reports its uptime", () => {
        const r = analyzeShamanFight({
            name: "Zap", casts: [cast("totemOfWrath", 1500), cast("wrathOfAir", 3000)],
            auras: [aura("totemOfWrath", [[1500, 60000], [80000, 120000]]), aura("wrathOfAir", [[3000, 120000]])],
            start: START, end: END, deathAt: null,
        });
        expect(r.role).toBe("caster");
        const tow = r.rows.find((x) => x.key === "totemOfWrath");
        expect(tow.uptimePct).toBe(83);
        expect(tow.downtimes).toEqual([[60000, 80000]]);
        expect(r.slots.fire.gapCount).toBe(1);
    });

    it("is null when the shaman dropped nothing, and ignores non-cast and out-of-window events", () => {
        expect(analyzeShamanFight({ name: "x", casts: [], auras: [], start: START, end: END })).toBeNull();
        const r = analyzeShamanFight({
            name: "x",
            casts: [{ ...cast("windfury", 1000), type: "begincast" }, cast("windfury", 999999), { type: "cast", ability: { guid: 1 } }],
            auras: [], start: START, end: END,
        });
        expect(r).toBeNull();
    });
});

describe("logcheck/totems — summarize", () => {
    it("folds each shaman's fights into averages and totals", () => {
        const rows = summarize([
            { totems: [{ name: "Dorn", type: "Shaman", role: "melee", twisting: { detected: true, wfUptimePct: 90, downtimeMs: 5000, gapCount: 2 }, slots: { air: { downtimeMs: 5000 }, earth: { downtimeMs: 0 } } }] },
            { totems: [{ name: "Dorn", type: "Shaman", role: "melee", twisting: { detected: false, wfUptimePct: 70, downtimeMs: 20000, gapCount: 4 }, slots: { air: { downtimeMs: 20000 } } },
                { name: "Heal", type: "Shaman", role: "healer", twisting: null, slots: { water: { downtimeMs: 3000 } } }] },
            { totems: null },
        ]);
        expect(rows).toEqual([
            { name: "Dorn", type: "Shaman", role: "melee", fights: 2, wfFights: 2, wfUptimeAvg: 80, twistingFights: 1, downtimeMs: 25000, gapCount: 6, slotDowntimeMs: { air: 25000, earth: 0 } },
            { name: "Heal", type: "Shaman", role: "healer", fights: 1, wfFights: 0, wfUptimeAvg: null, twistingFights: 0, downtimeMs: 0, gapCount: 0, slotDowntimeMs: { water: 3000 } },
        ]);
    });
});

describe("logcheck/totems — analyzeTotems", () => {
    const fights = { fights: [{ id: 1, boss: 0, name: "Trash", start_time: 0, end_time: 1000 }, { id: 3, boss: 650, name: "Gruul", start_time: START, end_time: END }] };
    const players = [{ id: 7, name: "Dorn", type: "Shaman" }, { id: 8, name: "Aldra", type: "Mage" }];

    function wcl(overrides = {}) {
        return {
            getAllEvents: jest.fn(async () => twistingCasts()),
            getBuffs: jest.fn(async () => ({ auras: [aura("windfury", [[1000, 120000]])] })),
            ...overrides,
        };
    }

    it("pulls casts and buffs per shaman and fight, writes the fight rows and returns the summary", async () => {
        const client = wcl();
        const timeline = { fights: [{ id: 3, boss: "Gruul", deaths: [], totems: null }] };
        const result = await analyzeTotems(client, "abc", fights, players, timeline);

        expect(client.getAllEvents).toHaveBeenCalledTimes(1);
        const [id, view, start, end, extra] = client.getAllEvents.mock.calls[0];
        expect([id, view, start, end]).toEqual(["abc", "casts", START, END]);
        expect(extra.sourceid).toBe(7);
        expect(extra.filter).toContain(String(castId("windfury")));
        expect(client.getBuffs).toHaveBeenCalledWith("abc", START, END, { sourceid: 7 });

        expect(timeline.fights[0].totems).toHaveLength(1);
        expect(timeline.fights[0].totems[0].name).toBe("Dorn");
        expect(timeline.fights[0].totems[0].twisting.detected).toBe(true);
        expect(result.players[0]).toEqual(expect.objectContaining({ name: "Dorn", fights: 1, twistingFights: 1 }));
    });

    it("passes the shaman's death from the timeline into the judgement", async () => {
        const timeline = { fights: [{ id: 3, deaths: [{ at: 30000, name: "Dorn", type: "Shaman" }], totems: null }] };
        await analyzeTotems(wcl(), "abc", fights, players, timeline);
        expect(timeline.fights[0].totems[0].diedAt).toBe(30000);
    });

    it("leaves a shaman out of a fight whose calls failed and keeps the others", async () => {
        const two = [...players, { id: 9, name: "Kel", type: "Shaman" }];
        const client = wcl({ getAllEvents: jest.fn(async (_r, _v, _s, _e, extra) => { if (extra.sourceid === 7) throw new Error("boom"); return twistingCasts(); }) });
        const timeline = { fights: [{ id: 3, deaths: [], totems: null }] };
        await analyzeTotems(client, "abc", fights, two, timeline);
        expect(timeline.fights[0].totems.map((s) => s.name)).toEqual(["Kel"]);
    });

    it("is null without shamans or without a timeline", async () => {
        expect(await analyzeTotems(wcl(), "abc", fights, [{ id: 8, name: "Aldra", type: "Mage" }], { fights: [{ id: 3 }] })).toBeNull();
        expect(await analyzeTotems(wcl(), "abc", fights, players, null)).toBeNull();
        expect(await analyzeTotems(wcl(), "abc", fights, players, { fights: [] })).toBeNull();
    });
});
