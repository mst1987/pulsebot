// settingsMigration (#924): the application channel, the officer role, the raid
// defaults, the bot language and the two signup channels of the server block
// move from config.json's global fields into serverSettings. A channel or role
// goes to the server it lives on (as far as the stores tell), else to the first
// server; raid defaults and language are copied onto every known server. The
// global fields go in the same write that stores the server blocks.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const { migrateServerDefaults, migrateSettings } = require("../../src/stores/settingsMigration");
const configStore = require("../../src/stores/configStore");
const eventStore = require("../../src/stores/eventStore");
const roleMessageStore = require("../../src/stores/roleMessageStore");

const CONFIG_FILE = settingsPath("config.json");
const MAIN = "1600000000000000001";
const PUGS = "1600000000000000002";
const CH_APPLY = "1600000000000000011";
const CH_NOTES = "1600000000000000012";
const CH_BANK = "1600000000000000013";
const CH_UNKNOWN = "1600000000000000019";
const ROLE_OFFICER = "1600000000000000021";
const stored = () => JSON.parse(fs.__store.get(CONFIG_FILE));
const save = (config) => fs.__store.set(CONFIG_FILE, JSON.stringify(config));
const TWO_SERVERS = { guildId: MAIN, discordServers: { servers: [{ guildId: MAIN, label: "Raids" }, { guildId: PUGS, label: "PuGs" }], links: [] } };

beforeEach(() => {
    fs.__store.clear();
    jest.restoreAllMocks();
});

describe("stores/settingsMigration — Standardwerte je Server (#924)", () => {
    it("puts a channel onto the server whose stores name it", () => {
        jest.spyOn(eventStore, "listEvents").mockReturnValue([{ id: "e1", guildId: PUGS, channelId: CH_APPLY }]);
        save({ ...TWO_SERVERS, applicationChannelId: CH_APPLY });
        const changes = migrateServerDefaults();
        expect(changes).toEqual([`config.json: Bewerbungen, Raid-Standardwerte, Sprache und Kanäle je Server gespeichert (#924) - applicationChannelId -> ${PUGS}`]);
        const raw = stored();
        expect(raw.serverSettings).toEqual({ [PUGS]: { applicationChannelId: CH_APPLY } });
        expect(raw).not.toHaveProperty("applicationChannelId");
    });

    it("puts an unknown channel onto the first server", () => {
        save({ ...TWO_SERVERS, applicationChannelId: CH_UNKNOWN });
        const changes = migrateServerDefaults();
        expect(changes[0]).toContain(`applicationChannelId -> ${MAIN} (erster Server)`);
        expect(stored().serverSettings).toEqual({ [MAIN]: { applicationChannelId: CH_UNKNOWN } });
    });

    it("puts a channel named on a server that is not one of ours onto the first server", () => {
        jest.spyOn(eventStore, "listEvents").mockReturnValue([{ id: "e1", guildId: "1600000000000000099", channelId: CH_APPLY }]);
        save({ ...TWO_SERVERS, applicationChannelId: CH_APPLY });
        migrateServerDefaults();
        expect(stored().serverSettings).toEqual({ [MAIN]: { applicationChannelId: CH_APPLY } });
    });

    it("puts the officer role onto the server of its role message, else the first server", () => {
        jest.spyOn(roleMessageStore, "listMessages").mockReturnValue([{ guildId: PUGS, channelId: "1600000000000000031", roles: [{ roleId: ROLE_OFFICER }] }]);
        save({ ...TWO_SERVERS, officerRoleId: ROLE_OFFICER });
        migrateServerDefaults();
        expect(stored().serverSettings).toEqual({ [PUGS]: { officerRoleId: ROLE_OFFICER } });

        jest.restoreAllMocks();
        save({ ...TWO_SERVERS, officerRoleId: ROLE_OFFICER });
        migrateServerDefaults();
        expect(stored().serverSettings).toEqual({ [MAIN]: { officerRoleId: ROLE_OFFICER } });
        expect(stored()).not.toHaveProperty("officerRoleId");
    });

    it("copies the raid defaults and the bot language onto every server", () => {
        save({ ...TWO_SERVERS, raidDefaults: { channelId: " 1600000000000000041 ", templateId: "3" }, botLanguage: "en" });
        const changes = migrateServerDefaults();
        expect(changes[0]).toContain("raidDefaults -> 2 Server, botLanguage -> 2 Server");
        const raw = stored();
        const both = { raidDefaults: { channelId: "1600000000000000041" }, botLanguage: "en" };
        expect(raw.serverSettings).toEqual({ [MAIN]: both, [PUGS]: both });
        expect(raw).not.toHaveProperty("raidDefaults");
        expect(raw).not.toHaveProperty("botLanguage");
    });

    it("moves the note and guild bank channel out of the server block", () => {
        jest.spyOn(eventStore, "listEvents").mockReturnValue([{ id: "e1", guildId: PUGS, channelId: CH_BANK }]);
        save({ ...TWO_SERVERS, discordServers: { ...TWO_SERVERS.discordServers, signupNoteChannelId: CH_NOTES, guildBankChannelId: CH_BANK } });
        migrateServerDefaults();
        const raw = stored();
        expect(raw.serverSettings).toEqual({ [MAIN]: { signupNoteChannelId: CH_NOTES }, [PUGS]: { guildBankChannelId: CH_BANK } });
        expect(raw.discordServers).not.toHaveProperty("signupNoteChannelId");
        expect(raw.discordServers).not.toHaveProperty("guildBankChannelId");
        expect(raw.discordServers.servers).toHaveLength(2);
    });

    it("leaves a value a server block already holds alone and only drops the old field", () => {
        save({ ...TWO_SERVERS, botLanguage: "en", serverSettings: { [PUGS]: { botLanguage: "de" } } });
        expect(migrateServerDefaults()).toEqual(["config.json: Bewerbungen, Raid-Standardwerte, Sprache und Kanäle je Server gespeichert (#924) - globale Altfelder entfernt"]);
        const raw = stored();
        expect(raw.serverSettings).toEqual({ [PUGS]: { botLanguage: "de" } });
        expect(raw).not.toHaveProperty("botLanguage");
    });

    it("drops an empty or malformed id without putting it anywhere", () => {
        save({ ...TWO_SERVERS, applicationChannelId: "#bewerbungen", officerRoleId: "" });
        migrateServerDefaults();
        const raw = stored();
        expect(raw.serverSettings).toEqual({});
        expect(raw).not.toHaveProperty("applicationChannelId");
        expect(raw).not.toHaveProperty("officerRoleId");
    });

    it("writes nothing for a fresh install or one with nothing to move", () => {
        expect(migrateServerDefaults()).toEqual([]);
        expect(fs.__store.has(CONFIG_FILE)).toBe(false);
        save(TWO_SERVERS);
        fs.writeFileSync.mockClear();
        expect(migrateServerDefaults()).toEqual([]);
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it("runs once in the start-up migration, the second start moves nothing", () => {
        save({ ...TWO_SERVERS, applicationChannelId: CH_UNKNOWN, botLanguage: "en" });
        migrateSettings({ log: () => {}, warn: () => {} });
        const cfg = configStore.getConfig();
        expect(cfg.serverSettings[MAIN]).toMatchObject({ applicationChannelId: CH_UNKNOWN, botLanguage: "en" });
        expect(cfg.serverSettings[PUGS]).toEqual({ botLanguage: "en" });
        expect(cfg).not.toHaveProperty("botLanguage");
        expect(migrateServerDefaults()).toEqual([]);
    });
});
