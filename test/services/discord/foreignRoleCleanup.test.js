jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());

const fs = require("fs");
const { settingsPath } = require("../../../src/config/paths");
const configStore = require("../../../src/stores/configStore");
const { cleanForeignRoles, loadedRoleIds, foreignRolesOf } = require("../../../src/services/discord/foreignRoleCleanup");

const FILE = settingsPath("config.json");
const A = "111111111111111111";
const B = "222222222222222222";
const ORGA_A = "300000000000000001";
const RAID_A = "300000000000000002";
const ORGA_B = "400000000000000001";
const GONE = "500000000000000001"; // a role no server knows (deleted, or not delivered)

const writeFile = (value) => fs.__store.set(FILE, JSON.stringify(value));
const readFile = () => JSON.parse(fs.__store.get(FILE));

/** A client holding the guilds: id -> { roles: [...], available } */
function clientWith(guilds) {
    return { guilds: { cache: new Map(Object.entries(guilds).map(([id, g]) => [id, {
        id, available: g.available, roles: { cache: new Map((g.roles || []).map((r) => [r, { id: r }])) },
    }])) } };
}

// the rights as the migration left them: the old global ones copied onto both servers
const copied = () => ({
    rolePermissions: { [ORGA_A]: { loot: { read: true, write: true } }, [RAID_A]: { loot: { read: true } }, [ORGA_B]: { kader: { read: true } }, [GONE]: { loot: { read: true } } },
    orgaRoleIds: [ORGA_A, ORGA_B, GONE],
    baseAccess: { loot: { read: true } },
});
function base(extra = {}) {
    return {
        discordServers: { servers: [{ guildId: A, label: "A" }, { guildId: B, label: "B" }] },
        serverSettings: { [A]: copied(), [B]: copied() },
        ...extra,
    };
}
const both = () => clientWith({ [A]: { roles: [A, ORGA_A, RAID_A] }, [B]: { roles: [B, ORGA_B] } });

beforeEach(() => {
    fs.__store.clear();
    configStore.useFile(null);
});

describe("services/discord/foreignRoleCleanup (#925)", () => {
    it("takes each server's foreign roles out and keeps its own, the unknown and every other right", () => {
        writeFile(base());
        const log = jest.fn();
        const { removed } = cleanForeignRoles(both(), { log });
        expect(removed).toEqual({ [A]: [ORGA_B], [B]: [ORGA_A, RAID_A] });
        const { serverSettings: s } = readFile();
        expect(Object.keys(s[A].rolePermissions).sort()).toEqual([ORGA_A, RAID_A, GONE].sort());
        expect(s[A].orgaRoleIds).toEqual([ORGA_A, GONE]);
        expect(Object.keys(s[B].rolePermissions).sort()).toEqual([ORGA_B, GONE].sort());
        expect(s[B].orgaRoleIds).toEqual([ORGA_B, GONE]);
        // what a role grants on its own server is untouched
        expect(s[A].rolePermissions[ORGA_A]).toEqual(copied().rolePermissions[ORGA_A]);
        expect(s[B].rolePermissions[ORGA_B]).toEqual(copied().rolePermissions[ORGA_B]);
        expect(s[A].baseAccess).toEqual(copied().baseAccess);
        expect(log).toHaveBeenCalledWith(expect.stringContaining("3 Rollen anderer Server"));
    });

    it("is idempotent: a second run removes and writes nothing", () => {
        writeFile(base());
        cleanForeignRoles(both());
        const after = fs.__store.get(FILE);
        const log = jest.fn();
        const spy = jest.spyOn(configStore, "writeStored");
        expect(cleanForeignRoles(both(), { log }).removed).toEqual({});
        expect(spy).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
        expect(fs.__store.get(FILE)).toBe(after);
        spy.mockRestore();
    });

    it("removes nothing from an unavailable server", () => {
        writeFile(base());
        const client = clientWith({ [A]: { roles: [A, ORGA_A, RAID_A], available: false }, [B]: { roles: [B, ORGA_B] } });
        const { removed } = cleanForeignRoles(client);
        // A is unsure, and B keeps A's roles too: with A unavailable they are not demonstrably A's
        expect(removed).toEqual({});
        expect(readFile().serverSettings).toEqual(base().serverSettings);
    });

    it("removes nothing from a server whose role cache is empty or that the bot does not hold", () => {
        writeFile(base());
        expect(cleanForeignRoles(clientWith({ [A]: { roles: [] }, [B]: { roles: [B, ORGA_B] } })).removed).toEqual({});
        expect(cleanForeignRoles(clientWith({ [B]: { roles: [B, ORGA_B] } })).removed).toEqual({});
        expect(cleanForeignRoles(null).removed).toEqual({});
        expect(readFile().serverSettings).toEqual(base().serverSettings);
    });

    it("reads the file fresh before writing: a change saved meanwhile stays", () => {
        writeFile(base());
        const real = configStore.readStored;
        let calls = 0;
        const spy = jest.spyOn(configStore, "readStored").mockImplementation(() => {
            calls += 1;
            const now = real();
            // the second read sees a grant an admin saved in between
            if (calls === 2) now.serverSettings[A].userPermissions = { u1: { loot: { read: true } } };
            return now;
        });
        cleanForeignRoles(both());
        spy.mockRestore();
        expect(readFile().serverSettings[A].userPermissions).toEqual({ u1: { loot: { read: true } } });
        expect(readFile().serverSettings[A].orgaRoleIds).toEqual([ORGA_A, GONE]);
    });

    it("warns instead of throwing when the file cannot be read", () => {
        const spy = jest.spyOn(configStore, "readStored").mockImplementation(() => { throw new Error("broken"); });
        const warn = jest.fn();
        expect(cleanForeignRoles(both(), { warn }).removed).toEqual({});
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("broken"));
        spy.mockRestore();
    });

    it("loadedRoleIds / foreignRolesOf: unsure means null, unknown roles are never foreign", () => {
        expect(loadedRoleIds(both(), A)).toEqual(new Set([A, ORGA_A, RAID_A]));
        expect(loadedRoleIds(clientWith({ [A]: { roles: [A], available: false } }), A)).toBeNull();
        expect(loadedRoleIds(clientWith({ [A]: { roles: [] } }), A)).toBeNull();
        expect(foreignRolesOf({ orgaRoleIds: [ORGA_B, GONE] }, new Set([A]), [new Set([ORGA_B])])).toEqual([ORGA_B]);
        expect(foreignRolesOf({}, new Set([A]), [])).toEqual([]);
    });
});
