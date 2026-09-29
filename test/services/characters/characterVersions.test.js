// Welche Spielversion ein Charakter im Roster und in der Loot-Historie hat (#543).
const mockEvents = new Map();
jest.mock("../../../src/stores/eventStore", () => ({
    getEvent: (id) => mockEvents.get(id) || null,
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
}));

const profiles = require("../../../src/stores/raiderProfileStore");
const { buildVersionContext, eventVersion, versionsOfCharacter, versionChoices } = require("../../../src/services/characters/characterVersions");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = "300000000000000001";

beforeAll(() => profiles.useFile(tempStoreFile("eh-character-versions.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mockEvents.clear();
    mockEvents.set("eh-barrow", { id: "eh-barrow", versionId: "forever" });
    mockEvents.set("eh-kara", { id: "eh-kara", versionId: "tbc" });
});

describe("services/characters/characterVersions", () => {
    it("nimmt die Version aus dem Profil, über den Namen", () => {
        profiles.addCharacter(ANNA, { name: "Devi Res", className: "Priest", versionId: "forever" });
        profiles.addCharacter(ANNA, { name: "Devi", className: "Priest" });
        const ctx = buildVersionContext({ config: {} });
        expect(versionsOfCharacter(ctx, { name: "Devi Res" })).toEqual(["forever"]);
        expect(versionsOfCharacter(ctx, { name: "Devi-Thunderstrike" })).toEqual(["tbc"]);
    });

    it("nimmt die Version aus dem Loot: eigenes Event seine, sonst TBC", () => {
        const ctx = buildVersionContext({ config: {} });
        expect(eventVersion(ctx, "eh-barrow")).toBe("forever");
        expect(eventVersion(ctx, "rh-123")).toBe("tbc");
        expect(eventVersion(ctx, "")).toBe("tbc");
        expect(eventVersion(ctx, "eh-gone")).toBe("tbc");
        expect(versionsOfCharacter(ctx, { name: "Zibbo", items: [{ eventId: "eh-barrow" }, { eventId: "rh-1" }] })).toEqual(["tbc", "forever"]);
    });

    it("fällt auf die Version der Kategorien zurück, dann auf TBC", () => {
        const ctx = buildVersionContext({ config: { mainVersion: "tbc", categoryVersion: { cat9: "forever" } } });
        expect(versionsOfCharacter(ctx, { name: "Neu", categoryIds: ["cat9"] })).toEqual(["forever"]);
        expect(versionsOfCharacter(ctx, { name: "Neu", categoryIds: ["cat1"] })).toEqual(["tbc"]);
        expect(versionsOfCharacter(ctx, { name: "Niemand" })).toEqual(["tbc"]);
    });

    it("bietet die Versionen mit Charakteren plus die Hauptversion zur Auswahl", () => {
        const rows = [{ versionIds: ["tbc"] }, { versionIds: ["tbc", "forever"] }];
        expect(versionChoices(rows, "tbc")).toEqual([
            { id: "tbc", label: "TBC Anniversary", short: "TBC", count: 2 },
            { id: "forever", label: "WoW Forever", short: "Forever", count: 1 },
        ]);
        expect(versionChoices([], "forever")).toEqual([{ id: "forever", label: "WoW Forever", short: "Forever", count: 0 }]);
    });
});
