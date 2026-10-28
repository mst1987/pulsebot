// settingsMigration (#952): the global top items of before become the TBC list
// of every server whose categories play TBC (else of the first server); the
// old list stays as `topItemsLegacy`, and a second start changes nothing.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const { migrateTopItems, migrateSettings } = require("../../src/stores/settingsMigration");
const configStore = require("../../src/stores/configStore");
const { topItemIds } = require("../../src/services/loot/topItems");

const CONFIG_FILE = settingsPath("config.json");
const NAMES_FILE = settingsPath("category-names.json");
const HOME = "1400000000000000001";
const OTHER = "1400000000000000002";
const THIRD = "1400000000000000003";
const CAT_TBC = "1500000000000000001";
const CAT_FOREVER = "1500000000000000002";
const CAT_TBC_THIRD = "1500000000000000003";
const stored = () => JSON.parse(fs.__store.get(CONFIG_FILE));
const servers = { servers: [{ guildId: HOME, label: "" }, { guildId: OTHER, label: "" }, { guildId: THIRD, label: "" }] };
const legacy = [
    { id: 32837, name: "Warglaive of Azzinoth", iconUrl: "https://wow.zamimg.com/images/wow/icons/large/inv_weapon_glave_01.jpg", quality: 5 },
    { id: 30311, name: "Warp Slicer", iconUrl: "", quality: 4 },
];

beforeEach(() => {
    fs.__store.clear();
    configStore.useFile(null);
});

describe("stores/settingsMigration migrateTopItems (#952)", () => {
    it("copies the list onto every server whose categories play TBC and keeps the old one as topItemsLegacy", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({
            guildId: HOME, discordServers: servers, topItems: legacy,
            categoryVersion: { [CAT_TBC]: "tbc", [CAT_FOREVER]: "forever", [CAT_TBC_THIRD]: "tbc" },
        }));
        fs.__store.set(NAMES_FILE, JSON.stringify({ guilds: { [OTHER]: { [CAT_TBC]: "Raids" }, [HOME]: { [CAT_FOREVER]: "Forever" }, [THIRD]: { [CAT_TBC_THIRD]: "PuGs" } } }));
        const lines = migrateTopItems();
        expect(lines).toEqual([`config.json: 2 Top-Item(s) als TBC-Liste je Server gespeichert -> ${OTHER}, ${THIRD}, alte Liste als topItemsLegacy behalten (#952)`]);
        const file = stored();
        expect(file.topItems).toBeUndefined();
        expect(file.topItemsLegacy).toEqual(legacy);
        expect(file.serverSettings[OTHER].topItems.tbc).toEqual(legacy);
        expect(file.serverSettings[THIRD].topItems.tbc).toEqual(legacy);
        expect(file.serverSettings[HOME]).toBeUndefined();
        const config = configStore.getConfig();
        expect([...topItemIds(OTHER, "tbc", { config })]).toEqual([32837, 30311]);
        expect(topItemIds(HOME, "tbc", { config }).size).toBe(0);
        expect(topItemIds(OTHER, "forever", { config }).size).toBe(0);
        expect(config.topItemsLegacy).toEqual(legacy);
        expect(config.topItems).toBeUndefined();
    });

    it("falls back to the first server without a TBC category and says so", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: HOME, discordServers: servers, topItems: legacy }));
        expect(migrateTopItems()).toEqual([`config.json: 2 Top-Item(s) als TBC-Liste je Server gespeichert -> ${HOME} (kein TBC-Server gefunden, erster Server), alte Liste als topItemsLegacy behalten (#952)`]);
        expect(stored().serverSettings[HOME].topItems).toEqual({ tbc: legacy });
        expect(stored().serverSettings[OTHER]).toBeUndefined();
    });

    it("ignores a TBC category of a server that is not in the list", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: HOME, discordServers: servers, topItems: legacy, categoryVersion: { [CAT_TBC]: "tbc" } }));
        fs.__store.set(NAMES_FILE, JSON.stringify({ guilds: { "1400000000000000099": { [CAT_TBC]: "Fremd" } } }));
        migrateTopItems();
        expect(Object.keys(stored().serverSettings)).toEqual([HOME]);
    });

    it("leaves a server with its own TBC list alone and keeps its other blocks", () => {
        const own = [{ id: 1, name: "Eigen", iconUrl: "", quality: 4 }];
        fs.__store.set(CONFIG_FILE, JSON.stringify({
            guildId: HOME, discordServers: servers, topItems: legacy,
            serverSettings: { [HOME]: { botLanguage: "en", topItems: { tbc: own, forever: own } } },
        }));
        const lines = migrateTopItems();
        expect(lines[0]).toContain("kein Server ohne eigene Liste");
        expect(stored().serverSettings[HOME]).toEqual({ botLanguage: "en", topItems: { tbc: own, forever: own } });
        expect(stored().topItemsLegacy).toEqual(legacy);
    });

    it("moves an empty list out of the way silently, without touching serverSettings", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: HOME, discordServers: servers, topItems: [] }));
        expect(migrateTopItems()).toEqual([]);
        expect(stored().topItems).toBeUndefined();
        expect(stored().topItemsLegacy).toEqual([]);
        expect(stored().serverSettings).toBeUndefined();
        expect(migrateTopItems()).toEqual([]);
    });

    it("saveConfig vor migrateTopItems verliert die alte Liste nicht", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: HOME, discordServers: servers, topItems: legacy }));
        // a save from an old client carrying a list of its own: the stored one wins
        configStore.saveConfig({ botLanguage: "en", topItems: [{ id: 1, name: "Fremd" }] });
        expect(stored().topItems).toEqual(legacy);
        expect(configStore.getConfig().topItems).toBeUndefined();
        // the migration then still runs as before
        expect(migrateTopItems()[0]).toContain("2 Top-Item(s)");
        expect(stored().serverSettings[HOME].topItems.tbc).toEqual(legacy);
        expect(stored().topItemsLegacy).toEqual(legacy);
        expect(stored().topItems).toBeUndefined();
        expect(stored().botLanguage).toBe("en");
    });

    it("keeps the old list when a category is dropped before the migration", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: HOME, discordServers: servers, topItems: legacy, categoryVersion: { [CAT_TBC]: "tbc", [CAT_FOREVER]: "forever" } }));
        expect(configStore.dropCategoryEntries(CAT_FOREVER, ["categoryVersion"]).removed).toEqual(["categoryVersion"]);
        expect(stored().categoryVersion).toEqual({ [CAT_TBC]: "tbc" });
        expect(stored().topItems).toEqual(legacy);
    });

    it("does nothing a second time, nor without an old list", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: HOME, discordServers: servers, topItems: legacy }));
        migrateTopItems();
        const after = fs.__store.get(CONFIG_FILE);
        expect(migrateTopItems()).toEqual([]);
        expect(fs.__store.get(CONFIG_FILE)).toBe(after);
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: HOME }));
        expect(migrateTopItems()).toEqual([]);
    });

    it("keeps topItemsLegacy through a later save", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: HOME, discordServers: servers, topItems: legacy }));
        migrateTopItems();
        configStore.saveConfig({ botLanguage: "de" });
        expect(stored().topItemsLegacy).toEqual(legacy);
        expect(stored().topItems).toBeUndefined();
        expect(stored().serverSettings[HOME].topItems.tbc).toEqual(legacy);
        // after the migration a stale list from an old client is never written back
        configStore.saveConfig({ topItems: [{ id: 1, name: "Fremd" }] });
        expect(stored().topItems).toBeUndefined();
    });

    it("runs as part of migrateSettings with its log line", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: HOME, discordServers: servers, topItems: legacy }));
        const log = jest.fn();
        const { changes, error } = migrateSettings({ log, warn: jest.fn() });
        expect(error).toBeUndefined();
        expect(changes.some((line) => line.includes("(#952)"))).toBe(true);
        expect(stored().serverSettings[HOME].topItems.tbc).toHaveLength(2);
    });
});
