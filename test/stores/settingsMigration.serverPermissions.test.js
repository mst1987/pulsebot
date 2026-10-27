// settingsMigration (#925): the rights of before - role grants, base access,
// account grants, orga roles, bot command rules - were global. The start copies
// them onto every server, so no role gains or loses anything anywhere, and drops
// the global fields only once the copies are on disk.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../src/config/paths");
const { migrateSettings, migrateServerPermissions } = require("../../src/stores/settingsMigration");
const configStore = require("../../src/stores/configStore");
const { CONFIG_DEFAULTS } = require("../../src/stores/configSchema");
const { accessSettings } = require("../../src/services/discord/serverAccess");
const {
    accessForRoles, accessForUser, baseAccessMap, normalizeRolePermissions, normalizeUserPermissions,
} = require("../../src/config/permissions");
const { normalizeBotCommandAccess } = require("../../src/config/botCommands");

const CONFIG_FILE = settingsPath("config.json");
const A = "1400000000000000001";
const B = "1400000000000000002";
const LINKED = "1400000000000000003";
const R = (n) => `15000000000000000${String(n).padStart(2, "0")}`;
const USER = "123456789012345678";
const quiet = { log: () => {}, warn: () => {} };
const stored = () => JSON.parse(fs.__store.get(CONFIG_FILE));

// An install from before #925: every right global, two servers and a link target.
const OLD = {
    guildId: A,
    discordServers: {
        servers: [{ guildId: A, label: "Raids" }, { guildId: B, label: "PuGs" }],
        links: [{ from: A, to: LINKED, channelId: "1400000000000000011", lang: "", versions: [] }],
    },
    adminRoleIds: [R(1)],
    rolePermissions: {
        [R(2)]: { raids: { read: true, write: true }, loot: { read: true, write: false } },
        [R(3)]: { cla: { read: true, write: false } },
    },
    baseAccess: { signup: { read: true, write: true } },
    userPermissions: { [USER]: { lootcouncil: { read: true, write: true } } },
    orgaRoleIds: [R(4)],
    botCommandAccess: { fillsetup: { mode: "roles", roleIds: [R(2)] } },
    botLanguage: "de",
};
const KEYS = ["rolePermissions", "baseAccess", "userPermissions", "orgaRoleIds", "botCommandAccess"];

beforeEach(() => {
    fs.__store.clear();
    configStore.useFile(null);
});

/** What one role / account / everybody may do, read the way the code reads it. */
function rightsBefore(cfg) {
    return {
        roles: Object.fromEntries([R(1), R(2), R(3), R(4), R(9)].map((r) => [r, accessForRoles(cfg.rolePermissions, [r])])),
        user: accessForUser(cfg.userPermissions, USER),
        base: baseAccessMap(cfg.baseAccess),
        orga: [...cfg.orgaRoleIds],
        bot: normalizeBotCommandAccess(cfg.botCommandAccess),
    };
}

describe("stores/settingsMigration migrateServerPermissions (#925)", () => {
    it("changes nothing for any role: every server holds the rights of before", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(OLD));
        const before = rightsBefore(OLD);
        const lines = migrateServerPermissions();
        expect(lines).toEqual([expect.stringContaining("Rechte je Server (#925)")]);

        const cfg = configStore.getConfig();
        for (const gid of [A, B, LINKED]) {
            const one = accessSettings(gid, cfg);
            expect(rightsBefore(one)).toEqual(before);
            expect(one.rolePermissions).toEqual(normalizeRolePermissions(OLD.rolePermissions));
            expect(one.userPermissions).toEqual(normalizeUserPermissions(OLD.userPermissions));
        }
        // the full admins stay global, the rest of the file untouched
        const raw = stored();
        expect(raw.adminRoleIds).toEqual([R(1)]);
        expect(raw.botLanguage).toBe("de");
        for (const key of KEYS) expect(raw).not.toHaveProperty(key);
        // a server outside the list still gets nothing
        expect(rightsBefore(accessSettings("1400000000000000099", cfg)).roles[R(2)]).toEqual(accessForRoles({}, [R(2)]));
    });

    it("keeps what a server already holds and fills only the missing keys", () => {
        const own = { [R(7)]: { raids: { read: true, write: false } } };
        fs.__store.set(CONFIG_FILE, JSON.stringify({ ...OLD, serverSettings: { [B]: { rolePermissions: own, ianaTimezone: "Europe/Berlin" } } }));
        migrateServerPermissions();
        const raw = stored();
        expect(raw.serverSettings[B].rolePermissions).toEqual(own);
        expect(raw.serverSettings[B].ianaTimezone).toBe("Europe/Berlin");
        expect(raw.serverSettings[B].orgaRoleIds).toEqual([R(4)]);
        expect(raw.serverSettings[A].rolePermissions).toEqual(OLD.rolePermissions);
    });

    it("is idempotent: a second start finds nothing and writes nothing", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(OLD));
        migrateServerPermissions();
        const after = fs.__store.get(CONFIG_FILE);
        const spy = jest.spyOn(configStore, "writeStored");
        expect(migrateServerPermissions()).toEqual([]);
        expect(spy).not.toHaveBeenCalled();
        expect(fs.__store.get(CONFIG_FILE)).toBe(after);
        spy.mockRestore();
    });

    it("writes nothing for a config without global rights", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify({ guildId: A, adminRoleIds: [R(1)] }));
        const spy = jest.spyOn(configStore, "writeStored");
        expect(migrateServerPermissions()).toEqual([]);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it("drops the global fields only after the copies are stored", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(OLD));
        const real = configStore.writeStored;
        const writes = [];
        const spy = jest.spyOn(configStore, "writeStored").mockImplementation((value) => {
            writes.push(structuredClone(value));
            real(value);
        });
        migrateServerPermissions();
        expect(writes).toHaveLength(2);
        // first write: copies on every server, the global fields still there
        expect(writes[0].rolePermissions).toEqual(OLD.rolePermissions);
        expect(writes[0].serverSettings[A].rolePermissions).toEqual(OLD.rolePermissions);
        // second write: the global fields gone, the copies kept
        expect(writes[1]).not.toHaveProperty("rolePermissions");
        expect(writes[1].serverSettings[B].botCommandAccess).toEqual(OLD.botCommandAccess);
        spy.mockRestore();
    });

    it("keeps the global fields when the copies did not reach the disk", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(OLD));
        // a write that is lost: the file stays as it was
        const spy = jest.spyOn(configStore, "writeStored").mockImplementation(() => {});
        const lines = migrateServerPermissions();
        expect(lines).toEqual([expect.stringContaining("WARNUNG")]);
        spy.mockRestore();
        expect(stored().rolePermissions).toEqual(OLD.rolePermissions);
    });

    it("finishes a start that stopped between the two writes without touching the copies", () => {
        const copies = Object.fromEntries([A, B, LINKED].map((gid) => [gid, Object.fromEntries(KEYS.map((k) => [k, OLD[k]]))]));
        copies[B].orgaRoleIds = [R(8)];
        fs.__store.set(CONFIG_FILE, JSON.stringify({ ...OLD, serverSettings: copies }));
        migrateServerPermissions();
        const raw = stored();
        expect(raw).not.toHaveProperty("orgaRoleIds");
        expect(raw.serverSettings[B].orgaRoleIds).toEqual([R(8)]);
    });

    it("without any server keeps the rights where they are (or hands them to the home guild of .env)", () => {
        const noServer = { ...OLD };
        delete noServer.guildId;
        delete noServer.discordServers;
        fs.__store.set(CONFIG_FILE, JSON.stringify(noServer));
        const lines = migrateServerPermissions();
        const home = String(CONFIG_DEFAULTS.guildId || "");
        if (/^\d{17,20}$/.test(home)) {
            expect(stored().serverSettings[home].rolePermissions).toEqual(OLD.rolePermissions);
        } else {
            expect(lines).toEqual([expect.stringContaining("WARNUNG")]);
            expect(stored().rolePermissions).toEqual(OLD.rolePermissions);
        }
    });

    it("runs in the start migration, after the server list is settled", () => {
        fs.__store.set(CONFIG_FILE, JSON.stringify(OLD));
        const { changes, error } = migrateSettings(quiet);
        expect(error).toBeUndefined();
        expect(changes.some((line) => line.includes("Rechte je Server (#925)"))).toBe(true);
        expect(stored().serverSettings[LINKED].orgaRoleIds).toEqual([R(4)]);
    });
});
