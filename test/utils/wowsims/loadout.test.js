const { equipmentFor, playerFor, targetSlotFor, SLOT_ORDER } = require("../../../src/utils/wowsims/loadout");
const { specByKey, aplForSpec } = require("../../../src/config/casterSpecs");
const { presetFor } = require("../../../src/utils/wowsims/presets");

// A small snapshot in the shape web/charGear.js produces. Item ids are real
// (Hood of Absolution 31064, Vestments of Absolution 31065) so slot resolution
// runs against the actual generated table rather than a stub.
const gear = {
    character: "Devihra",
    className: "Priest",
    items: [
        { slot: 0, itemId: 31064, itemLevel: 146, gems: [25893, 30600], enchantId: 3002 },
        { slot: 4, itemId: 31065, itemLevel: 146, gems: [32196, 32196, 32196], enchantId: 2661 },
        // A ring in each of the two finger slots, the weaker one first.
        { slot: 10, itemId: 29352, itemLevel: 120, gems: [], enchantId: 0 },
        { slot: 11, itemId: 32527, itemLevel: 151, gems: [], enchantId: 0 },
    ],
};

describe("utils/wowsims/loadout", () => {
    describe("equipmentFor", () => {
        it("emits items in WoWSims' fixed slot order", () => {
            const { items } = equipmentFor(gear);
            expect(items.map((i) => i.id)).toEqual([31064, 31065, 29352, 32527]);
            // Head before chest before the rings, exactly as SLOT_ORDER says.
            expect(SLOT_ORDER.indexOf(0)).toBeLessThan(SLOT_ORDER.indexOf(4));
        });

        it("carries enchant and gems through unchanged", () => {
            const head = equipmentFor(gear).items[0];
            expect(head).toEqual({ id: 31064, enchant: 3002, gems: [25893, 30600] });
        });

        it("omits an absent enchant instead of sending a zero", () => {
            const ring = equipmentFor(gear).items[2];
            expect(ring).toEqual({ id: 29352 });
            expect(ring.enchant).toBeUndefined();
            expect(ring.gems).toBeUndefined();
        });

        it("drops trailing empty sockets but keeps the ones in between", () => {
            const g = { items: [{ slot: 0, itemId: 31064, gems: [32196, 0, 32196, 0, 0], enchantId: 0 }] };
            expect(equipmentFor(g).items[0].gems).toEqual([32196, 0, 32196]);
        });

        it("warns rather than throws on a raider with no gear", () => {
            const { items, warnings } = equipmentFor({ items: [] });
            expect(items).toEqual([]);
            expect(warnings.join(" ")).toMatch(/Kein Gear/);
            expect(equipmentFor(null).items).toEqual([]);
        });

        describe("swapping an item in", () => {
            it("replaces what sits in that slot", () => {
                const { items } = equipmentFor(gear, { slot: 0, itemId: 32478 });
                expect(items[0].id).toBe(32478);
                expect(items).toHaveLength(4);
            });

            it("inherits the enchant and gems of the piece it replaces", () => {
                // A raider would enchant and socket a new item too; comparing a
                // bare drop against a fully kitted one would understate it.
                const { items } = equipmentFor(gear, { slot: 0, itemId: 32478 });
                expect(items[0]).toMatchObject({ enchant: 3002, gems: [25893, 30600] });
            });

            it("lets the caller state its own enchant and gems", () => {
                const { items } = equipmentFor(gear, { slot: 0, itemId: 32478, enchantId: 0, gems: [] });
                expect(items[0]).toEqual({ id: 32478 });
            });

            it("fills an empty slot without touching the rest", () => {
                const { items } = equipmentFor(gear, { slot: 1, itemId: 30666 });
                expect(items.map((i) => i.id)).toEqual([31064, 30666, 31065, 29352, 32527]);
            });
        });
    });

    describe("targetSlotFor", () => {
        it("picks the slot an item belongs in", () => {
            expect(targetSlotFor(gear, 31064)).toMatchObject({ slot: 0 });
        });

        it("targets the weaker of two rings, because that is what an upgrade pushes out", () => {
            const target = targetSlotFor(gear, 29352);
            expect(target.slot).toBe(10);
            expect(target.replaces.itemLevel).toBe(120);
        });

        it("prefers an empty slot over any filled one", () => {
            const oneRing = { items: [{ slot: 11, itemId: 32527, itemLevel: 151, gems: [], enchantId: 0 }] };
            expect(targetSlotFor(oneRing, 29352)).toMatchObject({ slot: 10, replaces: null });
        });

        it("returns null for an item that fits no slot", () => {
            expect(targetSlotFor(gear, 999999)).toBeNull();
        });
    });

    describe("playerFor", () => {
        const spec = specByKey("Priest-Shadow");
        const built = () => playerFor({
            gear, specEntry: spec, preset: presetFor(spec), apl: aplForSpec(spec),
        });

        it("builds a player WoWSims can read", () => {
            const { player } = built();
            expect(player.class).toBe("ClassPriest");
            expect(player.talentsString).toBe(spec.talents);
            expect(player.equipment.items).toHaveLength(4);
            expect(player[spec.specField]).toEqual({ options: presetFor(spec).options });
            expect(player.rotation).toBeTruthy();
        });

        it("holds the race constant, so it cancels out of every comparison", () => {
            const a = playerFor({ gear, specEntry: spec, preset: presetFor(spec), apl: aplForSpec(spec) });
            const b = playerFor({
                gear: { ...gear, character: "Jemand anders" },
                specEntry: spec, preset: presetFor(spec), apl: aplForSpec(spec),
            });
            expect(a.player.race).toBe(b.player.race);
        });
    });
});

describe("utils/wowsims/loadout — every slot in play, not just the losing one", () => {
    // Zhar'doom is a two-hand staff, Tempest of Chaos a main-hand dagger.
    const STAFF = 32374;
    const DAGGER = 30910;

    const armed = {
        character: "Devihra",
        className: "Priest",
        items: [
            { slot: 15, itemId: DAGGER, itemLevel: 141, gems: [], enchantId: 0, itemName: "Waffe" },
            { slot: 16, itemId: 29982, itemLevel: 128, gems: [], enchantId: 0, itemName: "Nebenhand" },
            { slot: 10, itemId: 29352, itemLevel: 120, gems: [], enchantId: 0, itemName: "Ring A" },
            { slot: 11, itemId: 32527, itemLevel: 151, gems: [], enchantId: 0, itemName: "Ring B" },
        ],
    };

    describe("a two-handed weapon", () => {
        it("takes both hands, so both pieces are displaced", () => {
            const target = targetSlotFor(armed, STAFF);
            expect(target.displaces.map((d) => d.itemName)).toEqual(["Waffe", "Nebenhand"]);
            expect(target.clears).toEqual([16]);
        });

        it("marks both hands as occupied, not one as a choice", () => {
            const target = targetSlotFor(armed, STAFF);
            expect(target.options.map((o) => o.slot)).toEqual([15, 16]);
            expect(target.options.every((o) => o.chosen)).toBe(true);
        });

        it("empties the off hand in the simulated loadout", () => {
            // Without this the sim keeps the off hand next to the staff and
            // reports DPS off gear the raider cannot wear.
            const { items } = equipmentFor(armed, { slot: 15, itemId: STAFF, clears: [16] });
            const ids = items.map((i) => i.id);
            expect(ids).toContain(STAFF);
            expect(ids).not.toContain(29982);
        });

        it("still works for a raider with empty hands", () => {
            const bare = { items: [{ slot: 0, itemId: 31064, itemLevel: 146, gems: [], enchantId: 0 }] };
            const target = targetSlotFor(bare, STAFF);
            expect(target.displaces).toEqual([]);
            expect(target.replaces).toBeNull();
            expect(target.options).toHaveLength(2);
        });
    });

    describe("a doubled slot", () => {
        it("shows both rings, with the weaker one marked as the one that goes", () => {
            const target = targetSlotFor(armed, 29352);
            expect(target.options.map((o) => o.slot)).toEqual([10, 11]);
            const chosen = target.options.filter((o) => o.chosen);
            expect(chosen).toHaveLength(1);
            expect(chosen[0].slot).toBe(10);
            expect(target.options.find((o) => o.slot === 11).item.itemName).toBe("Ring B");
        });

        it("displaces exactly one of them", () => {
            const target = targetSlotFor(armed, 29352);
            expect(target.displaces).toHaveLength(1);
            expect(target.clears).toEqual([]);
        });

        it("takes the empty slot when there is one, and shows the other anyway", () => {
            const oneRing = { items: [{ slot: 11, itemId: 32527, itemLevel: 151, gems: [], enchantId: 0, itemName: "Ring B" }] };
            const target = targetSlotFor(oneRing, 29352);
            expect(target.slot).toBe(10);
            expect(target.replaces).toBeNull();
            expect(target.options).toHaveLength(2);
            expect(target.options.find((o) => o.slot === 11).item.itemName).toBe("Ring B");
        });
    });

    describe("a one-hand weapon", () => {
        it("does not clear the off hand", () => {
            const target = targetSlotFor(armed, DAGGER);
            expect(target.clears).toEqual([]);
            expect(target.displaces).toHaveLength(1);
        });
    });

    it("still returns null for an item that fits nowhere", () => {
        expect(targetSlotFor(armed, 999999)).toBeNull();
    });
});
