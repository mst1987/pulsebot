jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const {
    migrateSettings, legacyEventGuilds, migrateDiscordServers, migrateCategoryRaidTemplate,
} = require("../../src/web/settingsMigration");
const { getConfig } = require("../../src/web/configStore");
const { listRaidTemplates } = require("../../src/web/raidTemplateStore");

const CONFIG_FILE = settingsPath("config.json");
const TEMPLATES_FILE = settingsPath("raid-templates.json");
const stored = (file) => JSON.parse(fs.__store.get(file));
const quiet = { log: () => {}, warn: () => {} };

// A pre-#266 install: bare Raid-Helper templates, a global default template,
// the single-server block from before the event-server list.
const OLD_CONFIG = {
    categoryIds: ["c1", "c2"],
    raidDefaults: { templateId: "3", channelId: "ch" },
    discordServers: { eventGuildId: "1100000000000000001", talkGuildId: "1100000000000000002", talkOverviewChannelId: "1100000000000000003" },
};
const OLD_TEMPLATES = { templates: [{ id: "3", name: "GDKP Kara", createdAt: 5, updatedAt: 6 }] };

beforeEach(() => {
    fs.__store.clear();
});

describe("web/settingsMigration migrateSettings (#420)", () => {
    it("upgrades an old install once and logs every change", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(OLD_CONFIG));
        fs.__store.set(TEMPLATES_FILE, JSON.stringify(OLD_TEMPLATES));
        const log = jest.fn();
        const { changes } = migrateSettings({ log });
        expect(changes).toHaveLength(3);
        expect(log).toHaveBeenCalledTimes(3);
        expect(log.mock.calls.every(([line]) => line.startsWith("[settings] Migration: "))).toBe(true);

        expect(stored(TEMPLATES_FILE).templates[0]).toMatchObject({ id: "rh-3", raidhelperTemplateId: "3" });
        const config = stored(CONFIG_FILE);
        expect(config.discordServers.eventGuilds).toEqual([
            { guildId: "1100000000000000001", label: "", overviewGuildId: "1100000000000000002", overviewChannelId: "1100000000000000003" },
        ]);
        expect(config.categoryRaidTemplate).toEqual({ c1: "rh-3", c2: "rh-3" });
        // everything else stays as it was
        expect(config.raidDefaults).toEqual(OLD_CONFIG.raidDefaults);
        expect(getConfig().categoryRaidTemplate).toEqual({ c1: "rh-3", c2: "rh-3" });
        expect(getConfig().discordServers.eventGuilds).toHaveLength(1);
        expect(listRaidTemplates()[0].id).toBe("rh-3");
    });

    it("the second start finds nothing: no change, no write, no log", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(OLD_CONFIG));
        fs.__store.set(TEMPLATES_FILE, JSON.stringify(OLD_TEMPLATES));
        migrateSettings(quiet);
        const before = [fs.__store.get(CONFIG_FILE), fs.__store.get(TEMPLATES_FILE)];
        fs.writeFileSync.mockClear();
        const log = jest.fn();
        expect(migrateSettings({ log })).toEqual({ changes: [] });
        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
        expect([fs.__store.get(CONFIG_FILE), fs.__store.get(TEMPLATES_FILE)]).toEqual(before);
    });

    it("writes nothing for a fresh install", () => {
        expect(migrateSettings(quiet)).toEqual({ changes: [] });
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it("never throws: a failure is logged and reported", () => {
        fs.__store.set(TEMPLATES_FILE, JSON.stringify(OLD_TEMPLATES));
        fs.writeFileSync.mockImplementationOnce(() => { throw new Error("disk full"); });
        const warn = jest.fn();
        const result = migrateSettings({ log: () => {}, warn });
        expect(result.error.message).toBe("disk full");
        expect(warn).toHaveBeenCalledWith("[settings] Migration fehlgeschlagen: disk full");
    });

    it("logs to the console by default", () => {
        fs.__store.set(TEMPLATES_FILE, JSON.stringify(OLD_TEMPLATES));
        const spy = jest.spyOn(console, "log").mockImplementation(() => {});
        migrateSettings();
        expect(spy).toHaveBeenCalledWith(expect.stringContaining("raid-templates.json"));
        spy.mockRestore();
    });
});

describe("web/settingsMigration steps", () => {
    it("legacyEventGuilds builds one entry from an event server, none without", () => {
        expect(legacyEventGuilds({ eventGuildId: " 111111 " })).toEqual([{ guildId: "111111", label: "", overviewGuildId: "", overviewChannelId: "" }]);
        expect(legacyEventGuilds({ talkGuildId: "222222" })).toEqual([]);
        expect(legacyEventGuilds(undefined)).toEqual([]);
    });

    it("migrateDiscordServers leaves a list, a missing block and a block without event server alone", () => {
        expect(migrateDiscordServers({ eventGuilds: [], eventGuildId: "111111" })).toBeNull();
        expect(migrateDiscordServers(undefined)).toBeNull();
        expect(migrateDiscordServers(["x"])).toBeNull();
        expect(migrateDiscordServers({ talkGuildId: "222222" })).toBeNull();
        expect(migrateDiscordServers({ eventGuildId: "111111", talkPingChannelId: "5" })).toMatchObject({ talkPingChannelId: "5", eventGuilds: [{ guildId: "111111" }] });
    });

    it("migrateCategoryRaidTemplate only upgrades a config without a map whose default a template links", () => {
        const templates = [{ id: "rh-3", raidhelperTemplateId: "3" }];
        expect(migrateCategoryRaidTemplate({ categoryIds: ["a"], raidDefaults: { templateId: "3" } }, templates)).toEqual({ a: "rh-3" });
        expect(migrateCategoryRaidTemplate({ categoryIds: ["a"], raidDefaults: { templateId: "3" }, categoryRaidTemplate: {} }, templates)).toBeNull();
        expect(migrateCategoryRaidTemplate({ categoryIds: ["a"], raidDefaults: { templateId: "99" } }, templates)).toBeNull();
        expect(migrateCategoryRaidTemplate({ categoryIds: ["a"] }, templates)).toBeNull();
        // no category list stored: the default categories get it, like before
        expect(Object.values(migrateCategoryRaidTemplate({ raidDefaults: { templateId: "3" } }, templates)).every((id) => id === "rh-3")).toBe(true);
    });
});
