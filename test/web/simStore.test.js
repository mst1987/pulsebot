// The engine and the gear source are mocked: what is under test is the caching
// (which loadout counts as "the same run") and the job bookkeeping, not the
// simulator itself.
const mockSimulate = jest.fn();
const mockIsAvailable = jest.fn(() => true);
const mockGearByCharacter = jest.fn(() => new Map());

jest.mock("../../src/utils/wowsims/engine", () => {
    const actual = jest.requireActual("../../src/utils/wowsims/engine");
    return {
        ...actual,
        isAvailable: (...a) => mockIsAvailable(...a),
        simulate: (...a) => mockSimulate(...a),
    };
});
jest.mock("../../src/web/charGear", () => ({ gearByCharacter: (...a) => mockGearByCharacter(...a) }));
// Never touch the real cache file.
jest.mock("fs", () => {
    const actual = jest.requireActual("fs");
    return { ...actual, readFileSync: jest.fn(actual.readFileSync), writeFileSync: jest.fn(), mkdirSync: jest.fn() };
});

const fs = require("fs");
const simStore = require("../../src/web/simStore");
const wowsims = require("../../src/config/wowsims");

// A real head piece other than the one the fixture wears, taken from the T5 BiS
// list so it resolves through the generated item table like any real candidate.
const OTHER_HEAD = wowsims.bisFor("Priest-Shadow", "t5").items
    .find((e) => wowsims.slotsFor(e.id).includes(0) && e.id !== 31064).id;

const gear = (items) => ({
    key: "devihra", character: "Devihra", className: "Priest", seenAt: 1, reportId: "r", reportTitle: "", items,
});
const item = (slot, itemId) => ({ slot, itemId, itemLevel: 140, gems: [], enchantId: 0 });

/** Wait until a started job has finished (or the attempts run out). */
async function settle(id, attempts = 50) {
    for (let i = 0; i < attempts; i += 1) {
        const job = simStore.getJob(id);
        if (job && job.status !== "running") return job;
        await new Promise((r) => setImmediate(r));
    }
    return simStore.getJob(id);
}

beforeEach(() => {
    jest.clearAllMocks();
    simStore.reset();
    // No cache file on disk.
    fs.readFileSync.mockImplementation(() => { throw new Error("ENOENT"); });
    mockIsAvailable.mockReturnValue(true);
    mockSimulate.mockResolvedValue({ dps: 1800, stdev: 20, available: true, supported: true, error: "", warnings: [] });
});

describe("web/simStore", () => {
    describe("cacheKey", () => {
        const base = { specKey: "Priest-Shadow", gear: gear([item(0, 31064)]) };

        it("is the same for the same loadout", () => {
            expect(simStore.cacheKey(base)).toBe(simStore.cacheKey({ ...base }));
        });

        it("changes when a gem changes", () => {
            const swapped = { ...base, gear: gear([{ ...item(0, 31064), gems: [32196] }]) };
            expect(simStore.cacheKey(swapped)).not.toBe(simStore.cacheKey(base));
        });

        it("changes when an enchant changes", () => {
            const swapped = { ...base, gear: gear([{ ...item(0, 31064), enchantId: 3002 }]) };
            expect(simStore.cacheKey(swapped)).not.toBe(simStore.cacheKey(base));
        });

        it("changes with the spec, since the same gear sims differently", () => {
            expect(simStore.cacheKey({ ...base, specKey: "Mage-Arcane" })).not.toBe(simStore.cacheKey(base));
        });

        it("changes when an item is swapped in", () => {
            const withSwap = { ...base, swap: { slot: 0, itemId: 32478 } };
            expect(simStore.cacheKey(withSwap)).not.toBe(simStore.cacheKey(base));
        });
    });

    describe("simulateCached", () => {
        it("runs the sim once and answers the second call from the cache", async () => {
            const args = { specKey: "Priest-Shadow", gear: gear([item(0, 31064)]) };
            const first = await simStore.simulateCached(args);
            expect(first).toMatchObject({ dps: 1800, cached: false });
            const second = await simStore.simulateCached(args);
            expect(second).toMatchObject({ dps: 1800, cached: true });
            expect(mockSimulate).toHaveBeenCalledTimes(1);
        });

        it("does not cache a failed run, so fixing the cause fixes the page", async () => {
            mockSimulate.mockResolvedValue({ dps: null, available: false, supported: true, error: "kein Binary", warnings: [] });
            const args = { specKey: "Priest-Shadow", gear: gear([item(0, 31064)]) };
            await simStore.simulateCached(args);
            await simStore.simulateCached(args);
            expect(mockSimulate).toHaveBeenCalledTimes(2);
        });

        it("refuses an unknown spec rather than simulating nonsense", async () => {
            const res = await simStore.simulateCached({ specKey: "Warrior-Fury", gear: gear([]) });
            expect(res).toMatchObject({ supported: false, dps: null });
            expect(mockSimulate).not.toHaveBeenCalled();
        });
    });

    describe("startCouncilSim", () => {
        const subjects = [{ key: "devihra", specKey: "Priest-Shadow" }];

        beforeEach(() => {
            mockGearByCharacter.mockReturnValue(new Map([["devihra", gear([item(0, 31064)])]]));
        });

        it("simulates a baseline per raider", async () => {
            simStore.startCouncilSim("job1", subjects, []);
            const job = await settle("job1");
            expect(job.status).toBe("done");
            expect(job.result.devihra).toMatchObject({ baseline: 1800, hasGear: true });
        });

        it("takes the gear of the role the raider is judged as", async () => {
            // Simulating a caster's healing set gives an honestly measured and
            // completely meaningless number. Each subject says which spec it is,
            // so the role follows from that without a second lookup.
            simStore.startCouncilSim("job1b", [
                { key: "devihra", specKey: "Priest-Shadow" },
                { key: "heala", specKey: "Shaman-Restoration" },
            ], []);
            await settle("job1b");
            const { roleFor } = mockGearByCharacter.mock.calls[0][0];
            expect(roleFor("devihra")).toBe("caster");
            expect(roleFor("heala")).toBe("healer");
            expect(roleFor("wer?")).toBe("");
        });

        it("reports each item as a delta against that one baseline", async () => {
            mockSimulate
                .mockResolvedValueOnce({ dps: 1800, available: true, supported: true, error: "", warnings: [] })
                .mockResolvedValueOnce({ dps: 1950, available: true, supported: true, error: "", warnings: [] });
            // A different head piece, so the swapped loadout really differs from
            // the baseline (see the next test for why that matters).
            simStore.startCouncilSim("job2", subjects, [OTHER_HEAD]);
            const job = await settle("job2");
            expect(job.result.devihra.items[OTHER_HEAD]).toMatchObject({ dps: 1950, delta: 150 });
        });

        it("carries the run's own error when a swap comes back without a number — never the same as 'not attempted'", async () => {
            // The baseline succeeds but the swap itself fails (an unknown gem,
            // say): the page must be able to tell this apart from an item that
            // was never simulated at all, which leaves no entry whatsoever.
            mockSimulate
                .mockResolvedValueOnce({ dps: 1800, available: true, supported: true, error: "", warnings: [] })
                .mockResolvedValueOnce({ dps: null, available: true, supported: true, error: "unbekanntes Gem", warnings: [] });
            simStore.startCouncilSim("job2c", subjects, [OTHER_HEAD]);
            const job = await settle("job2c");
            expect(job.result.devihra.items[OTHER_HEAD]).toMatchObject({ dps: null, delta: null, error: "unbekanntes Gem" });
        });

        it("leaves a successful swap without an error", async () => {
            mockSimulate
                .mockResolvedValueOnce({ dps: 1800, available: true, supported: true, error: "", warnings: [] })
                .mockResolvedValueOnce({ dps: 1950, available: true, supported: true, error: "", warnings: [] });
            simStore.startCouncilSim("job2d", subjects, [OTHER_HEAD]);
            const job = await settle("job2d");
            expect(job.result.devihra.items[OTHER_HEAD].error).toBe("");
        });

        it("answers 'the item you already wear' from the cache, as a zero delta", async () => {
            // The swapped loadout is byte-identical to the baseline, so the
            // cache key matches and no second sim runs — which is also the only
            // honest answer: an item you already have adds nothing.
            simStore.startCouncilSim("job2b", subjects, [31064]);
            const job = await settle("job2b");
            expect(job.result.devihra.items[31064]).toMatchObject({ delta: 0, cached: true });
            expect(mockSimulate).toHaveBeenCalledTimes(1);
        });

        it("skips an item that fits no slot instead of inventing a number", async () => {
            simStore.startCouncilSim("job3", subjects, [999999]);
            const job = await settle("job3");
            expect(job.result.devihra.items[999999]).toBeUndefined();
        });

        it("skips an item the class cannot equip — a number for it would be a wrong answer", async () => {
            // Hood of the Corruptor is warlock tier; a priest cannot put it on,
            // however well it would sim.
            simStore.startCouncilSim("job3b", subjects, [30212]);
            const job = await settle("job3b");
            expect(job.result.devihra.items[30212]).toBeUndefined();
            // Only the baseline ran.
            expect(mockSimulate).toHaveBeenCalledTimes(1);
            // ...and the progress still reaches the total.
            expect(job.progress).toBe(job.total);
        });

        it("says 'no gear' rather than simulating a naked raider", async () => {
            mockGearByCharacter.mockReturnValue(new Map());
            simStore.startCouncilSim("job4", subjects, [31064]);
            const job = await settle("job4");
            expect(job.result.devihra).toMatchObject({ hasGear: false, baseline: null });
            expect(mockSimulate).not.toHaveBeenCalled();
        });

        it("counts progress towards a total the caller can show", async () => {
            simStore.startCouncilSim("job5", subjects, [31064]);
            const job = await settle("job5");
            expect(job.total).toBe(2);
            expect(job.progress).toBe(2);
        });

        it("does not start a second run while one is going", () => {
            simStore.startCouncilSim("job6", subjects, []);
            expect(simStore.startCouncilSim("job6", subjects, [])).toMatchObject({ alreadyRunning: true });
        });

        it("turns a thrown error into a failed job, not a crash", async () => {
            mockGearByCharacter.mockImplementation(() => { throw new Error("kaputt"); });
            simStore.startCouncilSim("job7", subjects, []);
            const job = await settle("job7");
            expect(job.status).toBe("error");
            expect(job.error).toBe("kaputt");
        });
    });

    it("returns null for a job nobody started", () => {
        expect(simStore.getJob("nope")).toBeNull();
    });
});

describe("web/simStore — the drop is simulated as it would be worn", () => {
    const subjects = [{ key: "devihra", specKey: "Priest-Shadow" }];

    it("gives a swapped-in item the BiS list's gems and enchant instead of the replaced piece's", async () => {
        // The worn hood is bare; the drop must not inherit that emptiness.
        mockGearByCharacter.mockReturnValue(new Map([["devihra", gear([item(0, 31064)])]]));
        simStore.startCouncilSim("fit1", subjects, [32525]);
        const job = await settle("fit1");
        expect(job.result.devihra.items[32525]).toMatchObject({ fitting: "bis-slot" });
        const swapped = mockSimulate.mock.calls.find((c) => c[0].swap);
        expect(swapped[0].swap).toMatchObject({ slot: 0, itemId: 32525, enchantId: 3002 });
        expect(swapped[0].swap.gems).toHaveLength(2);
        expect(swapped[0].swap.gems[0]).toBe(25893);
    });

    it("still answers the item the raider already wears from the cache", async () => {
        mockGearByCharacter.mockReturnValue(new Map([["devihra", gear([item(0, 31064)])]]));
        simStore.startCouncilSim("fit2", subjects, [31064]);
        const job = await settle("fit2");
        expect(job.result.devihra.items[31064]).toMatchObject({ delta: 0, cached: true, fitting: "worn" });
        expect(mockSimulate).toHaveBeenCalledTimes(1);
    });
});
