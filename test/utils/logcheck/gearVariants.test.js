// Was ein Raider auf den *anderen* Bossen derselben Nacht trug. Gemockt ist nur
// der WCL-Client — geprüft wird, wann überhaupt gefragt wird, was als Ersatz
// durchgeht und dass ein Fehlschlag den Report nicht mitnimmt.
const { resolveSituationalGear, situationalSlots, MAX_FIGHTS } = require("../../../src/utils/logcheck/gearVariants");

const MOTC = "23207";
const TRINKET = "29370";

const armoryRow = (slot, itemId) => ({
    slot,
    slotName: `Slot ${slot}`,
    itemId: String(itemId),
    itemName: `Item ${itemId}`,
    icon: "inv_misc_01.jpg",
    quality: 4,
    itemLevel: 141,
    gems: [],
    emptySockets: 0,
    enchant: { status: "na", enchantId: null, reason: "" },
});

/** A WCL casts entry as selectPlayers/buildArmory read it. */
const entry = (name, gear) => ({
    name,
    type: "Priest",
    total: 999,
    gear: gear.map(([slot, id]) => ({ slot, id: String(id), name: `Item ${id}`, quality: 4, itemLevel: 141, gems: [] })),
});

const fights = (count) => ({
    fights: Array.from({ length: count }, (_, i) => ({
        id: i + 1, boss: 600 + i, name: `Boss ${i + 1}`, start_time: i * 1000, end_time: i * 1000 + 900,
    })),
});

function wclWith(perFight) {
    const calls = [];
    return {
        calls,
        getCasts: jest.fn(async (reportId, start) => {
            calls.push(start);
            const idx = Math.floor(start / 1000);
            if (perFight[idx] instanceof Error) throw perFight[idx];
            return { entries: perFight[idx] || [] };
        }),
    };
}

describe("utils/logcheck/gearVariants", () => {
    describe("situationalSlots", () => {
        it("finds the boss-specific pieces of a roster row", () => {
            const row = { armory: [armoryRow(0, 31064), armoryRow(12, MOTC)] };
            expect(situationalSlots(row).map((it) => it.slot)).toEqual([12]);
        });

        it("is empty for ordinary gear — which is the normal case", () => {
            expect(situationalSlots({ armory: [armoryRow(12, TRINKET)] })).toEqual([]);
            expect(situationalSlots({})).toEqual([]);
        });
    });

    describe("resolveSituationalGear", () => {
        it("does not touch the network when nobody wears such a piece", async () => {
            const wcl = wclWith([]);
            const roster = [{ name: "Devihra", armory: [armoryRow(12, TRINKET)] }];
            const result = await resolveSituationalGear(wcl, "abc", fights(8), roster);
            expect(wcl.getCasts).not.toHaveBeenCalled();
            expect(result).toEqual({ checked: 0, resolved: 0 });
        });

        it("takes what the raider wore on another boss of the same night", async () => {
            const wcl = wclWith([
                [entry("Devihra", [[0, 31064], [12, MOTC]])],
                [entry("Devihra", [[0, 31064], [12, TRINKET]])],
            ]);
            const roster = [{ name: "Devihra", armory: [armoryRow(0, 31064), armoryRow(12, MOTC)] }];
            const result = await resolveSituationalGear(wcl, "abc", fights(4), roster);

            const worn = roster[0].armory.find((it) => it.slot === 12);
            expect(worn.alternate).toMatchObject({ itemId: TRINKET, fight: "Boss 2" });
            expect(result.resolved).toBe(1);
        });

        it("stops as soon as every open slot has an answer", async () => {
            const wcl = wclWith([
                [entry("Devihra", [[12, TRINKET]])],
                [entry("Devihra", [[12, TRINKET]])],
            ]);
            const roster = [{ name: "Devihra", armory: [armoryRow(12, MOTC)] }];
            await resolveSituationalGear(wcl, "abc", fights(6), roster);
            // One fight answered it; the remaining five are not paid for.
            expect(wcl.getCasts).toHaveBeenCalledTimes(1);
        });

        it("never hands over a piece the raider wears in the other slot", async () => {
            // Zwei gleiche Trinkets kann niemand anlegen, und ihre Werte zählten
            // im Vergleich doppelt (siehe web/charGear.js).
            const wcl = wclWith([[entry("Devihra", [[12, TRINKET], [13, TRINKET]])]]);
            const roster = [{ name: "Devihra", armory: [armoryRow(12, MOTC), armoryRow(13, TRINKET)] }];
            const result = await resolveSituationalGear(wcl, "abc", fights(3), roster);
            expect(roster[0].armory[0].alternate).toBeUndefined();
            expect(result.resolved).toBe(0);
        });

        it("does not swap one boss-specific piece for another", async () => {
            const wcl = wclWith([
                [entry("Devihra", [[12, "23206"]])],
                [entry("Devihra", [[12, TRINKET]])],
            ]);
            const roster = [{ name: "Devihra", armory: [armoryRow(12, MOTC)] }];
            await resolveSituationalGear(wcl, "abc", fights(4), roster);
            expect(roster[0].armory[0].alternate).toMatchObject({ itemId: TRINKET });
        });

        it("keeps going when one fight cannot be read", async () => {
            const wcl = wclWith([
                new Error("500"),
                [entry("Devihra", [[12, TRINKET]])],
            ]);
            const roster = [{ name: "Devihra", armory: [armoryRow(12, MOTC)] }];
            const result = await resolveSituationalGear(wcl, "abc", fights(4), roster);
            expect(roster[0].armory[0].alternate).toMatchObject({ itemId: TRINKET });
            expect(result.checked).toBe(1);
        });

        it("gives up quietly when the piece never came off", async () => {
            const wcl = wclWith(Array.from({ length: 20 }, () => [entry("Devihra", [[12, MOTC]])]));
            const roster = [{ name: "Devihra", armory: [armoryRow(12, MOTC)] }];
            const result = await resolveSituationalGear(wcl, "abc", fights(20), roster);
            expect(roster[0].armory[0].alternate).toBeUndefined();
            // Bounded: a night is not walked further than MAX_FIGHTS.
            expect(wcl.getCasts.mock.calls.length).toBe(MAX_FIGHTS);
            expect(result.resolved).toBe(0);
        });

        it("ignores trash — only boss fights carry a real gear set", async () => {
            const wcl = wclWith([[entry("Devihra", [[12, TRINKET]])]]);
            const roster = [{ name: "Devihra", armory: [armoryRow(12, MOTC)] }];
            await resolveSituationalGear(wcl, "abc", { fights: [{ id: 1, boss: 0, name: "Trash", start_time: 0, end_time: 900 }] }, roster);
            expect(wcl.getCasts).not.toHaveBeenCalled();
        });
    });
});
