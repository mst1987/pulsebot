// Who is the orga of one raid (#727): web/events/raidOrgaAccess.js - the global orga with `raids` write,
// else the manager path of categoryOrga.canOrgaEvent (its own tests: test/services/roster/categoryOrga.test.js,
// mocked here) with the request's cache and, when given, the event groups for a Raid-Helper event.
const mockCanOrgaEvent = jest.fn(async () => false);
const mockIsAnyCategoryManager = jest.fn(async () => false);
jest.mock("../../../src/services/roster/categoryOrga", () => ({
    ...jest.requireActual("../../../src/services/roster/categoryOrga"),
    canOrgaEvent: (...a) => mockCanOrgaEvent(...a),
    isAnyCategoryManager: (...a) => mockIsAnyCategoryManager(...a),
}));

const { isGlobalRaidOrga, canOrgaRaid, canCreateRaids, withOrgaFlags } = require("../../../src/web/events/raidOrgaAccess");
const { requestCache } = require("../../../src/services/roster/categoryOrga");

const write = { raids: { read: true, write: true } };
const read = { raids: { read: true, write: false } };
const ORGA = { id: "o", isAdmin: false, isOrga: true, access: write };
const ORGA_READ = { id: "o2", isAdmin: false, isOrga: true, access: read };
const WRITER = { id: "w", isAdmin: false, access: write };
const MANAGER = { id: "mgr", isAdmin: false, access: read };

beforeEach(() => {
    jest.clearAllMocks();
    mockCanOrgaEvent.mockReset();
    mockCanOrgaEvent.mockResolvedValue(false);
    mockIsAnyCategoryManager.mockResolvedValue(false);
});

describe("web/events/raidOrgaAccess", () => {
    it("isGlobalRaidOrga: an orga rank and `raids` write, or a full admin", () => {
        expect(isGlobalRaidOrga(ORGA)).toBe(true);
        expect(isGlobalRaidOrga({ id: "a", isAdmin: true })).toBe(true);
        expect(isGlobalRaidOrga(ORGA_READ)).toBe(false);
        expect(isGlobalRaidOrga(WRITER)).toBe(false);
        expect(isGlobalRaidOrga(null)).toBe(false);
    });

    it("lets the global orga in without asking a roster", async () => {
        expect(await canOrgaRaid(ORGA, "eh-1", {})).toBe(true);
        expect(mockCanOrgaEvent).not.toHaveBeenCalled();
    });

    it("asks everybody else the manager path for the event's id only, with the request's cache", async () => {
        const req = {};
        mockCanOrgaEvent.mockResolvedValueOnce(true);
        expect(await canOrgaRaid(MANAGER, { id: "eh-1", categoryId: "elsewhere" }, req)).toBe(true);
        expect(mockCanOrgaEvent).toHaveBeenCalledWith(MANAGER, "eh-1", { cache: requestCache(req), managerOnly: true });
        expect(await canOrgaRaid(WRITER, "eh-1", req)).toBe(false);
        expect(await canOrgaRaid(null, "eh-1", req)).toBe(false);
        expect(await canOrgaRaid(MANAGER, "", req)).toBe(false);
        expect(await canOrgaRaid(MANAGER, { categoryId: "cat1" }, req)).toBe(false);
    });

    it("hands the event groups on for a Raid-Helper event", async () => {
        const loadGroups = jest.fn();
        await canOrgaRaid(MANAGER, "1400000000000000001", {}, { loadGroups });
        expect(mockCanOrgaEvent).toHaveBeenCalledWith(MANAGER, "1400000000000000001", expect.objectContaining({ loadGroups, managerOnly: true }));
    });

    // #729: the client's buttons follow these
    it("canCreateRaids: the global orga with `raids` write, else whoever manages a current roster", async () => {
        expect(await canCreateRaids(ORGA, {})).toBe(true);
        expect(mockIsAnyCategoryManager).not.toHaveBeenCalled();
        mockIsAnyCategoryManager.mockResolvedValueOnce(true);
        expect(await canCreateRaids(MANAGER, {})).toBe(true);
        expect(await canCreateRaids(WRITER, {})).toBe(false);
        expect(await canCreateRaids(null, {})).toBe(false);
    });

    it("withOrgaFlags: every row for the global orga, none for who manages nothing, else per row", async () => {
        const rows = [{ id: "eh-1" }, { id: "rh-2" }];
        expect(await withOrgaFlags(ORGA, rows, {})).toEqual([{ id: "eh-1", canOrga: true }, { id: "rh-2", canOrga: true }]);
        expect(await withOrgaFlags(WRITER, rows, {})).toEqual([{ id: "eh-1", canOrga: false }, { id: "rh-2", canOrga: false }]);
        expect(mockCanOrgaEvent).not.toHaveBeenCalled();
        mockIsAnyCategoryManager.mockResolvedValue(true);
        mockCanOrgaEvent.mockImplementation(async (user, id) => id === "rh-2");
        const groups = [{ categoryId: "cat1", events: [{ id: "rh-2" }] }];
        expect(await withOrgaFlags(MANAGER, rows, {}, { groups })).toEqual([{ id: "eh-1", canOrga: false }, { id: "rh-2", canOrga: true }]);
        // a Raid-Helper row is found in the list's own groups, no second request
        const opts = mockCanOrgaEvent.mock.calls[1][2];
        expect(await opts.loadGroups()).toEqual({ groups });
        expect(await withOrgaFlags(MANAGER, null, {})).toEqual([]);
    });

    it("withOrgaFlags: a global orga without `raids` write that manages a roster acts on its own raids (review #729)", async () => {
        const ORGA_MGR = { ...ORGA_READ, id: "mgr" };
        mockIsAnyCategoryManager.mockResolvedValue(true);
        mockCanOrgaEvent.mockImplementation(async (user, id) => id === "eh-1");
        expect(await withOrgaFlags(ORGA_MGR, [{ id: "eh-1" }, { id: "eh-2" }], {})).toEqual([{ id: "eh-1", canOrga: true }, { id: "eh-2", canOrga: false }]);
        // the manager path, never the global one
        expect(mockCanOrgaEvent.mock.calls.every(([, , o]) => o.managerOnly === true)).toBe(true);
    });
});
