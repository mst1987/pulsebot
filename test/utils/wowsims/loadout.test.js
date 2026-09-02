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
