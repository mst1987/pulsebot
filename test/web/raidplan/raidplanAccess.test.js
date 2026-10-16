// Who may edit the raid plan of a raid (src/web/raidplan/raidplanAccess.js, #726): `raidplan` write for
// every raid, else the manager of the raid's category (categoryOrga.canOrgaEvent, `managerOnly`) - the
// rule of the plan routes' gate (withUser `orgaScoped` + `globalByWrite`), per event.
jest.mock("../../../src/services/roster/categoryOrga", () => {
    const caches = new WeakMap();
    return {
        requestCache: jest.fn((req) => {
            if (!caches.has(req)) caches.set(req, { roles: new Map() });
            return caches.get(req);
        }),
        canOrgaEvent: jest.fn(async (user, event, opts) => {
            if (opts && opts.loadGroups) await opts.loadGroups();
            return user.id === "mgr" && event === "mine";
        }),
    };
});
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));
jest.mock("../../../src/services/events/raidEventGroups", () => ({
    loadEventGroups: jest.fn(async () => ({ groups: [] })),
    eventLookbackSince: jest.fn(() => 42),
}));

const categoryOrga = require("../../../src/services/roster/categoryOrga");
const { loadEventGroups } = require("../../../src/services/events/raidEventGroups");
const { emptyAccess } = require("../../../src/config/permissions");
const { canWriteLibrary, managesRaid, canWriteRaidplan } = require("../../../src/web/raidplan/raidplanAccess");

const user = (id, grants = {}, extra = {}) => ({ id, isAdmin: false, access: { ...emptyAccess(), ...grants }, ...extra });
const WRITER = user("tac", { raidplan: { read: true, write: true } });
const MANAGER = user("mgr", { raidplan: { read: true, write: false } });
const ORGA_READ = user("mgr", { raidplan: { read: true, write: false } }, { isOrga: true });

beforeEach(() => jest.clearAllMocks());

describe("web/raidplan/raidplanAccess", () => {
    it("gives `raidplan` write every plan and the library, without asking any roster", async () => {
        expect(canWriteLibrary(WRITER)).toBe(true);
        expect(await canWriteRaidplan(WRITER, "foreign", {})).toBe(true);
        expect(await canWriteRaidplan({ id: "a", isAdmin: true }, "foreign", {})).toBe(true);
        expect(categoryOrga.canOrgaEvent).not.toHaveBeenCalled();
    });

    it("gives the manager of the raid's category its plan only, never the library", async () => {
        const req = {};
        expect(await canWriteRaidplan(MANAGER, "mine", req)).toBe(true);
        expect(await canWriteRaidplan(MANAGER, { id: "mine" }, req)).toBe(true);
        expect(await canWriteRaidplan(MANAGER, "foreign", req)).toBe(false);
        expect(canWriteLibrary(MANAGER)).toBe(false);
        // the category path: the roster only, with the request's cache and the caller's event groups
        for (const [, , opts] of categoryOrga.canOrgaEvent.mock.calls) {
            expect(opts.managerOnly).toBe(true);
            expect(opts.cache).toBe(categoryOrga.requestCache(req));
        }
        expect(loadEventGroups).toHaveBeenCalledWith("g1", { sinceSeconds: 42 });
    });

    it("takes the category path for a global orga without `raidplan` write, as the gate does", async () => {
        expect(await canWriteRaidplan(ORGA_READ, "mine", {})).toBe(true);
        expect(await canWriteRaidplan(ORGA_READ, "foreign", {})).toBe(false);
        expect(canWriteLibrary(ORGA_READ)).toBe(false);
    });

    it("answers false without a user or an event", async () => {
        expect(await canWriteRaidplan(null, "mine", {})).toBe(false);
        expect(await managesRaid(MANAGER, "", {})).toBe(false);
        expect(await managesRaid(MANAGER, { id: "  " }, {})).toBe(false);
        expect(await managesRaid(null, "mine", {})).toBe(false);
        expect(canWriteLibrary(null)).toBe(false);
        expect(categoryOrga.canOrgaEvent).not.toHaveBeenCalled();
    });
});
