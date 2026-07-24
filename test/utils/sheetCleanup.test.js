const mockListEventSheets = jest.fn();
const mockDeleteEventSheet = jest.fn();
const mockDeleteFile = jest.fn().mockResolvedValue({});

jest.mock("../../src/web/eventSheetStore", () => ({
    listEventSheets: mockListEventSheets,
    deleteEventSheet: mockDeleteEventSheet,
}));
jest.mock("../../src/classes/drive", () =>
    jest.fn().mockImplementation(() => ({ deleteFile: mockDeleteFile })));

const { sweepDueSheets, startSheetCleanup } = require("../../src/utils/sheetCleanup.js");

describe("utils/sheetCleanup", () => {
    const NOW = 1_000_000_000_000;
    let drive;

    beforeEach(() => {
        jest.clearAllMocks();
        mockDeleteFile.mockResolvedValue({});
        drive = { deleteFile: mockDeleteFile };
    });

    it("deletes only copies whose deleteAfter is due", async () => {
        mockListEventSheets.mockReturnValue([
            { eventId: "a", spreadsheetId: "sheet-a", deleteAfter: NOW - 1 },   // due
            { eventId: "b", spreadsheetId: "sheet-b", deleteAfter: NOW + 1000 }, // future
            { eventId: "c", spreadsheetId: "sheet-c", deleteAfter: NOW },        // due (==now)
        ]);
        const deleted = await sweepDueSheets(NOW, drive);
        expect(deleted).toBe(2);
        expect(mockDeleteFile).toHaveBeenCalledWith("sheet-a");
        expect(mockDeleteFile).toHaveBeenCalledWith("sheet-c");
        expect(mockDeleteFile).not.toHaveBeenCalledWith("sheet-b");
        expect(mockDeleteEventSheet).toHaveBeenCalledWith("a");
        expect(mockDeleteEventSheet).toHaveBeenCalledWith("c");
        expect(mockDeleteEventSheet).not.toHaveBeenCalledWith("b");
    });

    it("skips records without a spreadsheetId or deleteAfter", async () => {
        mockListEventSheets.mockReturnValue([
            { eventId: "x", spreadsheetId: "", deleteAfter: NOW - 1 },
            { eventId: "y", spreadsheetId: "sheet-y", deleteAfter: 0 },
        ]);
        expect(await sweepDueSheets(NOW, drive)).toBe(0);
        expect(mockDeleteFile).not.toHaveBeenCalled();
    });

    it("keeps the record when the Drive delete fails (retried next sweep)", async () => {
        mockListEventSheets.mockReturnValue([{ eventId: "a", spreadsheetId: "sheet-a", deleteAfter: NOW - 1 }]);
        mockDeleteFile.mockRejectedValueOnce(new Error("boom"));
        const deleted = await sweepDueSheets(NOW, drive);
        expect(deleted).toBe(0);
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
