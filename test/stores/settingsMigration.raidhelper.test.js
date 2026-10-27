// settingsMigration (#927): Raid-Helper per Discord server. The server it ran
// for before keeps today's state (the old switch, the .env key through
// `envKey` - the key itself is never copied into config.json), every other
// server starts off, and the synced list and the budget of before go to that
// server. A second start changes nothing.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const { migrateRaidhelperServers } = require("../../src/stores/settingsMigration");
const configStore = require("../../src/stores/configStore");
const eventsStore = require("../../src/stores/raidhelperEventsStore");
const budgetStore = require("../../src/stores/raidhelperBudgetStore");
const { raidhelperOf, activeRaidhelperGuilds } = require("../../src/utils/raidhelper/servers");

const CONFIG_FILE = settingsPath("config.json");
const EVENTS_FILE = settingsPath("raidhelper-events.json");
const BUDGET_FILE = settingsPath("raidhelper-budget.json");
const HOME = "1400000000000000001";
const OTHER = "1400000000000000002";
const FOREIGN = "1400000000000000009";
const ENV = { RAIDHELPER_API_KEY: "fake-env-key-for-tests", RAIDHELPER_SERVER_ID: "" };
const stored = (file) => JSON.parse(fs.__store.get(file));
const servers = { servers: [{ guildId: HOME, label: "" }, { guildId: OTHER, label: "" }] };

beforeEach(() => {
    fs.__store.clear();
    configStore.useFile(null);
    eventsStore.useFile(null);
    budgetStore.useFile(null);
});

describe("stores/settingsMigration migrateRaidhelperServers (#927)", () => {
    it("hands Raid-Helper to the server it ran for, as it was, without copying the key", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: HOME, raidhelperServerId: HOME, discordServers: servers }));
        const lines = migrateRaidhelperServers({ env: ENV });
        expect(lines).toEqual([`config.json: Raid-Helper dem Server ${HOME} zugeordnet (an, Schlüssel aus .env) (#927)`]);
        const file = stored(CONFIG_FILE);
        expect(file.serverSettings[HOME].raidhelper).toEqual({ enabled: true, serverId: "", apiKey: "", envKey: true, at: 0, byName: "" });
        expect(file.serverSettings[OTHER]).toBeUndefined();
        expect(fs.__store.get(CONFIG_FILE)).not.toContain(ENV.RAIDHELPER_API_KEY);
        // the home server reads with the .env key, the other one stays off
        const config = configStore.getConfig();
        expect(raidhelperOf(HOME, config, ENV)).toMatchObject({ active: true, serverId: HOME, hasKey: true });
        expect(raidhelperOf(OTHER, config, ENV)).toMatchObject({ active: false, enabled: false, hasKey: false });
        expect(activeRaidhelperGuilds(config, ENV)).toEqual([HOME]);
    });

    it("keeps a switched-off Raid-Helper off, with who switched it off", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({
            guildId: HOME, raidhelperServerId: HOME, discordServers: servers,
            raidhelperRetirement: { disabled: true, at: 1700000000000, byName: "Orga" },
        }));
        migrateRaidhelperServers({ env: ENV });
        expect(stored(CONFIG_FILE).serverSettings[HOME].raidhelper).toMatchObject({ enabled: false, at: 1700000000000, byName: "Orga", envKey: true });
        expect(activeRaidhelperGuilds(configStore.getConfig(), ENV)).toEqual([]);
    });

    it("keeps a Raid-Helper id that is no configured server as the override on the first server (test instance)", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: HOME, raidhelperServerId: FOREIGN, discordServers: servers }));
        migrateRaidhelperServers({ env: ENV });
        expect(stored(CONFIG_FILE).serverSettings[HOME].raidhelper).toMatchObject({ enabled: true, serverId: FOREIGN });
        expect(raidhelperOf(HOME, configStore.getConfig(), ENV).serverId).toBe(FOREIGN);
    });

    it("takes the id from .env when the file names none", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: OTHER, discordServers: servers }));
        migrateRaidhelperServers({ env: { ...ENV, RAIDHELPER_SERVER_ID: OTHER } });
        expect(stored(CONFIG_FILE).serverSettings[OTHER].raidhelper).toMatchObject({ enabled: true, serverId: "" });
        expect(stored(CONFIG_FILE).serverSettings[HOME]).toBeUndefined();
    });

    it("leaves an install without Raid-Helper alone: every server off", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: HOME, discordServers: servers }));
        expect(migrateRaidhelperServers({ env: {} })).toEqual([]);
        expect(stored(CONFIG_FILE).serverSettings).toBeUndefined();
    });

    it("moves the synced list and the budget of before to that server, once", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: HOME, raidhelperServerId: HOME, discordServers: servers }));
        fs.__store.set(EVENTS_FILE, JSON.stringify({ syncedAt: 5, since: 1, events: [{ id: "e1", startTime: 1 }], error: "" }));
        fs.__store.set(BUDGET_FILE, JSON.stringify({ hours: { 10: 3 }, blockedUntil: 0, blockedReason: "" }));
        const lines = migrateRaidhelperServers({ env: ENV });
        expect(lines).toHaveLength(3);
        expect(eventsStore.readSnapshot(HOME)).toMatchObject({ syncedAt: 5, events: [{ id: "e1" }] });
        expect(eventsStore.readSnapshot(OTHER).events).toEqual([]);
        expect(budgetStore.readBudget(HOME).hours).toEqual({ 10: 3 });
        expect(budgetStore.readBudget(OTHER).hours).toEqual({});
    });

    it("changes nothing on a second start, and never overwrites a block set in the settings", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: HOME, raidhelperServerId: HOME, discordServers: servers }));
        fs.__store.set(EVENTS_FILE, JSON.stringify({ syncedAt: 5, since: 1, events: [], error: "" }));
        migrateRaidhelperServers({ env: ENV });
        const after = fs.__store.get(CONFIG_FILE);
        expect(migrateRaidhelperServers({ env: ENV })).toEqual([]);
        expect(fs.__store.get(CONFIG_FILE)).toBe(after);

        // an admin switched the home server off and the other one on with its own key
        const file = stored(CONFIG_FILE);
        file.serverSettings[HOME].raidhelper.enabled = false;
        file.serverSettings[OTHER] = { raidhelper: { enabled: true, apiKey: "other-fake-key-1234" } };
        fs.__store.set(CONFIG_FILE, JSON.stringify(file));
        configStore.useFile(null);
        expect(migrateRaidhelperServers({ env: ENV })).toEqual([]);
        expect(stored(CONFIG_FILE).serverSettings[HOME].raidhelper.enabled).toBe(false);
        expect(activeRaidhelperGuilds(configStore.getConfig(), ENV)).toEqual([OTHER]);
    });
});
