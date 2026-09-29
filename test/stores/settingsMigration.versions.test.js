// #544: the raid plan's catalog, templates and tactic profiles get their game version once at start.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const { migrateSettings, migrateRaidplanVersions } = require("../../src/stores/settingsMigration");
const catalog = require("../../src/stores/raidplanCatalogStore");
const templates = require("../../src/stores/raidplanTemplateStore");
const profiles = require("../../src/stores/raidplanProfileStore");

const CATALOG_FILE = settingsPath("raidplan-catalog.json");
const TEMPLATES_FILE = settingsPath("raidplan-templates.json");
const PROFILES_FILE = settingsPath("raidplan-profiles.json");
const stored = (file) => JSON.parse(fs.__store.get(file));
const quiet = { log: () => {}, warn: () => {} };

// what a install from before #544 holds: an override of a default and an own mob without versions, an own spell that
// already names its version, a template and two tactic profiles without versionId
const OLD_CATALOG = {
    mobs: {
        "d:gathios": { id: "d:gathios", name: "Gathios (Tank)", kind: "add", instanceId: "bt", bossKey: "bt/the-illidari-council", icon: "", note: "" },
        "c:aaaaaaaaaa": { id: "c:aaaaaaaaaa", name: "Own Add", kind: "add", instanceId: "bt", bossKey: "", icon: "", note: "" },
    },
    spells: {
        "c:bbbbbbbbbb": { id: "c:bbbbbbbbbb", name: "Wrath Spell", nameEn: "", icon: "", type: "cc", classes: ["Mage"], note: "", versions: ["wotlk"] },
    },
    hiddenMobs: [], hiddenSpells: [],
};
const OLD_TEMPLATES = { templates: [{ id: "t1", name: "Montags-Raid", category: "", description: "", guildId: "", instanceIds: ["bt"], bosses: {}, version: 3, updatedAt: 5 }] };
const OLD_PROFILES = { profiles: [
    { id: "p1", name: "Kiten", category: "Kiten", bossKey: "", targets: [], notes: "", updatedAt: 1 },
    { id: "p2", name: "Council", category: "Adds", bossKey: "bt/the-illidari-council", steps: [], notes: "", updatedAt: 2 },
] };

beforeEach(() => {
    fs.__store.clear();
});

describe("stores/settingsMigration: raid plan game versions (#544)", () => {
    it("gives every stored catalog entry, template and profile a version, logs it, and a second start writes nothing", () => {
        fs.__store.set(CATALOG_FILE, JSON.stringify(OLD_CATALOG));
        fs.__store.set(TEMPLATES_FILE, JSON.stringify(OLD_TEMPLATES));
        fs.__store.set(PROFILES_FILE, JSON.stringify(OLD_PROFILES));
        const log = jest.fn();
        const { changes } = migrateSettings({ log, warn: () => {} });
        const lines = changes.filter((c) => c.includes("#544"));
        expect(lines).toEqual([
            "raidplan-catalog.json: 2 Eintrag/Einträge ohne Spielversion auf versions [\"tbc\"] gesetzt (#544)",
            "raidplan-templates.json: 1 Vorlage(n) ohne Spielversion mit versionId versehen (#544)",
            "raidplan-profiles.json: 2 Taktik-Profil(e) ohne Spielversion mit versionId versehen (#544)",
        ]);
        for (const line of lines) expect(log).toHaveBeenCalledWith(`[settings] Migration: ${line}`);

        const c = stored(CATALOG_FILE);
        expect(c.mobs["d:gathios"].versions).toEqual(["tbc"]);
        expect(c.mobs["c:aaaaaaaaaa"].versions).toEqual(["tbc"]);
        // an entry that already names its version keeps it
        expect(c.spells["c:bbbbbbbbbb"].versions).toEqual(["wotlk"]);
        // nothing else of an entry changes
        expect(c.mobs["d:gathios"]).toEqual({ ...OLD_CATALOG.mobs["d:gathios"], versions: ["tbc"] });
        expect(stored(TEMPLATES_FILE).templates[0]).toEqual({ ...OLD_TEMPLATES.templates[0], versionId: "tbc" });
        expect(stored(PROFILES_FILE).profiles.map((p) => p.versionId)).toEqual(["tbc", "tbc"]);

        // idempotent: nothing left to do, nothing written
        const before = [CATALOG_FILE, TEMPLATES_FILE, PROFILES_FILE].map((f) => fs.__store.get(f));
        expect(migrateRaidplanVersions()).toEqual([]);
        expect(migrateSettings(quiet).changes.filter((x) => x.includes("#544"))).toEqual([]);
        expect([CATALOG_FILE, TEMPLATES_FILE, PROFILES_FILE].map((f) => fs.__store.get(f))).toEqual(before);
    });

    it("a fresh install has nothing to migrate and writes no file", () => {
        expect(migrateRaidplanVersions()).toEqual([]);
        expect(fs.__store.has(CATALOG_FILE)).toBe(false);
        expect(fs.__store.has(TEMPLATES_FILE)).toBe(false);
        expect(fs.__store.has(PROFILES_FILE)).toBe(false);
    });

    it("after the migration the stored TBC entries are TBC-only in the catalog views", () => {
        fs.__store.set(CATALOG_FILE, JSON.stringify(OLD_CATALOG));
        // before: a stored entry without versions (the override too) shows in every version
        expect(catalog.catalogView("forever").mobs.map((m) => m.id)).toEqual(["d:gathios", "c:aaaaaaaaaa"]);
        migrateRaidplanVersions();
        expect(catalog.catalogView("forever").mobs).toEqual([]);
        expect(catalog.catalogView("forever").spells).toEqual([]);
        expect(catalog.catalogView("tbc").mobs.map((m) => m.id)).toEqual(expect.arrayContaining(["d:gathios", "c:aaaaaaaaaa"]));
    });

    it("a template or profile with Forever instances gets the Forever version; the stores read the same without the migration", () => {
        fs.__store.set(TEMPLATES_FILE, JSON.stringify({ templates: [{ id: "t2", name: "Ony", instanceIds: ["forever-ony"], bosses: {}, version: 1 }] }));
        fs.__store.set(PROFILES_FILE, JSON.stringify({ profiles: [{ id: "p3", name: "Ony", bossKey: "forever-ony", notes: "" }] }));
        expect(templates.getTemplate("t2").versionId).toBe("forever");
        expect(profiles.getProfile("p3").versionId).toBe("forever");
        migrateRaidplanVersions();
        expect(stored(TEMPLATES_FILE).templates[0].versionId).toBe("forever");
        expect(stored(PROFILES_FILE).profiles[0].versionId).toBe("forever");
    });
});
