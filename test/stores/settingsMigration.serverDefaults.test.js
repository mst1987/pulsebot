// settingsMigration (#924): the application channel, the officer role, the raid
// defaults and the two signup channels of the server block move from
// config.json's global fields into serverSettings. A channel or role (and the
// raid defaults' preset channel) goes to the server it lives on (as far as the
// stores tell), else to the first server only (the other servers stay empty and
// show "no channel"). The global fields go in the same write that stores the
// server blocks. The bot language stays global: it is the default every server
// without its own inherits.
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
        expect(changes).toEqual([`config.json: Bewerbungen, Raid-Standardwerte und Kanäle je Server gespeichert (#924) - applicationChannelId -> ${PUGS}`]);
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

    it("puts the raid defaults' preset channel onto its server and keeps the bot language as the global default", () => {
        jest.spyOn(eventStore, "listEvents").mockReturnValue([{ id: "e1", guildId: PUGS, channelId: "1600000000000000041" }]);
        save({ ...TWO_SERVERS, raidDefaults: { channelId: " 1600000000000000041 ", templateId: "3" }, botLanguage: "en" });
        const changes = migrateServerDefaults();
        expect(changes[0]).toContain(`raidDefaults -> ${PUGS}`);
        expect(changes[0]).not.toContain("botLanguage");
        const raw = stored();
        expect(raw.serverSettings).toEqual({ [PUGS]: { raidDefaults: { channelId: "1600000000000000041" } } });
        expect(raw).not.toHaveProperty("raidDefaults");
        // no server gets an own language: every one keeps speaking the old global value
        expect(raw.botLanguage).toBe("en");
    });

    it("puts an unknown preset channel onto the first server and drops raid defaults without one", () => {
        save({ ...TWO_SERVERS, raidDefaults: { channelId: CH_UNKNOWN } });
        expect(migrateServerDefaults()[0]).toContain(`raidDefaults -> ${MAIN} (erster Server)`);
        expect(stored().serverSettings).toEqual({ [MAIN]: { raidDefaults: { channelId: CH_UNKNOWN } } });

        save({ ...TWO_SERVERS, raidDefaults: { channelId: "" } });
        migrateServerDefaults();
        expect(stored().serverSettings).toEqual({});
        expect(stored()).not.toHaveProperty("raidDefaults");
    });

    it("moves the note and guild bank channel out of the server block, an unplaceable one onto the first server only", () => {
        jest.spyOn(eventStore, "listEvents").mockReturnValue([{ id: "e1", guildId: PUGS, channelId: CH_BANK }]);
        save({ ...TWO_SERVERS, discordServers: { ...TWO_SERVERS.discordServers, signupNoteChannelId: CH_NOTES, guildBankChannelId: CH_BANK } });
        const changes = migrateServerDefaults();
        expect(changes[0]).toContain(`signupNoteChannelId -> ${MAIN} (erster Server)`);
        expect(changes[0]).toContain(`guildBankChannelId -> ${PUGS}`);
        const raw = stored();
        expect(raw.serverSettings).toEqual({
            [MAIN]: { signupNoteChannelId: CH_NOTES },
            [PUGS]: { guildBankChannelId: CH_BANK },
        });
        expect(raw.discordServers).not.toHaveProperty("signupNoteChannelId");
        expect(raw.discordServers).not.toHaveProperty("guildBankChannelId");
        expect(raw.discordServers.servers).toHaveLength(2);
    });

    it("leaves a value a server block already holds alone and only drops the old field", () => {
        save({ ...TWO_SERVERS, applicationChannelId: CH_APPLY, serverSettings: { [PUGS]: { applicationChannelId: CH_UNKNOWN } } });
        expect(migrateServerDefaults()).toEqual(["config.json: Bewerbungen, Raid-Standardwerte und Kanäle je Server gespeichert (#924) - globale Altfelder entfernt"]);
        const raw = stored();
        expect(raw.serverSettings).toEqual({ [PUGS]: { applicationChannelId: CH_UNKNOWN } });
        expect(raw).not.toHaveProperty("applicationChannelId");
    });

    it("keeps an own server language and the global default side by side, and moves nothing for them", () => {
        save({ ...TWO_SERVERS, botLanguage: "en", serverSettings: { [PUGS]: { botLanguage: "de" } } });
        expect(migrateServerDefaults()).toEqual([]);
        const raw = stored();
        expect(raw.botLanguage).toBe("en");
        expect(raw.serverSettings).toEqual({ [PUGS]: { botLanguage: "de" } });
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
        expect(cfg.serverSettings[MAIN]).toMatchObject({ applicationChannelId: CH_UNKNOWN });
        expect(cfg.serverSettings[MAIN]).not.toHaveProperty("botLanguage");
        expect(cfg.serverSettings).not.toHaveProperty(PUGS);
        expect(cfg.botLanguage).toBe("en");
        expect(migrateServerDefaults()).toEqual([]);
    });

    it("runs together with the Raid-Helper move (#927): both land in the same server blocks", () => {
        save({ ...TWO_SERVERS, applicationChannelId: CH_UNKNOWN, botLanguage: "en", raidhelperServerId: PUGS });
        const res = migrateSettings({ log: () => {}, warn: () => {} });
        expect(res.error).toBeUndefined();
        const raw = stored();
        expect(raw.serverSettings[MAIN]).toEqual({ applicationChannelId: CH_UNKNOWN });
        expect(raw.serverSettings[PUGS]).toMatchObject({ raidhelper: { enabled: true, envKey: true, serverId: "" } });
        expect(raw).not.toHaveProperty("applicationChannelId");
        expect(raw.botLanguage).toBe("en");
        expect(res.changes.some((c) => c.includes("(#924)"))).toBe(true);
        expect(res.changes.some((c) => c.includes(`Raid-Helper dem Server ${PUGS}`))).toBe(true);
    });

    it("logs the old values when the move fails and keeps them readable", () => {
        const write = configStore.writeStored;
        jest.spyOn(configStore, "writeStored").mockImplementation((data) => {
            if (data && data.serverSettings) throw new Error("disk full");
            return write(data);
        });
        save({ ...TWO_SERVERS, applicationChannelId: CH_APPLY, botLanguage: "en", discordServers: { ...TWO_SERVERS.discordServers, guildBankChannelId: CH_BANK } });
        const warn = jest.fn();
        const res = migrateSettings({ log: () => {}, warn });
        expect(res.error).toBeInstanceOf(Error);
        const line = warn.mock.calls.map((c) => c[0]).find((l) => l.includes("Migration #924 fehlgeschlagen"));
        expect(line).toContain(`"applicationChannelId":"${CH_APPLY}"`);
        expect(line).not.toContain("botLanguage");
        expect(line).toContain(`"discordServers.guildBankChannelId":"${CH_BANK}"`);
        // nothing moved, so the global fields stay visible and survive a save
        const cfg = configStore.getConfig();
        expect(cfg.applicationChannelId).toBe(CH_APPLY);
        expect(cfg.botLanguage).toBe("en");
    });
});
