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
const { getSetupLoot, saveSetupLoot } = require("../../../src/stores/loot/setupLootStore");
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
        expect(setupLoot.lootInputFor([events.a, events.b])).toEqual({ versionId: "tbc", wants: { u1: {} }, items: { 1: { name: "X" } } });
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
        // the armory is asked only for the BiS character, one after another
        expect(armoryGear.primeArmoryGear).toHaveBeenCalledTimes(1);
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

    it("gives Forever Softres and the spec only - no BiS, no armory, no item names", async () => {
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
        expect(armoryGear.primeArmoryGear).not.toHaveBeenCalled();
        expect(charGear.gearByCharacter).not.toHaveBeenCalled();
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
        expect(await setupLoot.loadLootData(["a", "b"])).toEqual({ ok: false, error: expect.any(String) });
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
