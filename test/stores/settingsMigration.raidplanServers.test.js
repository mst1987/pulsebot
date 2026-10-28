// settingsMigration (#945): the old global raid plan library (templates, tactic profiles) goes onto every server of
// the list once at start - the home guild without a list - and a second start writes nothing.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const { migrateRaidplanServers } = require("../../src/stores/settingsMigration");
const templates = require("../../src/stores/raidplanTemplateStore");
const profiles = require("../../src/stores/raidplanProfileStore");

const CONFIG_FILE = settingsPath("config.json");
const TEMPLATES_FILE = settingsPath("raidplan-templates.json");
const PROFILES_FILE = settingsPath("raidplan-profiles.json");
const MAIN = "1600000000000000001";
const PUGS = "1600000000000000002";
const save = (file, data) => fs.__store.set(file, JSON.stringify(data));
const OLD_TEMPLATES = { templates: [{ id: "t1", name: "Montags-Raid", instanceIds: ["bt"], versionId: "tbc", bosses: {}, version: 3 }] };
const OLD_PROFILES = { profiles: [{ id: "p1", name: "Kiten", category: "Kiten", targets: [], notes: "", versionId: "tbc" }] };

beforeEach(() => {
    fs.__store.clear();
    save(TEMPLATES_FILE, OLD_TEMPLATES);
    save(PROFILES_FILE, OLD_PROFILES);
});

describe("stores/settingsMigration - Raidplan-Bibliothek je Server (#945)", () => {
    it("copies the library onto every server of the list, keeps a backup, and a second start writes nothing", () => {
        save(CONFIG_FILE, { guildId: MAIN, discordServers: { servers: [{ guildId: MAIN }, { guildId: PUGS }], links: [] } });
        const changes = migrateRaidplanServers();
        expect(changes).toHaveLength(2);
        for (const server of [MAIN, PUGS]) {
            expect(templates.listTemplates(server).map((t) => t.name)).toEqual(["Montags-Raid"]);
            expect(profiles.getProfile(server, "p1").name).toBe("Kiten");
        }
        expect(JSON.parse(fs.__store.get(`${TEMPLATES_FILE}.pre-945`))).toEqual(OLD_TEMPLATES);
        expect(JSON.parse(fs.__store.get(`${PROFILES_FILE}.pre-945`))).toEqual(OLD_PROFILES);
        const after = [fs.__store.get(TEMPLATES_FILE), fs.__store.get(PROFILES_FILE)];
        expect(migrateRaidplanServers()).toEqual([]);
        expect([fs.__store.get(TEMPLATES_FILE), fs.__store.get(PROFILES_FILE)]).toEqual(after);
    });

    it("uses the home guild without a server list", () => {
        save(CONFIG_FILE, { guildId: MAIN });
        migrateRaidplanServers();
        expect(templates.listTemplates(MAIN)).toHaveLength(1);
        expect(templates.listTemplates(PUGS)).toEqual([]);
    });
});
