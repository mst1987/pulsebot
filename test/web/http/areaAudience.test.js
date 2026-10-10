// Who may open each menu area — the client's "Orga-Bereich" mark reads it. Which roles
// are orga is set in the settings (orgaRoleIds); every other role is a raider role.
const { areaAudience, orgaRoleNames } = require("../../../src/web/http/areaAudience");
const { AREA_IDS } = require("../../../src/config/permissions");

const CONFIG = {
    baseAccess: { signup: { read: true, write: true } },
    adminRoleIds: ["admin"],
    orgaRoleIds: ["lead", "admin"],
    rolePermissions: {
        lead: { raids: { read: true, write: true }, roster: { read: true, write: false }, cla: { read: false, write: true } },
        mo: { raids: { read: true, write: false }, loot: { read: true, write: false } },
        admin: { settings: { read: true, write: true } },
    },
    userPermissions: { 1: { kader: { read: true, write: true } }, 2: { kader: { read: true, write: false } } },
};
const ROLES = [{ id: "lead", name: "Raidleitung" }, { id: "mo", name: "Mo Raider" }, { id: "admin", name: "Gildenleitung" }];

describe("areaAudience", () => {
    const audience = areaAudience(CONFIG, ROLES);

    it("calls an area a raider page when the base access or any raider role opens it", () => {
        expect(Object.keys(audience)).toEqual(AREA_IDS);
        expect(audience.signup).toMatchObject({ everyone: true, raiders: [] });
        // "Mo Raider" is no orga role: its raids and loot are raider pages, even next to the orga's grants
        expect(audience.raids).toEqual({ everyone: true, roles: ["Raidleitung"], writers: ["Raidleitung"], raiders: ["Mo Raider"], accounts: 0 });
        expect(audience.loot).toMatchObject({ everyone: true, raiders: ["Mo Raider"] });
    });

    it("calls an area orga when only admins, orga roles and single accounts open it, naming the orga roles", () => {
        expect(audience.roster).toEqual({ everyone: false, roles: ["Raidleitung"], writers: [], raiders: [], accounts: 0 });
        // write implies read
        expect(audience.cla).toMatchObject({ everyone: false, roles: ["Raidleitung"], writers: ["Raidleitung"] });
        // admin roles see all and are not listed
        expect(audience.settings).toEqual({ everyone: false, roles: [], writers: [], raiders: [], accounts: 0 });
        expect(audience.kader).toMatchObject({ everyone: false, accounts: 2 });
    });

    it("treats every role as a raider role while no orga role is set, and copes with an empty config", () => {
        const none = areaAudience({ ...CONFIG, orgaRoleIds: [] }, ROLES);
        expect(none.roster).toMatchObject({ everyone: true, roles: [], raiders: ["Raidleitung"] });
        expect(areaAudience({ orgaRoleIds: ["123"], rolePermissions: { 123: { cla: { read: true } } } }).cla.roles).toEqual(["123"]);
        expect(areaAudience(null).raids).toEqual({ everyone: false, roles: [], writers: [], raiders: [], accounts: 0 });
    });
});

describe("orgaRoleNames", () => {
    it("names the orga roles without the admin roles, sorted, a role the bot does not know by its id", () => {
        expect(orgaRoleNames(CONFIG, ROLES)).toEqual(["Raidleitung"]);
        expect(orgaRoleNames({ orgaRoleIds: ["9", "lead", "9"] }, ROLES)).toEqual(["9", "Raidleitung"]);
        expect(orgaRoleNames(null)).toEqual([]);
    });
});
