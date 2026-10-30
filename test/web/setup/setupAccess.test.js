// Who may edit a raid's setup (#725): web/setup/setupAccess.js - the global orga with `raids` write,
// else the manager path of categoryOrga.canOrgaEvent (its own tests: test/services/roster/categoryOrga.test.js,
// mocked here) - and the "Comp" link (/e/<id>/comp, web/http/pageRoutes.js) that sends by the same rule.
const mockCanOrgaEvent = jest.fn(async () => false);
jest.mock("../../../src/services/roster/categoryOrga", () => ({
    ...jest.requireActual("../../../src/services/roster/categoryOrga"),
    canOrgaEvent: (...a) => mockCanOrgaEvent(...a),
}));
let mockUser = null;
jest.mock("../../../src/web/http/auth", () => ({ getUser: jest.fn(() => mockUser) }));
jest.mock("../../../src/stores/events/eventStore", () => ({
    ...jest.requireActual("../../../src/stores/events/eventStore"),
    getEvent: jest.fn((id) => (id === "eh-1" ? { id, categoryId: "cat1" } : null)),
}));

const { canWriteSetup, isGlobalSetupOrga } = require("../../../src/web/setup/setupAccess");
const { requestCache } = require("../../../src/services/roster/categoryOrga");
const { findPageRoute } = require("../../../src/web/http/pageRoutes");

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

describe("web/setup/setupAccess", () => {
    it("isGlobalSetupOrga: an orga rank and `raids` write, a full admin", () => {
        expect(isGlobalSetupOrga(ORGA)).toBe(true);
        expect(isGlobalSetupOrga({ id: "a", isAdmin: true })).toBe(true);
        expect(isGlobalSetupOrga(ORGA_READ)).toBe(false);
        expect(isGlobalSetupOrga(WRITER)).toBe(false);
        expect(isGlobalSetupOrga(null)).toBe(false);
    });

    it("lets the global orga in without asking a roster", async () => {
        expect(await canWriteSetup(ORGA, { id: "eh-1" }, {})).toBe(true);
        expect(mockCanOrgaEvent).not.toHaveBeenCalled();
    });

    it("asks everybody else the manager path for the event's id, with the request's cache", async () => {
        const req = {};
        mockCanOrgaEvent.mockResolvedValueOnce(true);
        expect(await canWriteSetup(MANAGER, { id: "eh-1", categoryId: "elsewhere" }, req)).toBe(true);
        // the id only - a row's category never counts (categoryOrga resolves the stored event)
        expect(mockCanOrgaEvent).toHaveBeenCalledWith(MANAGER, "eh-1", { cache: requestCache(req), managerOnly: true });
        expect(await canWriteSetup(WRITER, "eh-1", req)).toBe(false);
        // an orga rank without `raids` write: only as a manager, like the gate
        expect(await canWriteSetup(ORGA_READ, "eh-1", req)).toBe(false);
        expect(mockCanOrgaEvent).toHaveBeenLastCalledWith(ORGA_READ, "eh-1", expect.objectContaining({ managerOnly: true }));
        expect(await canWriteSetup(null, "eh-1", req)).toBe(false);
        expect(await canWriteSetup(MANAGER, "", req)).toBe(false);
    });
});

describe("/e/<id>/comp sends by the same rule", () => {
    async function comp(user) {
        mockUser = user;
        const hit = findPageRoute("GET", "/e/eh-1/comp");
        const res = { writeHead: jest.fn(), end: jest.fn() };
        await hit.route.handler({ req: { headers: {} }, res, params: hit.params });
        return res.writeHead.mock.calls[0][1].Location;
    }

    it("the orga of the raid's category lands in the setup editor", async () => {
        mockCanOrgaEvent.mockResolvedValue(true);
        expect(await comp(MANAGER)).toBe("/raids/detail?event=eh-1&tab=setup");
    });

    it("a raider role with `raids` write but no orga rank lands on the public page", async () => {
        expect(await comp(WRITER)).toBe("/e/eh-1");
        expect(await comp(ORGA)).toBe("/raids/detail?event=eh-1&tab=setup");
        expect(await comp(null)).toBe("/e/eh-1");
    });
});
