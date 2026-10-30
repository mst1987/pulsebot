// The one rule for the Vermerke short form (#981): every answer that carries it asks maySeeShort.
const mockIsManager = jest.fn(async () => false);
jest.mock("../../../src/services/roster/categoryOrga", () => ({
    isAnyCategoryManager: (...args) => mockIsManager(...args),
    requestCache: jest.fn(() => ({})),
}));

const { maySeeShort } = require("../../../src/services/vermerke/vermerkeAccess");

const RAIDER = { id: "r1", isAdmin: false, access: { raids: { read: true, write: false } } };
const ORGA_NO_WRITE = { id: "o1", isAdmin: false, isOrga: true, access: { raids: { read: true, write: false } } };
const ORGA = { id: "o2", isAdmin: false, isOrga: true, access: { raids: { read: true, write: true } } };
const NOTES_READER = { id: "n1", isAdmin: false, access: { vermerke: { read: true, write: false } } };
// raids write alone is no orga rank: raider roles may hold it too
const RAIDS_WRITER = { id: "w1", isAdmin: false, access: { raids: { read: true, write: true } } };
const KADER_READER = { id: "k1", isAdmin: false, access: { kader: { read: true, write: false } } };

beforeEach(() => {
    mockIsManager.mockReset();
    mockIsManager.mockResolvedValue(false);
});

describe("maySeeShort", () => {
    it("says no without a user", async () => {
        expect(await maySeeShort(null, "g1")).toBe(false);
        expect(mockIsManager).not.toHaveBeenCalled();
    });

    it("says yes for the area vermerke (read) and for an admin", async () => {
        expect(await maySeeShort(NOTES_READER, "g1")).toBe(true);
        expect(await maySeeShort({ id: "a1", isAdmin: true }, "g1")).toBe(true);
    });

    it("says yes for the orga with raids write, no for the orga without it", async () => {
        expect(await maySeeShort(ORGA, "g1")).toBe(true);
        expect(await maySeeShort(ORGA_NO_WRITE, "g1")).toBe(false);
    });

    it("never lets an area right alone through", async () => {
        expect(await maySeeShort(RAIDS_WRITER, "g1")).toBe(false);
        expect(await maySeeShort(KADER_READER, "g1")).toBe(false);
        expect(await maySeeShort(RAIDER, "g1")).toBe(false);
    });

    it("says yes for a roster manager on the named server only", async () => {
        mockIsManager.mockResolvedValue(true);
        expect(await maySeeShort(RAIDER, "g1")).toBe(true);
        expect(mockIsManager).toHaveBeenCalledWith(RAIDER, expect.objectContaining({ guildId: "g1" }));
        mockIsManager.mockClear();
        expect(await maySeeShort(RAIDER, "")).toBe(false);
        expect(mockIsManager).not.toHaveBeenCalled();
    });
});
