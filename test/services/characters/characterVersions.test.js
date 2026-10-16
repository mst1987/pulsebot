// Welche Spielversion ein Charakter im Roster und in der Loot-Historie hat (#543).
const mockEvents = new Map();
jest.mock("../../../src/stores/eventStore", () => ({
    getEvent: (id) => mockEvents.get(id) || null,
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
}));

const profiles = require("../../../src/stores/raiderProfileStore");
const { buildVersionContext, eventVersion, versionsOfCharacter, versionChoices, charactersOfVersion } = require("../../../src/services/characters/characterVersions");
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

    // #737: Loot eines gescannten Raid-Helper-Raids hat dessen gespeicherte Version.
    it("nimmt für Raid-Helper-Loot die gespeicherte Version des Schnappschusses", () => {
        const raidEvents = require("../../../src/stores/raidEventStore");
        raidEvents.useFile(tempStoreFile("eh-character-versions-raid-events.json"));
        try {
            raidEvents.saveRaidEvents([{ id: "rh-forever", title: "Ony", versionId: "forever" }]);
            const ctx = buildVersionContext({ config: { mainVersion: "tbc" } });
            expect(eventVersion(ctx, "rh-forever")).toBe("forever");
            expect(eventVersion(ctx, "rh-unscanned")).toBe("tbc");
        } finally {
            raidEvents.useFile(null);
        }
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

    describe("charactersOfVersion (#741)", () => {
        const rows = [
            { character: "Devi Res", categoryIds: [] },
            { character: "Anna", categoryIds: [] },
            { character: "Beide", categoryIds: [] },
            { character: "Neu", categoryIds: ["fcat"] },
        ];
        const itemsOf = (name) => ({ Beide: [{ eventId: "eh-barrow" }, { eventId: "eh-kara" }], Anna: [{ eventId: "eh-kara" }] }[name] || []);

        it("keeps the rows that play the version: by profile, by loot (itemsOf) and by the category's version", () => {
            profiles.addCharacter(ANNA, { name: "Devi Res", className: "Priest", versionId: "forever" });
            const config = { categoryVersion: { fcat: "forever" } };
            expect(charactersOfVersion(rows, "forever", { itemsOf, config }).map((r) => r.character)).toEqual(["Devi Res", "Beide", "Neu"]);
            expect(charactersOfVersion(rows, "tbc", { itemsOf, config }).map((r) => r.character)).toEqual(["Anna", "Beide"]);
        });

        it("counts the category of a hand-assigned character as evidence beside its loot (assigned)", () => {
            const mine = [{ character: "Anna", categoryIds: ["fcat"] }];
            const config = { categoryVersion: { fcat: "forever" } };
            // Anna has TBC loot only, but sits in a category that plays Forever now
            expect(charactersOfVersion(mine, "forever", { itemsOf, config })).toEqual([]);
            expect(charactersOfVersion(mine, "forever", { itemsOf, config, assigned: true })).toEqual(mine);
            expect(charactersOfVersion(mine, "tbc", { itemsOf, config, assigned: true })).toEqual(mine);
        });

        it("prefers the items a row carries to the lookup", () => {
            const own = [{ character: "Anna", items: [{ eventId: "eh-barrow" }] }];
            expect(charactersOfVersion(own, "forever", { itemsOf })).toEqual(own);
            expect(charactersOfVersion(own, "tbc", { itemsOf })).toEqual([]);
        });
    });
});
