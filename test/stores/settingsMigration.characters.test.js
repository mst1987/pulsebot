// Charaktere je Spielversion (#543): die Migration beim Start gibt jedem
// gespeicherten Profil-Charakter und jeder importierten Spec ohne Version "tbc" –
// einmal, geloggt, und ohne einen Schlüssel zu verschieben.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const { migrateSettings, migrateCharacterVersions } = require("../../src/stores/settingsMigration");
const profiles = require("../../src/stores/raiderProfileStore");
const specHistory = require("../../src/stores/specHistoryStore");

const PROFILES_FILE = settingsPath("raider-profiles.json");
const HISTORY_FILE = settingsPath("spec-history.json");
const stored = (file) => JSON.parse(fs.__store.get(file));

const A = "100000000000000001";
const B = "100000000000000002";

// Two raiders as they were stored before #543: no versionId anywhere.
const OLD_PROFILES = {
    profiles: {
        [A]: {
            userId: A, name: "Anna",
            characters: [
                { key: "nerathil", name: "Nerathil", className: "Mage", main: true, source: "log", specs: [{ key: "Mage-Frost", gear: "ready" }] },
                { key: "nerasol", name: "Nerasol", className: "Priest", main: false, source: "manual", specs: [] },
            ],
        },
        [B]: { userId: B, name: "Bert", characters: [{ key: "ysolde", name: "Ysolde", className: "Priest", main: true, source: "armory", specs: [] }] },
    },
};
const OLD_HISTORY = {
    users: { [A]: { "Mage-Frost": { count: 4, lastAt: 1000, lastEventId: "rh-1", character: "Nerathil" } } },
    importedEventIds: ["rh-1"],
    runs: [],
};

beforeEach(() => {
    fs.__store.clear();
    fs.__store.set(PROFILES_FILE, JSON.stringify(OLD_PROFILES));
    fs.__store.set(HISTORY_FILE, JSON.stringify(OLD_HISTORY));
});

describe("stores/settingsMigration — Charaktere je Spielversion (#543)", () => {
    it("setzt versionId tbc, loggt es und ändert keinen Schlüssel", () => {
        const log = jest.fn();
        const { changes } = migrateSettings({ log, warn: jest.fn() });
        expect(changes).toEqual([
            "raider-profiles.json: 3 Charakter(e) ohne Spielversion auf versionId \"tbc\" gesetzt (#543)",
            "spec-history.json: 1 importierte Spec(s) ohne Spielversion auf versionId \"tbc\" gesetzt (#543)",
            // no more mains: the order alone — the former main already stood first here
            "raider-profiles.json: 2 Profil(e) ohne Main-Markierung gespeichert – der bisherige Main steht je Spielversion vorn",
        ]);
        expect(stored(PROFILES_FILE).profiles[A].characters.some((c) => "main" in c)).toBe(false);
        expect(log).toHaveBeenCalledWith(expect.stringContaining("raider-profiles.json: 3 Charakter(e)"));

        const chars = stored(PROFILES_FILE).profiles[A].characters;
        expect(chars.map((c) => [c.key, c.versionId])).toEqual([["nerathil", "tbc"], ["nerasol", "tbc"]]);
        // Golden master: the TBC keys — loot, attendance and history key by them — are the bare names.
        expect(profiles.getProfile(A).characters.map((c) => c.key)).toEqual(["nerathil", "nerasol"]);
        expect(profiles.getProfile(B).characters[0]).toMatchObject({ key: "ysolde", versionId: "tbc" });
        // The imported spec keeps its key, too.
        expect(Object.keys(stored(HISTORY_FILE).users[A])).toEqual(["Mage-Frost"]);
        expect(specHistory.specHistoryOf(A)).toEqual([
            { spec: "Mage-Frost", versionId: "tbc", count: 4, lastAt: 1000, lastEventId: "rh-1", character: "Nerathil" },
        ]);
    });

    it("ist idempotent: der zweite Start findet nichts und schreibt nichts", () => {
        migrateSettings({ log: jest.fn(), warn: jest.fn() });
        const before = fs.__store.get(PROFILES_FILE);
        const historyBefore = fs.__store.get(HISTORY_FILE);
        expect(migrateCharacterVersions()).toEqual([]);
        expect(migrateSettings({ log: jest.fn(), warn: jest.fn() }).changes).toEqual([]);
        expect(fs.__store.get(PROFILES_FILE)).toBe(before);
        expect(fs.__store.get(HISTORY_FILE)).toBe(historyBefore);
    });

    it("lässt einen Charakter mit Version in Ruhe und ergänzt nur die fehlenden", () => {
        const mixed = JSON.parse(JSON.stringify(OLD_PROFILES));
        mixed.profiles[A].characters.push({ key: "forever~devi res", name: "Devi Res", versionId: "forever", className: "Priest", specs: [] });
        fs.__store.set(PROFILES_FILE, JSON.stringify(mixed));
        expect(profiles.migrateCharacterVersions()).toBe(3);
        const chars = stored(PROFILES_FILE).profiles[A].characters;
        expect(chars.find((c) => c.name === "Devi Res")).toMatchObject({ key: "forever~devi res", versionId: "forever" });
    });
});
