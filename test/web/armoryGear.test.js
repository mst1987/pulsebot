// Live-Gear aus der Armory für die Slots, die ein Log nicht ehrlich beantworten
// kann. Der Blizzard-Client und die Einstellungen sind gemockt — geprüft wird,
// wann überhaupt gefragt wird, was zurückkommt und dass ein Fehlschlag nichts
// umwirft.
const mockGetEquipment = jest.fn();
const mockIsConfigured = jest.fn(() => true);
const mockGetConfig = jest.fn(() => ({ blizzard: { clientId: "id", clientSecret: "secret" } }));

jest.mock("../../src/classes/blizzard", () => jest.fn().mockImplementation(() => ({
    isConfigured: (...a) => mockIsConfigured(...a),
    getEquipment: (...a) => mockGetEquipment(...a),
})));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: (...a) => mockGetConfig(...a) }));

const {
    primeArmoryGear, armoryItemInSlot, hasArmoryGear, clearArmoryCache, toArmoryRows,
} = require("../../src/web/armoryGear");

const equipped = (slot, id, over = {}) => ({
    slot, itemId: id, name: `Item ${id}`, quality: "EPIC", level: 141, sockets: [], enchants: [], ...over,
});

beforeEach(() => {
    jest.clearAllMocks();
    clearArmoryCache();
    mockIsConfigured.mockReturnValue(true);
    mockGetConfig.mockReturnValue({ blizzard: { clientId: "id", clientSecret: "secret" } });
});

describe("web/armoryGear", () => {
    describe("toArmoryRows", () => {
        it("maps Blizzard's slot names onto the numbers the logs use", () => {
            const rows = toArmoryRows([equipped("TRINKET_1", 29370), equipped("HEAD", 31064)]);
            expect(rows.find((r) => r.slot === 12).itemId).toBe("29370");
            expect(rows.find((r) => r.slot === 0).itemId).toBe("31064");
        });

        it("fills icon and quality from the item table, which Blizzard does not send", () => {
            const row = toArmoryRows([equipped("TRINKET_1", 29370)])[0];
            expect(row.icon).toMatch(/\.jpg$/);
            expect(typeof row.quality).toBe("number");
        });

        it("claims no enchant — Blizzard's ids are not the ones WoWSims wants", () => {
            const row = toArmoryRows([equipped("TRINKET_1", 29370)])[0];
            expect(row.enchant).toEqual({ status: "na", enchantId: null, reason: "" });
        });

        it("keeps the gems, which are plain item ids on both sides", () => {
            const row = toArmoryRows([equipped("HEAD", 31064, {
                sockets: [{ gemId: 32196 }, { gemId: null }, { gemId: 35760 }],
            })])[0];
            expect(row.gems).toEqual([{ id: "32196" }, { id: "35760" }]);
        });

        it("skips a slot the logs have no number for", () => {
            expect(toArmoryRows([equipped("TABARD", 12345)])).toEqual([]);
        });
    });

    describe("primeArmoryGear", () => {
        it("asks for nothing without credentials", async () => {
            mockIsConfigured.mockReturnValue(false);
            const result = await primeArmoryGear(["Devihra"]);
            expect(result).toEqual({ asked: 0, answered: 0, configured: false });
            expect(mockGetEquipment).not.toHaveBeenCalled();
        });

        it("fetches a character once and then serves it from memory", async () => {
            mockGetEquipment.mockResolvedValue([equipped("TRINKET_1", 29370)]);
            await primeArmoryGear(["Devihra"]);
            await primeArmoryGear(["Devihra", "devihra-Thunderstrike"]);
            expect(mockGetEquipment).toHaveBeenCalledTimes(1);
            expect(armoryItemInSlot("Devihra", 12).itemId).toBe("29370");
        });

        it("remembers a failure too, so a broken name is not retried per view", async () => {
            mockGetEquipment.mockRejectedValue(new Error("404"));
            const result = await primeArmoryGear(["Wer?"]);
            expect(result.answered).toBe(0);
            await primeArmoryGear(["Wer?"]);
            expect(mockGetEquipment).toHaveBeenCalledTimes(1);
            expect(armoryItemInSlot("Wer?", 12)).toBeNull();
            expect(hasArmoryGear("Wer?")).toBe(false);
        });

        it("matches a character regardless of realm suffix and case", async () => {
            mockGetEquipment.mockResolvedValue([equipped("TRINKET_2", 32483)]);
            await primeArmoryGear(["Devihra-Thunderstrike"]);
            expect(armoryItemInSlot("devihra", 13).itemId).toBe("32483");
        });
    });

    describe("armoryItemInSlot", () => {
        it("is null for a character nobody asked about", () => {
            expect(armoryItemInSlot("Unbekannt", 12)).toBeNull();
        });

        it("refuses a boss-specific piece — the armory may have caught it too", async () => {
            // Mark of the Champion aus der Armory wäre keine Antwort, sondern
            // dieselbe Frage nochmal.
            mockGetEquipment.mockResolvedValue([equipped("TRINKET_1", 23207)]);
            await primeArmoryGear(["Devihra"]);
            expect(armoryItemInSlot("Devihra", 12)).toBeNull();
        });
    });
});
