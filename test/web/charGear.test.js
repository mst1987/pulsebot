// reportStore is mocked: what is under test is which report wins per character
// and how an armory row is trimmed into a loadout item, not file I/O.
const mockListReports = jest.fn(() => []);
const mockGetReport = jest.fn(() => null);
jest.mock("../../src/web/reportStore", () => ({
    listReports: (...a) => mockListReports(...a),
    getReport: (...a) => mockGetReport(...a),
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
    beforeEach(() => jest.clearAllMocks());

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
