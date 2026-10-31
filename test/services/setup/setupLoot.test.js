jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/stores/events/eventStore", () => ({ getEvent: jest.fn() }));
jest.mock("../../../src/stores/events/signupStore", () => ({ listSignups: jest.fn() }));
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/stores/events/eventSoftresStore", () => ({ getEventSoftres: jest.fn() }));
jest.mock("../../../src/services/loot/armoryGear", () => ({ primeArmoryGear: jest.fn() }));
jest.mock("../../../src/services/loot/charGear", () => ({ gearByCharacter: jest.fn() }));
jest.mock("../../../src/services/loot/softresStatus", () => ({
    ...jest.requireActual("../../../src/services/loot/softresStatus"),
    fetchRaidCached: jest.fn(),
}));

const fs = require("fs");
const eventStore = require("../../../src/stores/events/eventStore");
const signupStore = require("../../../src/stores/events/signupStore");
const { getEventSoftres } = require("../../../src/stores/events/eventSoftresStore");
const armoryGear = require("../../../src/services/loot/armoryGear");
const charGear = require("../../../src/services/loot/charGear");
const softresStatus = require("../../../src/services/loot/softresStatus");
const { getSetupLoot, saveSetupLoot, MAX_AGE_MS } = require("../../../src/stores/loot/setupLootStore");
const setupLoot = require("../../../src/services/setup/setupLoot");

// Real TBC data: Fury warrior BiS for t4 that drops in Karazhan (28741, Skulker's Greaves
// is a Kara drop in the bundled table) and in Gruul (28795).
const KARA_ITEM = 28741;
const GRUUL_ITEM = 28795;

const raid = (id, extra = {}) => ({ id, guildId: "g1", versionId: "tbc", instanceIds: ["kara"], raidGroupId: "a", ...extra });
const events = { a: raid("a"), b: raid("b", { raidGroupIndex: 2 }) };

beforeEach(() => {
    fs.__store.clear();
    jest.clearAllMocks();
    eventStore.getEvent.mockImplementation((id) => events[id] || null);
    signupStore.listSignups.mockReturnValue([]);
    getEventSoftres.mockReturnValue(null);
    armoryGear.primeArmoryGear.mockResolvedValue({ asked: 1, answered: 1, configured: true });
    charGear.gearByCharacter.mockReturnValue(new Map());
});

describe("services/setup/setupLoot lootInputFor (#1037)", () => {
    const stored = () => saveSetupLoot("a", { versionId: "tbc", instanceIds: ["kara"], wants: { u1: {} }, items: { 1: { name: "X" } } });

    it("returns the stored snapshot for two raids of the same version and instances", () => {
        stored();
        expect(setupLoot.lootInputFor([events.a, events.b])).toEqual({ versionId: "tbc", wants: { u1: {} }, items: { 1: { name: "X" } }, gear: {} });
    });

    it("is null for a single raid or when nothing was loaded", () => {
        expect(setupLoot.lootInputFor([events.a, events.b])).toBeNull();
        stored();
        expect(setupLoot.lootInputFor([events.a])).toBeNull();
        expect(setupLoot.lootInputFor([])).toBeNull();
    });

    it("is null for another version (never reads TBC data for Forever)", () => {
        stored();
        const forever = [raid("a", { versionId: "forever" }), raid("b", { versionId: "forever" })];
        expect(setupLoot.lootInputFor(forever)).toBeNull();
    });

    it("is null when the raids now go into another instance", () => {
        stored();
        expect(setupLoot.lootInputFor([raid("a", { instanceIds: ["gruul"] }), events.b])).toBeNull();
    });
});

describe("services/setup/setupLoot loadLootData (#1037)", () => {
    it("refuses a single raid and unknown events without calling anything", async () => {
        expect((await setupLoot.loadLootData(["a"])).ok).toBe(false);
        expect((await setupLoot.loadLootData(["a", "missing"])).ok).toBe(false);
        expect((await setupLoot.loadLootData([])).ok).toBe(false);
        expect(signupStore.listSignups).not.toHaveBeenCalled();
        expect(armoryGear.primeArmoryGear).not.toHaveBeenCalled();
    });

    it("takes Softres first, then BiS minus worn gear, then the spec, and stores it", async () => {
        signupStore.listSignups.mockReturnValue([
            { userId: "u1", character: "Softy", spec: "Warrior-Fury" },
            { userId: "u2", character: "Bissy", spec: "Warrior-Fury" },
            { userId: "u3", character: "Healy", spec: "Priest-Holy-Wotlk-Not-A-Spec" },
            { userId: "u4", character: "Gone", spec: "Warrior-Fury", status: "absence" },
        ]);
        getEventSoftres.mockImplementation((id) => (id === "a" ? { raidId: "sr1", token: "" } : null));
        softresStatus.fetchRaidCached.mockResolvedValue({ reserves: [{ name: "Softy", items: [{ id: 30000 }, 30001] }] });
        charGear.gearByCharacter.mockReturnValue(new Map([["bissy", { items: [{ itemId: KARA_ITEM }] }]]));

        const out = await setupLoot.loadLootData(["a", "b"]);
        expect(out.ok).toBe(true);
        const snap = getSetupLoot("a");
        expect(snap.versionId).toBe("tbc");
        expect(snap.instanceIds).toEqual(["kara"]);
        expect(snap.wants.u1.softy).toEqual({ items: [{ itemId: 30000, weight: 1 }, { itemId: 30001, weight: 1 }], source: "softres" });
        const bis = snap.wants.u2.bissy;
        expect(bis.source).toBe("bis");
        expect(bis.items.map((i) => i.itemId)).not.toContain(KARA_ITEM);
        expect(bis.items.map((i) => i.itemId)).not.toContain(GRUUL_ITEM);
        expect(bis.items.every((i) => i.weight === 0.5)).toBe(true);
        expect(snap.wants.u3.healy.source).toBe("spec");
        expect(snap.wants.u4).toBeUndefined();
        expect(snap.counts).toEqual({ signups: 3, gear: 1, softres: 1, bis: 1, spec: 1 });
        // the armory asks one after another, the BiS character first, then the rest for the strength (#1038)
        expect(armoryGear.primeArmoryGear.mock.calls.map((c) => c[0][0])).toEqual(["Bissy", "Softy", "Healy"]);
        expect(armoryGear.primeArmoryGear).toHaveBeenCalledWith(["Bissy"], { full: true, versionId: "tbc", guildId: "g1" });
        expect(snap.items[bis.items[0].itemId]).toEqual(expect.objectContaining({ name: expect.any(String), quality: expect.any(Number) }));
        expect(setupLoot.progressOf("a")).toBeNull();
    });

    it("skips hidden reserves and a failing list", async () => {
        signupStore.listSignups.mockReturnValue([{ userId: "u1", character: "Softy", spec: "Warrior-Fury" }]);
        getEventSoftres.mockImplementation((id) => ({ raidId: `sr-${id}`, token: "" }));
        softresStatus.fetchRaidCached.mockImplementation((id) => (id === "sr-a"
            ? Promise.resolve({ hideReserves: true, isManager: false, reserves: [{ name: "Softy", items: [1] }] })
            : Promise.reject(new Error("down"))));
        await setupLoot.loadLootData(["a", "b"]);
        // no reserve counts, and without known gear BiS stays out: the spec is left
        expect(getSetupLoot("a").wants.u1.softy.source).toBe("spec");
    });

    it("gives Forever Softres and the spec only - no BiS, no item names; the armory of its own version", async () => {
        events.f1 = raid("f1", { versionId: "forever", raidGroupId: "f1" });
        events.f2 = raid("f2", { versionId: "forever", raidGroupId: "f1", raidGroupIndex: 2 });
        signupStore.listSignups.mockReturnValue([
            { userId: "u1", character: "Softy", spec: "Warrior-Fury" },
            { userId: "u2", character: "Other", spec: "Warrior-Fury" },
        ]);
        getEventSoftres.mockImplementation((id) => (id === "f1" ? { raidId: "sr", token: "" } : null));
        softresStatus.fetchRaidCached.mockResolvedValue({ reserves: [{ name: "Softy", items: [KARA_ITEM] }] });
        await setupLoot.loadLootData(["f1", "f2"]);
        const snap = getSetupLoot("f1");
        expect(snap.versionId).toBe("forever");
        expect(snap.wants.u1.softy.source).toBe("softres");
        expect(snap.wants.u2.other.source).toBe("spec");
        expect(snap.items[KARA_ITEM]).toEqual({ name: "", icon: "", quality: null });
        // armory and gear are read for the strength (#1038) - of the raid's own version only, never TBC's
        expect(armoryGear.primeArmoryGear).toHaveBeenCalledTimes(2);
        for (const call of armoryGear.primeArmoryGear.mock.calls) expect(call[1]).toEqual({ full: true, versionId: "forever", guildId: "g1" });
        expect(charGear.gearByCharacter).toHaveBeenCalledTimes(1);
        expect(charGear.gearByCharacter).toHaveBeenCalledWith({ versionId: "forever", guildId: "g1" });
        delete events.f1; delete events.f2;
    });

    it("stops asking the armory when the version has none and caps the run", async () => {
        const many = Array.from({ length: setupLoot.MAX_ARMORY + 5 }, (_, i) => ({ userId: `u${i}`, character: `Char${i}`, spec: "Warrior-Fury" }));
        signupStore.listSignups.mockReturnValue(many);
        await setupLoot.loadLootData(["a", "b"]);
        expect(armoryGear.primeArmoryGear).toHaveBeenCalledTimes(setupLoot.MAX_ARMORY);
        armoryGear.primeArmoryGear.mockClear();
        armoryGear.primeArmoryGear.mockResolvedValue({ asked: 0, answered: 0, configured: false });
        await setupLoot.loadLootData(["a", "b"]);
        expect(armoryGear.primeArmoryGear).toHaveBeenCalledTimes(1);
    });

    it("reports a failure instead of throwing", async () => {
        signupStore.listSignups.mockImplementation(() => { throw new Error("broken"); });
        // a code, not a sentence: the editor words it in de/en (setup.loot.failedAll)
        expect(await setupLoot.loadLootData(["a", "b"])).toEqual({ ok: false, error: "failed_all", failed: ["all"], hadPrevious: false });
    });

    it("carries the oldest kept data through a second partial load (keptAt stays the first load's)", async () => {
        const now = jest.spyOn(Date, "now");
        try {
            signupStore.listSignups.mockReturnValue([
                { userId: "u1", character: "Softy", spec: "Warrior-Fury" },
                { userId: "u2", character: "Other", spec: "Priest-Holy-Wotlk-Not-A-Spec" },
            ]);
            getEventSoftres.mockImplementation((id) => (id === "a" ? { raidId: "sr1", token: "" } : null));
            softresStatus.fetchRaidCached.mockResolvedValue({ reserves: [{ name: "Softy", items: [30000] }] });
            now.mockReturnValue(1_000_000);
            await setupLoot.loadLootData(["a", "b"]);
            softresStatus.fetchRaidCached.mockRejectedValue(new Error("down"));
            now.mockReturnValue(2_000_000);
            await setupLoot.loadLootData(["a", "b"]);
            expect(getSetupLoot("a", { now: 2_000_000 }).keptAt).toBe(1_000_000);
            now.mockReturnValue(3_000_000);
            await setupLoot.loadLootData(["a", "b"]);
            const snap = getSetupLoot("a", { now: 3_000_000 });
            expect(snap.at).toBe(3_000_000);
            expect(snap.keptAt).toBe(1_000_000);
        } finally {
            now.mockRestore();
        }
    });

    it("keeps the old Softres entry of a raider when softres.it is down, takes the rest fresh (partial)", async () => {
        signupStore.listSignups.mockReturnValue([
            { userId: "u1", character: "Softy", spec: "Warrior-Fury" },
            { userId: "u2", character: "Other", spec: "Priest-Holy-Wotlk-Not-A-Spec" },
        ]);
        getEventSoftres.mockImplementation((id) => (id === "a" ? { raidId: "sr1", token: "" } : null));
        softresStatus.fetchRaidCached.mockResolvedValue({ reserves: [{ name: "Softy", items: [30000] }] });
        await setupLoot.loadLootData(["a", "b"]);
        const first = getSetupLoot("a");
        expect(first.wants.u1.softy.source).toBe("softres");

        softresStatus.fetchRaidCached.mockRejectedValue(new Error("down"));
        signupStore.listSignups.mockReturnValue([
            { userId: "u1", character: "Softy", spec: "Warrior-Fury" },
            { userId: "u2", character: "Other", spec: "Priest-Holy-Wotlk-Not-A-Spec" },
            { userId: "u3", character: "Newbie", spec: "Priest-Holy-Wotlk-Not-A-Spec" },
        ]);
        const out = await setupLoot.loadLootData(["a", "b"]);
        expect(out).toEqual(expect.objectContaining({ ok: true, failed: ["softres"], partial: true }));
        const snap = getSetupLoot("a");
        expect(snap.wants.u1.softy).toEqual(first.wants.u1.softy);
        expect(snap.wants.u3.newbie.source).toBe("spec");
        expect(snap.failed).toEqual(["softres"]);
        expect(snap.keptAt).toBe(first.at);
    });

    it("replaces nothing when every source it asked failed (total), only marks the snapshot", async () => {
        // a spec without a BiS list: softres.it is the only source this run asks
        signupStore.listSignups.mockReturnValue([{ userId: "u1", character: "Softy", spec: "Priest-Holy-Wotlk-Not-A-Spec" }]);
        getEventSoftres.mockImplementation((id) => (id === "a" ? { raidId: "sr1", token: "" } : null));
        softresStatus.fetchRaidCached.mockResolvedValue({ reserves: [{ name: "Softy", items: [30000] }] });
        await setupLoot.loadLootData(["a", "b"]);
        const first = getSetupLoot("a");

        softresStatus.fetchRaidCached.mockRejectedValue(new Error("down"));
        const out = await setupLoot.loadLootData(["a", "b"]);
        expect(out).toEqual({ ok: false, error: "failed_all", failed: ["softres"], hadPrevious: true });
        const snap = getSetupLoot("a");
        expect(snap.wants).toEqual(first.wants);
        expect(snap.at).toBe(first.at);
        expect(snap.failed).toEqual(["softres"]);
        expect(snap.keptAt).toBe(first.at);
    });
});

describe("services/setup/setupLoot strength gear (#1038)", () => {
    const worn = (n, lvl) => ({ items: Array.from({ length: n }, (_, i) => ({ itemId: 100 + i, itemLevel: lvl })) });

    it("stores the mean item level per character from MIN_ITEMS worn items on, and lootInputFor hands it on", async () => {
        signupStore.listSignups.mockReturnValue([
            { userId: "u1", character: "Strong", spec: "Priest-Holy-Wotlk-Not-A-Spec" },
            { userId: "u2", character: "Few", spec: "Priest-Holy-Wotlk-Not-A-Spec" },
        ]);
        charGear.gearByCharacter.mockReturnValue(new Map([["strong", worn(6, 120)], ["few", worn(setupLoot._internal.MIN_ITEMS - 1, 200)]]));
        const out = await setupLoot.loadLootData(["a", "b"]);
        expect(out.ok).toBe(true);
        expect(getSetupLoot("a").gear).toEqual({ u1: { strong: 120 } });
        expect(setupLoot.lootInputFor([events.a, events.b]).gear).toEqual({ u1: { strong: 120 } });
    });

    it("a failed gear read without a BiS list is no failed loot source and keeps the last levels", async () => {
        signupStore.listSignups.mockReturnValue([{ userId: "u1", character: "Strong", spec: "Priest-Holy-Wotlk-Not-A-Spec" }]);
        charGear.gearByCharacter.mockReturnValue(new Map([["strong", worn(8, 115)]]));
        await setupLoot.loadLootData(["a", "b"]);
        charGear.gearByCharacter.mockImplementation(() => { throw new Error("walk broke"); });
        const out = await setupLoot.loadLootData(["a", "b"]);
        expect(out).toEqual(expect.objectContaining({ ok: true, failed: [], partial: false }));
        expect(getSetupLoot("a").gear).toEqual({ u1: { strong: 115 } });
    });

    it("asks the armory for every character of the group, without a BiS list too, and a failure there is no loot failure", async () => {
        signupStore.listSignups.mockReturnValue([
            { userId: "u1", character: "Strong", spec: "Priest-Holy-Wotlk-Not-A-Spec" },
            { userId: "u2", character: "Other", spec: "Priest-Holy-Wotlk-Not-A-Spec", characters: [{ character: "Other", spec: "x" }, { character: "OTHER", spec: "y" }, { character: "Alt", spec: "y" }] },
        ]);
        await setupLoot.loadLootData(["a", "b"]);
        expect(armoryGear.primeArmoryGear.mock.calls.map((c) => c[0][0])).toEqual(["Strong", "Other", "Alt"]);
        armoryGear.primeArmoryGear.mockRejectedValue(new Error("armory down"));
        const out = await setupLoot.loadLootData(["a", "b"]);
        expect(out).toEqual(expect.objectContaining({ ok: true, failed: [] }));
    });

    it("keeps the last level per character where this load read none, as long as the raider is signed up", async () => {
        signupStore.listSignups.mockReturnValue([
            { userId: "u1", character: "Strong", spec: "Priest-Holy-Wotlk-Not-A-Spec" },
            { userId: "u2", character: "Other", spec: "Priest-Holy-Wotlk-Not-A-Spec" },
            { userId: "u3", character: "Leaver", spec: "Priest-Holy-Wotlk-Not-A-Spec" },
        ]);
        charGear.gearByCharacter.mockReturnValue(new Map([["strong", worn(8, 115)], ["other", worn(8, 110)], ["leaver", worn(8, 100)]]));
        await setupLoot.loadLootData(["a", "b"]);
        const first = getSetupLoot("a");
        expect(first.keptAt).toBe(0);
        // second load: only Strong is read again (better now), Leaver signed off
        signupStore.listSignups.mockReturnValue([
            { userId: "u1", character: "Strong", spec: "Priest-Holy-Wotlk-Not-A-Spec" },
            { userId: "u2", character: "Other", spec: "Priest-Holy-Wotlk-Not-A-Spec" },
        ]);
        charGear.gearByCharacter.mockReturnValue(new Map([["strong", worn(8, 125)]]));
        await setupLoot.loadLootData(["a", "b"]);
        const snap = getSetupLoot("a");
        expect(snap.gear).toEqual({ u1: { strong: 125 }, u2: { other: 110 } });
        // the kept level is as old as its load: the snapshot expires 30 days after it
        expect(snap.keptAt).toBe(first.at);
    });

    it("a kept level expires with the 30-day rule like the wants", async () => {
        const now = jest.spyOn(Date, "now");
        try {
            signupStore.listSignups.mockReturnValue([{ userId: "u1", character: "Strong", spec: "Priest-Holy-Wotlk-Not-A-Spec" }]);
            charGear.gearByCharacter.mockReturnValue(new Map([["strong", worn(8, 115)]]));
            now.mockReturnValue(1_000_000);
            await setupLoot.loadLootData(["a", "b"]);
            // empty gear load after load: the level stays, always with the first load's time
            charGear.gearByCharacter.mockReturnValue(new Map());
            now.mockReturnValue(1_000_000 + MAX_AGE_MS / 2);
            await setupLoot.loadLootData(["a", "b"]);
            expect(getSetupLoot("a").gear).toEqual({ u1: { strong: 115 } });
            expect(getSetupLoot("a").keptAt).toBe(1_000_000);
            // past 30 days from the first load: the snapshot is gone, nothing is carried over
            now.mockReturnValue(1_000_000 + MAX_AGE_MS + 1);
            expect(getSetupLoot("a", { now: 1_000_000 + MAX_AGE_MS + 1 })).toBeNull();
            await setupLoot.loadLootData(["a", "b"]);
            expect(getSetupLoot("a", { now: 1_000_000 + MAX_AGE_MS + 1 }).gear).toEqual({});
        } finally {
            now.mockRestore();
        }
    });

    it("mergeLevels and armoryNames: fresh over old per character, BiS names first, capped", () => {
        const { mergeLevels, armoryNames } = setupLoot._internal;
        const raiders = [{ userId: "u1", chars: [{ character: "A" }, { character: "B" }] }];
        expect(mergeLevels(raiders, { u1: { a: 120 } }, { u1: { a: 100, b: 110 }, gone: { x: 1 } })).toEqual({ levels: { u1: { a: 120, b: 110 } }, kept: 1 });
        expect(mergeLevels(raiders, {}, null)).toEqual({ levels: {}, kept: 0 });
        expect(armoryNames(raiders, new Map([["u1|b", { name: "B" }]]))).toEqual(["B", "A"]);
        const many = [{ userId: "u", chars: Array.from({ length: setupLoot.MAX_ARMORY + 3 }, (_, i) => ({ character: `C${i}` })) }];
        expect(armoryNames(many, new Map())).toHaveLength(setupLoot.MAX_ARMORY);
    });

    it("meanItemLevels skips characters without levels", () => {
        const { meanItemLevels } = setupLoot._internal;
        const raiders = [{ userId: "u1", chars: [{ character: "A" }, { character: "B" }] }];
        const gear = new Map([["a", { items: [...worn(5, 100).items, { itemId: 9, itemLevel: 0 }] }], ["b", { items: [{ itemId: 1 }] }]]);
        expect(meanItemLevels(raiders, gear)).toEqual({ u1: { a: 100 } });
    });
});

describe("services/setup/setupLoot helpers", () => {
    const { bisInInstances, reserveItems, signupCharacters } = setupLoot._internal;

    it("keeps only BiS items that drop in the raids' instances", () => {
        const kara = bisInInstances("Warrior-Fury", "tbc", ["kara"]);
        expect(kara).toContain(KARA_ITEM);
        expect(kara).not.toContain(GRUUL_ITEM);
        expect(bisInInstances("Warrior-Fury", "tbc", ["gruul"])).toContain(GRUUL_ITEM);
        expect(bisInInstances("Warrior-Fury", "forever", ["kara"])).toEqual([]);
        expect(bisInInstances("Nope-Spec", "tbc", ["kara"])).toEqual([]);
    });

    it("reads reserve items as numbers or objects and every character of a signup", () => {
        expect(reserveItems({ items: [1, { id: 2 }, "x", { id: 0 }] })).toEqual([1, 2]);
        expect(reserveItems(null)).toEqual([]);
        expect(signupCharacters({ characters: [{ character: "A", spec: "S" }, { character: "B" }], character: "A" })).toEqual([{ character: "A", spec: "S" }]);
        expect(signupCharacters({ character: "C", spec: "T" })).toEqual([{ character: "C", spec: "T" }]);
        expect(signupCharacters({})).toEqual([]);
    });
});
