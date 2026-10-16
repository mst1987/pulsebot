// Who is the orga of one raid (#727): web/events/raidOrgaAccess.js - the global orga with `raids` write,
// else the manager path of categoryOrga.canOrgaEvent (its own tests: test/services/roster/categoryOrga.test.js,
// mocked here) with the request's cache and, when given, the event groups for a Raid-Helper event.
const mockCanOrgaEvent = jest.fn(async () => false);
jest.mock("../../../src/services/roster/categoryOrga", () => ({
    ...jest.requireActual("../../../src/services/roster/categoryOrga"),
    canOrgaEvent: (...a) => mockCanOrgaEvent(...a),
}));

const { isGlobalRaidOrga, canOrgaRaid } = require("../../../src/web/events/raidOrgaAccess");
const { requestCache } = require("../../../src/services/roster/categoryOrga");

const write = { raids: { read: true, write: true } };
const read = { raids: { read: true, write: false } };
const ORGA = { id: "o", isAdmin: false, isOrga: true, access: write };
const ORGA_READ = { id: "o2", isAdmin: false, isOrga: true, access: read };
const WRITER = { id: "w", isAdmin: false, access: write };
const MANAGER = { id: "mgr", isAdmin: false, access: read };

beforeEach(() => {
    jest.clearAllMocks();
    mockCanOrgaEvent.mockResolvedValue(false);
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
});
