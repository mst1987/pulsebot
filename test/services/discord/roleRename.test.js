// #744: a role renamed in Discord changes its name and nothing else. Rights,
// orga, the role sync between the servers, the rosters and a category's raider
// roles all key on the role id; the name is only what a page shows.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/config/variables", () => ({ logcheckAdminIds: [], adminRoleIds: [] }));
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/services/discord/roles/guildRoles", () => ({ eventGuildIds: jest.fn(() => ["g1"]) }));
jest.mock("../../../src/services/discord/roles/memberRoles", () => ({ giveRole: jest.fn(), takeRole: jest.fn(), recentWrite: jest.fn(() => undefined) }));
jest.mock("../../../src/stores/raiderProfileStore", () => ({ getProfile: jest.fn((userId) => ({ userId, characters: [] })), firstCharacter: jest.fn(() => null) }));

const fs = require("fs");
const { getConfig } = require("../../../src/stores/settingsStore");
const discord = require("../../../src/services/discord/discord");
const userAccess = require("../../../src/services/discord/members/userAccess");
const { planRoleSync, liteMember } = require("../../../src/services/discord/roles/roleSync");
const rosterStore = require("../../../src/stores/rosterStore");
const rosterRoleSync = require("../../../src/services/roster/rosterRoleSync");
const { expectedRoleIds, syncRosterRoleIds } = require("../../../src/services/roster/categoryRoles");
const { makeClient, makeGuild, makeMember } = require("../../helpers/discordClient");

const RAIDER = "900000000000000001";
const ORGA = "900000000000000002";
const TALK_RAIDER = "900000000000000003";
const TALK_GUILD = "300000";
const G1 = { guildId: "g1" };
const CONFIG = {
    guildId: "g1",
    serverSettings: { g1: {
        orgaRoleIds: [ORGA],
        rolePermissions: { [RAIDER]: { signup: { read: true, write: true } }, [ORGA]: { raids: { read: true, write: true } } },
    } },
    categoryRoles: { "700000000000000001": [RAIDER] },
    roleSync: [{ fromGuildId: "g1", fromRoleId: RAIDER, toGuildId: TALK_GUILD, toRoleId: TALK_RAIDER, direction: "toTarget" }],
};

/** The event server with its two roles under the given names (ids never change). */
function guildNamed(raiderName, orgaName) {
    return makeGuild({
        id: "g1",
        roles: [{ id: RAIDER, name: raiderName }, { id: ORGA, name: orgaName }],
        members: [makeMember({ id: "u-raider", roleIds: [RAIDER] }), makeMember({ id: "u-orga", roleIds: [ORGA] })],
    });
}

/** A gateway member whose role cache holds full role objects, names included. */
function memberWith(id, roles) {
    return { id, user: { bot: false }, guild: { id: "g1" }, displayName: id, roles: { cache: new Map(roles.map((r) => [r.id, r])) } };
}

beforeEach(() => {
    fs.__store.clear();
    getConfig.mockReturnValue(CONFIG);
    rosterRoleSync._resetForTests();
    jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    discord.setClient(null);
    console.warn.mockRestore();
});

describe("a renamed role (#744)", () => {
    it("keeps every right and the orga mark", async () => {
        discord.setClient(makeClient({ guilds: [guildNamed("TBC Raider", "Raidleitung")] }));
        const before = { raider: await userAccess.computeAccess("u-raider", G1), orga: await userAccess.computeAccess("u-orga", G1) };
        discord.setClient(makeClient({ guilds: [guildNamed("Forever Raider", "Orga")] }));
        const after = { raider: await userAccess.computeAccess("u-raider", G1), orga: await userAccess.computeAccess("u-orga", G1) };
        expect(after).toEqual(before);
        expect(after.orga).toMatchObject({ isOrga: true, access: { raids: { read: true, write: true } } });
        expect(after.raider.access.signup).toEqual({ read: true, write: true });
    });

    it("shows the new name where a page lists the roles", () => {
        discord.setClient(makeClient({ guilds: [guildNamed("Forever Raider", "Orga")] }));
        expect(discord.listRoles("g1").map((r) => [r.id, r.name]).sort()).toEqual([[RAIDER, "Forever Raider"], [ORGA, "Orga"]]);
    });

    it("syncs the same roles between the servers", () => {
        const talk = [liteMember(memberWith("u1", []))];
        const plan = (name) => planRoleSync(CONFIG.roleSync, { g1: [liteMember(memberWith("u1", [{ id: RAIDER, name }]))], [TALK_GUILD]: talk });
        expect(plan("Forever Raider")).toEqual(plan("TBC Raider"));
        expect(plan("Forever Raider")).toEqual([{ guildId: TALK_GUILD, userId: "u1", roleId: TALK_RAIDER, name: "u1" }]);
    });

    it("leaves a roster and a category's raider roles alone", () => {
        const roster = rosterStore.createRoster({ name: "Montag", guildId: "g1", categoryId: "700000000000000001", roleIds: [RAIDER], versionId: "tbc" });
        rosterStore.upsertMember(roster.id, "u1", {});
        // Discord sends a member update when a role is renamed only with the same role ids on both sides
        const changes = rosterRoleSync.onGuildMemberUpdate(
            memberWith("u1", [{ id: RAIDER, name: "TBC Raider" }]),
            memberWith("u1", [{ id: RAIDER, name: "Forever Raider" }]),
        );
        expect(changes).toEqual([]);
        expect(Object.keys(rosterStore.getRoster(roster.id).members)).toEqual(["u1"]);
        expect(expectedRoleIds("700000000000000001", CONFIG)).toEqual([RAIDER]);
        // saving the settings again changes no roster
        expect(syncRosterRoleIds(CONFIG.categoryRoles)).toEqual([]);
    });
});
