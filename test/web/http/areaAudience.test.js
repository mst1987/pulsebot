// Who may open each menu area — the client's "Orga-Bereich" mark reads it.
const { areaAudience } = require("../../../src/web/http/areaAudience");
const { AREA_IDS } = require("../../../src/config/permissions");

describe("areaAudience", () => {
    it("calls an area of the base access everyone's, the others the orga's with their readers", () => {
        const audience = areaAudience({
            baseAccess: { signup: { read: true, write: true }, loot: { read: true, write: false } },
            adminRoleIds: ["admin"],
            rolePermissions: {
                lead: { raids: { read: false, write: true }, roster: { read: true, write: false } },
                raider: { raids: { read: true, write: false } },
                admin: { settings: { read: true, write: true } },
            },
            userPermissions: { 1: { kader: { read: true, write: true } }, 2: { kader: { read: true, write: false } } },
        }, [{ id: "lead", name: "Raidleitung" }, { id: "raider", name: "Mo Raider" }]);

        expect(Object.keys(audience)).toEqual(AREA_IDS);
        expect(audience.signup).toEqual({ everyone: true, roles: [], writers: [], accounts: 0 });
        expect(audience.loot.everyone).toBe(true);
        // write implies read; names sorted
        expect(audience.raids).toEqual({ everyone: false, roles: ["Mo Raider", "Raidleitung"], writers: ["Raidleitung"], accounts: 0 });
        expect(audience.roster).toEqual({ everyone: false, roles: ["Raidleitung"], writers: [], accounts: 0 });
        // admin roles see all and are not listed
        expect(audience.settings).toEqual({ everyone: false, roles: [], writers: [], accounts: 0 });
        expect(audience.kader).toEqual({ everyone: false, roles: [], writers: [], accounts: 2 });
    });

    it("keeps a role the bot does not know by its id, and copes with an empty config", () => {
        expect(areaAudience({ rolePermissions: { 123: { cla: { read: true } } } }).cla.roles).toEqual(["123"]);
        expect(areaAudience(null).raids).toEqual({ everyone: false, roles: [], writers: [], accounts: 0 });
    });
});
