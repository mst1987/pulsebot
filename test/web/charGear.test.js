// reportStore is mocked: what is under test is which report wins per character
// and how an armory row is trimmed into a loadout item, not file I/O.
const mockListReports = jest.fn(() => []);
const mockGetReport = jest.fn(() => null);
jest.mock("../../src/web/reportStore", () => ({
    listReports: (...a) => mockListReports(...a),
    getReport: (...a) => mockGetReport(...a),
}));

// Der Armory-Cache ist gemockt: geprüft wird, was charGear mit einer Antwort
// macht, nicht wie sie geholt wird (das steht in armoryGear.test.js).
const mockArmorySetFor = jest.fn(() => null);
const mockArmoryItemInSlot = jest.fn(() => null);
jest.mock("../../src/web/armoryGear", () => ({
    armorySetFor: (...a) => mockArmorySetFor(...a),
    armoryItemInSlot: (...a) => mockArmoryItemInSlot(...a),
}));

const { gearByCharacter, gearFor, itemInSlot, charKey } = require("../../src/web/charGear");

const armoryItem = (over = {}) => ({
    slot: 0, slotName: "Kopf", itemId: "31064", itemName: "Hood of Absolution",
    icon: "inv_helmet_99.jpg", quality: 4, itemLevel: 146,
    gems: [{ id: "25893", itemLevel: 70 }, { id: "30600", itemLevel: 70 }],
    emptySockets: 0,
    enchant: { status: "ok", enchantId: "3002", reason: "" },
    ...over,
});

const report = (id, generatedAt, roster) => ({
    id, generatedAt, title: `Report ${id}`, roster,
});

function setReports(...reports) {
    // listReports() sorts newest first; the store is mocked, so do it here.
    const sorted = [...reports].sort((a, b) => b.generatedAt - a.generatedAt);
    mockListReports.mockReturnValue(sorted.map((r) => ({ id: r.id, generatedAt: r.generatedAt })));
    mockGetReport.mockImplementation((id) => sorted.find((r) => r.id === id) || null);
}

describe("web/charGear", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockArmorySetFor.mockReturnValue(null);
        mockArmoryItemInSlot.mockReturnValue(null);
    });

    it("returns nothing when there are no reports", () => {
        setReports();
        expect(gearByCharacter().size).toBe(0);
        expect(gearFor("Devihra")).toBeNull();
    });

    it("reads a character's equipment out of a report's armory", () => {
        setReports(report("a", 2000, [{ name: "Devihra", type: "Priest", armory: [armoryItem()] }]));
        const gear = gearFor("Devihra");
        expect(gear).toMatchObject({ character: "Devihra", className: "Priest", seenAt: 2000, reportId: "a" });
        expect(gear.items).toHaveLength(1);
        expect(gear.items[0]).toMatchObject({
            slot: 0, itemId: 31064, itemLevel: 146, enchantId: 3002, gems: [25893, 30600],
        });
    });

    it("keeps the gems in socket order, because a loadout is positional", () => {
        setReports(report("a", 1, [{
            name: "Devihra", type: "Priest",
            armory: [armoryItem({ gems: [{ id: "1" }, { id: "2" }, { id: "3" }] })],
        }]));
        expect(gearFor("Devihra").items[0].gems).toEqual([1, 2, 3]);
    });

    it("turns a missing enchant into 0 rather than NaN", () => {
        setReports(report("a", 1, [{
            name: "Devihra", type: "Priest",
            armory: [armoryItem({ enchant: { status: "missing", enchantId: null } })],
        }]));
        expect(gearFor("Devihra").items[0].enchantId).toBe(0);
    });

    it("takes the newest report per character", () => {
        setReports(
            report("old", 1000, [{ name: "Devihra", type: "Priest", armory: [armoryItem({ itemId: "11111" })] }]),
            report("new", 2000, [{ name: "Devihra", type: "Priest", armory: [armoryItem({ itemId: "22222" })] }]),
        );
        const gear = gearFor("Devihra");
        expect(gear.reportId).toBe("new");
        expect(gear.items[0].itemId).toBe(22222);
    });

    it("keeps a raider whose gear only appears in an older report", () => {
        // Someone who has not raided lately still has a last known set — the
        // caller decides whether it is recent enough, using seenAt.
        setReports(
            report("new", 2000, [{ name: "Andere", type: "Mage", armory: [armoryItem()] }]),
            report("old", 1000, [{ name: "Devihra", type: "Priest", armory: [armoryItem()] }]),
        );
        expect(gearFor("Devihra")).toMatchObject({ seenAt: 1000 });
        expect(gearByCharacter().size).toBe(2);
    });

    it("matches a character regardless of realm suffix and case", () => {
        setReports(report("a", 1, [{ name: "Devihra", type: "Priest", armory: [armoryItem()] }]));
        expect(gearFor("devihra")).toBeTruthy();
        expect(gearFor("Devihra-Thunderstrike")).toBeTruthy();
        expect(charKey("Devihra-Thunderstrike")).toBe(charKey("devihra"));
    });

    it("skips empty item slots and rows the log could not read", () => {
        setReports(report("a", 1, [
            { name: "Devihra", type: "Priest", armory: [armoryItem(), armoryItem({ slot: 1, itemId: "0" })] },
            // A roster row with no readable gear at all would look like a raider
            // wearing nothing, so it is left out entirely.
            { name: "Leer", type: "Mage", armory: [] },
        ]));
        expect(gearFor("Devihra").items).toHaveLength(1);
        expect(gearFor("Leer")).toBeNull();
    });

    it("tolerates a report without a roster", () => {
        setReports({ id: "a", generatedAt: 1, title: "kaputt" });
        expect(gearByCharacter().size).toBe(0);
    });

    // A piece that only pays off against certain bosses reads as an empty slot
    // in every comparison (see config/situationalItems.js), which would credit
    // its wearer the full worth of any drop for that slot. So the newest raid
    // is not the last word on such a slot.
    describe("boss-specific pieces", () => {
        const MOTC = 23207; // Mark of the Champion, "+85 gegen Untote und Dämonen"
        const wowsims = require("../../src/config/wowsims");
        const shadowIds = wowsims.bisFor("Priest-Shadow", "t6").items.map((e) => e.id);
        const trinket = shadowIds.find((id) => wowsims.slotsFor(id).includes(12));

        // Full sets, so gearProfile has enough to judge the role by: the
        // substitution may only take a piece out of a set that fits the role.
        const setOf = (ids, over = {}) => ids.slice(0, 16).map((itemId, i) => armoryItem({
            slot: i, itemId: String(itemId), itemName: `Item ${itemId}`, gems: [],
            ...(over[i] || {}),
        }));
        const casterSet = (slot12) => setOf(shadowIds, { 12: { itemId: String(slot12), itemName: `Item ${slot12}` } });
        const healIds = Object.entries(require("../../src/config/wowsims/items.json").items)
            .filter(([, it]) => (it.stats.healingPower || 0) > 60 && !it.stats.spellHit && it.ilvl >= 120)
            .sort((a, b) => b[1].stats.healingPower - a[1].stats.healingPower)
            .map(([id]) => Number(id));

        const casterGear = () => gearByCharacter({ roleFor: () => "caster" }).get("devihra");

        it("prefers what they wore on another boss of the same night", () => {
            // Die beste Auskunft, die es gibt: derselbe Raider, derselbe Abend,
            // einen Boss weiter. Die Auswertung hat das beim Bauen mitgeschrieben
            // (utils/logcheck/gearVariants.js), also muss der Griff in ältere
            // Auswertungen gar nicht erst passieren.
            const withAlternate = casterSet(MOTC);
            withAlternate[12].alternate = {
                slot: 12, itemId: String(trinket), itemName: `Item ${trinket}`,
                gems: [], enchant: { status: "na", enchantId: null }, fight: "Illidan Stormrage",
            };
            setReports(
                report("neu", 3000, [{ name: "Devihra", type: "Priest", armory: withAlternate }]),
                report("alt", 2000, [{ name: "Devihra", type: "Priest", armory: casterSet(shadowIds[13]) }]),
            );
            const worn = itemInSlot(casterGear(), 12);
            expect(worn.itemId).toBe(trinket);
            expect(worn.situational).toBeNull();
            expect(worn.replacedSituational).toMatchObject({
                itemId: MOTC, sameRaid: true, fight: "Illidan Stormrage",
            });
        });

        it("ignores a same-night alternative the raider wears elsewhere", () => {
            const withAlternate = casterSet(MOTC);
            withAlternate[13] = { ...withAlternate[13], itemId: String(trinket), itemName: `Item ${trinket}` };
            withAlternate[12].alternate = {
                slot: 12, itemId: String(trinket), itemName: `Item ${trinket}`,
                gems: [], enchant: { status: "na", enchantId: null }, fight: "Illidan Stormrage",
            };
            setReports(report("neu", 3000, [{ name: "Devihra", type: "Priest", armory: withAlternate }]));
            const gear = casterGear();
            // Der Ersatz wird abgelehnt, und weil nichts anderes bleibt, ist der
            // Slot leer statt doppelt belegt.
            expect(itemInSlot(gear, 12)).toBeNull();
            expect(itemInSlot(gear, 13).itemId).toBe(trinket);
            expect(gear.dropped[0]).toMatchObject({ slot: 12, itemId: MOTC });
        });

        it("substitutes what the raider wears in that slot on a normal night", () => {
            setReports(
                report("neu", 3000, [{ name: "Devihra", type: "Priest", armory: casterSet(MOTC) }]),
                report("alt", 2000, [{ name: "Devihra", type: "Priest", armory: casterSet(trinket) }]),
            );
            const worn = itemInSlot(casterGear(), 12);
            expect(worn.itemId).toBe(trinket);
            expect(worn.situational).toBeNull();
        });

        it("says what it stands in for rather than swapping it in quietly", () => {
            setReports(
                report("neu", 3000, [{ name: "Devihra", type: "Priest", armory: casterSet(MOTC) }]),
                report("alt", 2000, [{ name: "Devihra", type: "Priest", armory: casterSet(trinket) }]),
            );
            const worn = itemInSlot(casterGear(), 12);
            expect(worn.replacedSituational).toMatchObject({ itemId: MOTC, reportTitle: "Report alt", seenAt: 2000 });
            expect(worn.replacedSituational.note).toContain("Untote");
        });

        it("takes the piece out of the set when no source can answer", () => {
            // Es steht dann *nicht* mehr da. So ein Teil ist gegen jeden Boss,
            // für den ein Council plant, so viel wert wie ein leerer Slot — es
            // stehen zu lassen behauptet Ausrüstung, die es nicht gibt.
            setReports(report("neu", 3000, [{ name: "Devihra", type: "Priest", armory: casterSet(MOTC) }]));
            const gear = casterGear();
            expect(itemInSlot(gear, 12)).toBeNull();
            expect(gear.items.some((it) => it.situational)).toBe(false);
            // Verschwiegen wird es aber nicht: der Slot ist benannt, samt Grund.
            expect(gear.dropped).toHaveLength(1);
            expect(gear.dropped[0]).toMatchObject({ slot: 12, itemId: MOTC });
            expect(gear.dropped[0].note).toContain("Untote");
        });

        it("does not take the substitute out of a set of the wrong role", () => {
            // The trinket of the night they healed is not what they wear as a
            // caster either — that would trade one wrong baseline for another.
            // Also bleibt der Slot leer statt falsch gefüllt.
            setReports(
                report("neu", 3000, [{ name: "Devihra", type: "Priest", armory: casterSet(MOTC) }]),
                report("heal", 2000, [{ name: "Devihra", type: "Priest", armory: setOf(healIds) }]),
            );
            const gear = casterGear();
            expect(itemInSlot(gear, 12)).toBeNull();
            expect(gear.dropped[0]).toMatchObject({ itemId: MOTC });
        });

        it("does not hand a slot the item the raider still wears in the other one", () => {
            // Aus der Praxis: ein Elementar-Schamane bekam auf Schmuck 1 genau
            // das Trinket gesetzt, das er auf Schmuck 2 schon trug. Zweimal
            // dasselbe Teil kann niemand anlegen, und im Vergleich zählen seine
            // Werte dann doppelt.
            const pair = (a, b) => setOf(shadowIds, {
                12: { itemId: String(a), itemName: `Item ${a}` },
                13: { itemId: String(b), itemName: `Item ${b}` },
            });
            const other = shadowIds[13];
            setReports(
                report("neu", 3000, [{ name: "Devihra", type: "Priest", armory: pair(MOTC, trinket) }]),
                report("alt", 2000, [{ name: "Devihra", type: "Priest", armory: pair(trinket, other) }]),
            );
            const gear = casterGear();
            // Schmuck 1 bleibt leer, Schmuck 2 behält sein Trinket — auf keinen
            // Fall steht dasselbe Teil zweimal da.
            expect(itemInSlot(gear, 12)).toBeNull();
            expect(itemInSlot(gear, 13).itemId).toBe(trinket);
            expect(gear.dropped[0]).toMatchObject({ slot: 12, itemId: MOTC });
        });

        it("does not replace one boss-specific piece with another", () => {
            setReports(
                report("neu", 3000, [{ name: "Devihra", type: "Priest", armory: casterSet(23207) }]),
                report("alt", 2000, [{ name: "Devihra", type: "Priest", armory: casterSet(23206) }]),
                report("alt2", 1000, [{ name: "Devihra", type: "Priest", armory: casterSet(trinket) }]),
            );
            expect(itemInSlot(casterGear(), 12).itemId).toBe(trinket);
        });

        it("leaves ordinary gear alone — the newest raid stays the newest raid", () => {
            setReports(
                report("neu", 3000, [{ name: "Devihra", type: "Priest", armory: casterSet(trinket) }]),
                report("alt", 2000, [{ name: "Devihra", type: "Priest", armory: casterSet(MOTC) }]),
            );
            const worn = itemInSlot(casterGear(), 12);
            expect(worn.itemId).toBe(trinket);
            expect(worn.replacedSituational).toBeNull();
        });
    });

    // Die Logs wissen, was jemand *getragen* hat; die Armory weiß, was er
    // *anhat*. Zwischen zwei Raidnächten läuft das mit jedem Drop auseinander.
    describe("gear from the armory", () => {
        const wowsims = require("../../src/config/wowsims");
        const shadowIds = wowsims.bisFor("Priest-Shadow", "t6").items.map((e) => e.id);
        const logSet = shadowIds.slice(0, 16).map((itemId, i) => armoryItem({
            slot: i, itemId: String(itemId), itemName: `Item ${itemId}`, gems: [],
            enchant: { status: "ok", enchantId: "3002", reason: "" },
        }));
        const armoryRow = (slot, itemId) => ({
            slot, itemId: String(itemId), itemName: `Item ${itemId}`, icon: null, quality: null,
            itemLevel: 0, gems: [], emptySockets: 0, enchant: { status: "na", enchantId: null, reason: "" },
        });
        const casterGear = () => gearByCharacter({ roleFor: () => "caster" }).get("devihra");

        beforeEach(() => {
            setReports(report("neu", 3000, [{ name: "Devihra", type: "Priest", armory: logSet }]));
        });

        it("uses the log while nobody has asked the armory", () => {
            const gear = casterGear();
            expect(gear.source).toBe("log");
            expect(gear.armoryAt).toBe(0);
        });

        it("takes the whole set once the armory has answered", () => {
            // Der gemeldete Fall: im Log noch Waffe + Nebenhand, in der Armory
            // längst ein Zweihänder.
            mockArmorySetFor.mockReturnValue({
                at: 5000,
                rows: [armoryRow(0, shadowIds[0]), armoryRow(15, 32374)],
            });
            const gear = casterGear();
            expect(gear.source).toBe("armory");
            expect(gear.armoryAt).toBe(5000);
            expect(gear.items).toHaveLength(2);
            expect(itemInSlot(gear, 15).itemId).toBe(32374);
            // Die Nebenhand aus dem Log ist weg, weil die Armory sie nicht führt.
            expect(itemInSlot(gear, 16)).toBeNull();
        });

        it("carries the log's enchant over for a piece that did not change", () => {
            // Blizzards Verzauberungs-IDs sind nicht die von WoWSims — für
            // dasselbe Teil ist die Verzauberung aber eine Tatsache über das
            // Teil, nicht über die Quelle.
            mockArmorySetFor.mockReturnValue({ at: 5000, rows: [armoryRow(0, shadowIds[0])] });
            const worn = itemInSlot(casterGear(), 0);
            expect(worn.enchantId).toBe(3002);
            expect(worn.enchantStatus).toBe("ok");
        });

        it("claims no enchant for a piece that is new since the last raid", () => {
            mockArmorySetFor.mockReturnValue({ at: 5000, rows: [armoryRow(0, 32341)] });
            const gear = casterGear();
            expect(itemInSlot(gear, 0).enchantId).toBe(0);
            expect(itemInSlot(gear, 0).enchantStatus).toBe("na");
            // Und es wird gezählt, damit die Seite sagen kann, dass die
            // Simulation dieses Teil unverzaubert rechnet.
            expect(gear.unverifiedEnchants).toBe(1);
        });

        it("keeps the log's name and icon for the same piece", () => {
            // Die Armory schickt kein Icon; das Log hat eins gesehen, auch für
            // Teile, die die generierte Tabelle nicht kennt.
            mockArmorySetFor.mockReturnValue({ at: 5000, rows: [armoryRow(0, shadowIds[0])] });
            expect(itemInSlot(casterGear(), 0).iconUrl).toContain("inv_helmet_99");
        });

        it("refuses a set that is the wrong role for this raider", () => {
            // Wer gerade in Heilgear steckt, wird trotzdem an seinem Casterset
            // gemessen — dieselbe Regel wie bei den Logs.
            const healIds = Object.entries(require("../../src/config/wowsims/items.json").items)
                .filter(([, it]) => (it.stats.healingPower || 0) > 60 && !it.stats.spellHit && it.ilvl >= 120)
                .sort((a, b) => b[1].stats.healingPower - a[1].stats.healingPower)
                .slice(0, 16)
                .map(([id]) => Number(id));
            mockArmorySetFor.mockReturnValue({
                at: 5000,
                rows: healIds.map((id, i) => armoryRow(i, id)),
            });
            const gear = casterGear();
            expect(gear.source).toBe("log");
        });
    });

    describe("itemInSlot", () => {
        it("finds the item in a slot, or null", () => {
            setReports(report("a", 1, [{ name: "Devihra", type: "Priest", armory: [armoryItem()] }]));
            const gear = gearFor("Devihra");
            expect(itemInSlot(gear, 0).itemId).toBe(31064);
            expect(itemInSlot(gear, 5)).toBeNull();
            expect(itemInSlot(null, 0)).toBeNull();
        });
    });
});
