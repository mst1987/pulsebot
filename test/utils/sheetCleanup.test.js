const mockListEventSheets = jest.fn();
const mockDeleteEventSheet = jest.fn();
const mockDeleteTab = jest.fn().mockResolvedValue({});

jest.mock("../../src/web/eventSheetStore", () => ({
    listEventSheets: mockListEventSheets,
    deleteEventSheet: mockDeleteEventSheet,
}));
// classes/sheets is required by sheetCleanup for its default client factory; the
// tests inject their own factory, so a light stub is enough.
jest.mock("../../src/classes/sheets", () => jest.fn());

const { sweepDueSheets, startSheetCleanup } = require("../../src/utils/sheetCleanup.js");

describe("utils/sheetCleanup", () => {
    const NOW = 1_000_000_000_000;
    // factory that records which spreadsheet a client was made for
    const makeClient = (spreadsheetId) => ({ spreadsheetId, deleteTab: (gid) => mockDeleteTab(spreadsheetId, gid) });

    beforeEach(() => {
        jest.clearAllMocks();
        mockDeleteTab.mockResolvedValue({});
    });

    it("deletes only tabs whose deleteAfter is due", async () => {
        mockListEventSheets.mockReturnValue([
            { eventId: "a", spreadsheetId: "master", sheetGid: 11, deleteAfter: NOW - 1 },   // due
            { eventId: "b", spreadsheetId: "master", sheetGid: 22, deleteAfter: NOW + 1000 }, // future
            { eventId: "c", spreadsheetId: "master", sheetGid: 33, deleteAfter: NOW },        // due (==now)
        ]);
        const deleted = await sweepDueSheets(NOW, makeClient);
        expect(deleted).toBe(2);
        expect(mockDeleteTab).toHaveBeenCalledWith("master", 11);
        expect(mockDeleteTab).toHaveBeenCalledWith("master", 33);
        expect(mockDeleteTab).not.toHaveBeenCalledWith("master", 22);
        expect(mockDeleteEventSheet).toHaveBeenCalledWith("a");
        expect(mockDeleteEventSheet).toHaveBeenCalledWith("c");
        expect(mockDeleteEventSheet).not.toHaveBeenCalledWith("b");
    });

    it("handles a gid of 0 (a valid tab id) as due", async () => {
        mockListEventSheets.mockReturnValue([
            { eventId: "a", spreadsheetId: "master", sheetGid: 0, deleteAfter: NOW - 1 },
        ]);
        expect(await sweepDueSheets(NOW, makeClient)).toBe(1);
        expect(mockDeleteTab).toHaveBeenCalledWith("master", 0);
    });

    it("skips records without a spreadsheetId, gid, or deleteAfter", async () => {
        mockListEventSheets.mockReturnValue([
            { eventId: "x", spreadsheetId: "", sheetGid: 11, deleteAfter: NOW - 1 },
            { eventId: "y", spreadsheetId: "master", sheetGid: null, deleteAfter: NOW - 1 },
            { eventId: "z", spreadsheetId: "master", sheetGid: 11, deleteAfter: 0 },
        ]);
        expect(await sweepDueSheets(NOW, makeClient)).toBe(0);
        expect(mockDeleteTab).not.toHaveBeenCalled();
    });

    it("keeps the record when the tab delete fails (retried next sweep)", async () => {
        mockListEventSheets.mockReturnValue([{ eventId: "a", spreadsheetId: "master", sheetGid: 11, deleteAfter: NOW - 1 }]);
        mockDeleteTab.mockRejectedValueOnce(new Error("boom"));
        expect(await sweepDueSheets(NOW, makeClient)).toBe(0);
        expect(mockDeleteEventSheet).not.toHaveBeenCalled();
    });

    it("startSheetCleanup runs an initial sweep and returns a timer", () => {
        mockListEventSheets.mockReturnValue([]);
        const timer = startSheetCleanup({ intervalMs: 60000 });
        expect(mockListEventSheets).toHaveBeenCalled();
        expect(timer).toBeTruthy();
        clearInterval(timer);
    });
});
