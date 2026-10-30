// Every active category plays a fixed version (#738): the start-up migration
// writes each active category's version into `categoryVersion`, once and
// logged; afterwards switching the main version moves no category.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../../src/config/paths");
const { migrateSettings, migrateCategoryVersions } = require("../../../src/stores/settings/settingsMigration");
const configStore = require("../../../src/stores/settings/configStore");
const { mainVersionFor } = require("../../../src/services/versions/mainVersion");

const CONFIG_FILE = settingsPath("config.json");
const stored = () => JSON.parse(fs.__store.get(CONFIG_FILE));
const quiet = { log: () => {}, warn: () => {} };

beforeEach(() => {
    fs.__store.clear();
});

describe("stores/settings/settingsMigration — category versions (#738)", () => {
    it("pins every active category to the version it plays and logs one line", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ categoryIds: ["mon", "fri", "sun"], mainVersion: "tbc", categoryVersion: { fri: "forever" } }));
        const log = jest.fn();
        const { changes } = migrateSettings({ log, warn: () => {} });
        expect(changes).toContain("config.json: Spielversion je aktiver Kategorie festgeschrieben (#738) - mon tbc, sun tbc");
        expect(log).toHaveBeenCalledWith("[settings] Migration: config.json: Spielversion je aktiver Kategorie festgeschrieben (#738) - mon tbc, sun tbc");
        expect(stored().categoryVersion).toEqual({ mon: "tbc", fri: "forever", sun: "tbc" });
    });

    it("is idempotent: the second start finds nothing and writes nothing", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ categoryIds: ["mon"], mainVersion: "forever" }));
        migrateSettings(quiet);
        expect(stored().categoryVersion).toEqual({ mon: "forever" });
        fs.writeFileSync.mockClear();
        expect(migrateCategoryVersions()).toEqual([]);
        expect(migrateSettings(quiet).changes).toEqual([]);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it("drops an unknown version and pins the category anew", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ categoryIds: ["mon"], categoryVersion: { mon: "wotlk" } }));
        expect(migrateCategoryVersions()).toEqual(["config.json: Spielversion je aktiver Kategorie festgeschrieben (#738) - mon tbc"]);
        expect(stored().categoryVersion).toEqual({ mon: "tbc" });
    });

    it("writes nothing for a fresh install or a file without categories", () => {
        expect(migrateCategoryVersions()).toEqual([]);
        expect(fs.__store.has(CONFIG_FILE)).toBe(false);
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: "g" }));
        expect(migrateCategoryVersions()).toEqual([]);
    });

    it("a switch of the main version afterwards changes no category", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ categoryIds: ["mon", "fri"], mainVersion: "tbc" }));
        migrateSettings(quiet);
        configStore.saveConfig({ mainVersion: "forever" });
        expect(mainVersionFor({ categoryId: "mon" })).toBe("tbc");
        expect(mainVersionFor({ categoryId: "fri" })).toBe("tbc");
        // only something new without a category starts in the main version
        expect(mainVersionFor({})).toBe("forever");
        expect(mainVersionFor({ categoryId: "new-category" })).toBe("forever");
    });
});
