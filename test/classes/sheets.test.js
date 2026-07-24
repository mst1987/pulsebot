// Mock googleapis before requiring the client.
const mockGetClient = jest.fn().mockResolvedValue({ fakeAuthClient: true });
const mockGoogleAuth = jest.fn().mockImplementation(() => ({
    getClient: mockGetClient,
}));

const sheetsApi = {
    spreadsheets: {
        values: {
            batchUpdate: jest.fn().mockResolvedValue({}),
            batchClear: jest.fn().mockResolvedValue({}),
        },
        get: jest.fn(),
        batchUpdate: jest.fn().mockResolvedValue({}),
    },
};
const mockSheets = jest.fn().mockReturnValue(sheetsApi);

jest.mock("googleapis", () => ({
    google: {
        auth: { GoogleAuth: mockGoogleAuth },
        sheets: mockSheets,
    },
}));

const SheetsClient = require("../../src/classes/sheets.js");

describe("classes/SheetsClient", () => {
    const OLD = { ...process.env };

    beforeEach(() => {
        process.env.GOOGLE_SPREADSHEET_ID = "sheet-123";
        process.env.GOOGLE_SHEET_NAME = "Setup";
        process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE = "/tmp/key.json";
        delete process.env.GOOGLE_SHEET_GID;
    });

    afterEach(() => {
        process.env = { ...OLD };
    });

    describe("constructor", () => {
        it("reads config from env and defaults sheet name / gid", () => {
            delete process.env.GOOGLE_SHEET_NAME;
            const client = new SheetsClient();
            expect(client.spreadsheetId).toBe("sheet-123");
            expect(client.sheetName).toBe("Setup"); // default
            expect(client.sheetId).toBe(34139428); // default gid
        });

        it("creates a GoogleAuth with the spreadsheets scope", () => {
            new SheetsClient();
            expect(mockGoogleAuth).toHaveBeenCalledWith({
                keyFile: "/tmp/key.json",
                scopes: ["https://www.googleapis.com/auth/spreadsheets"],
            });
        });
    });

    describe("_getSheets", () => {
        it("authenticates once and caches the sheets client", async () => {
            const client = new SheetsClient();
            const a = await client._getSheets();
            const b = await client._getSheets();

            expect(a).toBe(sheetsApi);
            expect(b).toBe(sheetsApi);
            expect(mockGetClient).toHaveBeenCalledTimes(1);
            expect(mockSheets).toHaveBeenCalledWith({
                version: "v4",
                auth: { fakeAuthClient: true },
            });
        });
    });

    describe("batchWrite", () => {
        it("calls values.batchUpdate with USER_ENTERED and the given data", async () => {
            const client = new SheetsClient();
            const data = [{ range: "A1", values: [["x"]] }];

            await client.batchWrite(data);

            expect(sheetsApi.spreadsheets.values.batchUpdate).toHaveBeenCalledWith({
                spreadsheetId: "sheet-123",
                requestBody: { valueInputOption: "USER_ENTERED", data },
            });
        });
    });

    describe("batchClear", () => {
        it("calls values.batchClear with the given ranges", async () => {
            const client = new SheetsClient();
            const ranges = ["Setup!A1:Z200"];

            await client.batchClear(ranges);

            expect(sheetsApi.spreadsheets.values.batchClear).toHaveBeenCalledWith({
                spreadsheetId: "sheet-123",
                requestBody: { ranges },
            });
        });
    });

    describe("applyConditionalFormatting", () => {
        it("deletes existing rules and adds one TEXT_EQ rule per player per tab", async () => {
            sheetsApi.spreadsheets.get.mockResolvedValue({
                data: {
                    sheets: [
                        { properties: { sheetId: 1 }, conditionalFormats: [{}, {}] },
                    ],
                },
            });
            const client = new SheetsClient();

            await client.applyConditionalFormatting([
                { name: "Brandowl", color: { red: 1, green: 0, blue: 0 } },
            ]);

            expect(sheetsApi.spreadsheets.get).toHaveBeenCalledWith({
                spreadsheetId: "sheet-123",
                fields: "sheets(properties(sheetId,title),conditionalFormats)",
            });

            expect(sheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
            const requests =
                sheetsApi.spreadsheets.batchUpdate.mock.calls[0][0].requestBody
                    .requests;
            // two deletes (for the two existing rules) + one add
            const deletes = requests.filter((r) => r.deleteConditionalFormatRule);
            const adds = requests.filter((r) => r.addConditionalFormatRule);
            expect(deletes).toHaveLength(2);
            expect(adds).toHaveLength(1);
            expect(
                adds[0].addConditionalFormatRule.rule.booleanRule.condition
            ).toEqual({ type: "TEXT_EQ", values: [{ userEnteredValue: "Brandowl" }] });
        });

        it("skips players missing a name or color", async () => {
            sheetsApi.spreadsheets.get.mockResolvedValue({
                data: {
                    sheets: [
                        { properties: { sheetId: 2 }, conditionalFormats: [] },
                    ],
                },
            });
            const client = new SheetsClient();

            await client.applyConditionalFormatting([
                { name: "", color: { red: 1 } },
                { name: "NoColor", color: null },
            ]);

            // No valid rules -> no batchUpdate at all (requests.length === 0)
            expect(sheetsApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
        });

        it("swallows per-tab errors (protected tabs) without rejecting", async () => {
            sheetsApi.spreadsheets.get.mockResolvedValue({
                data: {
                    sheets: [
                        { properties: { sheetId: 3 }, conditionalFormats: [] },
                    ],
                },
            });
            sheetsApi.spreadsheets.batchUpdate.mockRejectedValueOnce(
                new Error("The sheet is protected")
            );
            const client = new SheetsClient();

            await expect(
                client.applyConditionalFormatting([
                    { name: "Player", color: { red: 0, green: 0, blue: 1 } },
                ])
            ).resolves.toBeUndefined();
        });

        it("handles an empty spreadsheet (no sheets)", async () => {
            sheetsApi.spreadsheets.get.mockResolvedValue({ data: {} });
            const client = new SheetsClient();

            await expect(
                client.applyConditionalFormatting([])
            ).resolves.toBeUndefined();
            expect(sheetsApi.spreadsheets.batchUpdate).not.toHaveBeenCalled();
        });

        it("only touches the named tab when onlyTitle is given", async () => {
            sheetsApi.spreadsheets.get.mockResolvedValue({
                data: {
                    sheets: [
                        { properties: { sheetId: 1, title: "Setup" }, conditionalFormats: [] },
                        { properties: { sheetId: 2, title: "Kara 24.07." }, conditionalFormats: [] },
                    ],
                },
            });
            const client = new SheetsClient();
            await client.applyConditionalFormatting([{ name: "P", color: { red: 1 } }], "Kara 24.07.");
            expect(sheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
            const req = sheetsApi.spreadsheets.batchUpdate.mock.calls[0][0].requestBody.requests[0];
            expect(req.addConditionalFormatRule.rule.ranges[0].sheetId).toBe(2);
        });
    });

    describe("duplicateTab", () => {
        it("duplicates a tab and returns the new tab's id + title", async () => {
            sheetsApi.spreadsheets.batchUpdate.mockResolvedValueOnce({
                data: { replies: [{ duplicateSheet: { properties: { sheetId: 555, title: "Kara 24.07." } } }] },
            });
            const client = new SheetsClient({ spreadsheetId: "s1", gid: "34" });
            const res = await client.duplicateTab("Kara 24.07.");
            expect(res).toEqual({ sheetId: 555, title: "Kara 24.07." });
            const req = sheetsApi.spreadsheets.batchUpdate.mock.calls[0][0].requestBody.requests[0];
            expect(req.duplicateSheet).toMatchObject({ sourceSheetId: 34, newSheetName: "Kara 24.07." });
        });

        it("retries with a numeric suffix on a name collision", async () => {
            sheetsApi.spreadsheets.batchUpdate
                .mockRejectedValueOnce(new Error("A sheet with the name \"Kara\" already exists."))
                .mockResolvedValueOnce({ data: { replies: [{ duplicateSheet: { properties: { sheetId: 7, title: "Kara (2)" } } }] } });
            const client = new SheetsClient({ spreadsheetId: "s1", gid: "1" });
            const res = await client.duplicateTab("Kara");
            expect(res.title).toBe("Kara (2)");
            expect(sheetsApi.spreadsheets.batchUpdate.mock.calls[1][0].requestBody.requests[0].duplicateSheet.newSheetName).toBe("Kara (2)");
        });

        it("rethrows a non-collision error immediately", async () => {
            sheetsApi.spreadsheets.batchUpdate.mockRejectedValueOnce(new Error("permission denied"));
            await expect(new SheetsClient({ spreadsheetId: "s1", gid: "1" }).duplicateTab("Kara")).rejects.toThrow(/permission/);
            expect(sheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledTimes(1);
        });
    });

    describe("deleteTab", () => {
        it("issues a deleteSheet request for the given gid", async () => {
            const client = new SheetsClient({ spreadsheetId: "s1" });
            await client.deleteTab(555);
            expect(sheetsApi.spreadsheets.batchUpdate).toHaveBeenCalledWith({
                spreadsheetId: "s1",
                requestBody: { requests: [{ deleteSheet: { sheetId: 555 } }] },
            });
        });
    });
});
