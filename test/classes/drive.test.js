// Mock googleapis before requiring the client.
const mockGetClient = jest.fn().mockResolvedValue({ fakeAuthClient: true });
const mockGoogleAuth = jest.fn().mockImplementation(() => ({ getClient: mockGetClient }));

const driveApi = {
    files: {
        copy: jest.fn().mockResolvedValue({ data: { id: "copy-1" } }),
        delete: jest.fn().mockResolvedValue({}),
    },
    permissions: {
        create: jest.fn().mockResolvedValue({}),
    },
};
const mockDrive = jest.fn().mockReturnValue(driveApi);

jest.mock("googleapis", () => ({
    google: {
        auth: { GoogleAuth: mockGoogleAuth },
        drive: mockDrive,
    },
}));

const Drive = require("../../src/classes/drive.js");

describe("classes/Drive", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        driveApi.files.copy.mockResolvedValue({ data: { id: "copy-1" } });
        process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE = "/tmp/key.json";
    });

    it("requests the drive scope", () => {
        new Drive();
        expect(mockGoogleAuth).toHaveBeenCalledWith(expect.objectContaining({
            scopes: ["https://www.googleapis.com/auth/drive"],
        }));
    });

    it("copies a file and returns its id + spreadsheet url", async () => {
        const drive = new Drive();
        const res = await drive.copyFile("source-9", "GDKP Kara — 24.07.2026");
        expect(driveApi.files.copy).toHaveBeenCalledWith(expect.objectContaining({
            fileId: "source-9",
            requestBody: { name: "GDKP Kara — 24.07.2026" },
            supportsAllDrives: true,
        }));
        expect(res).toEqual({
            id: "copy-1",
            url: "https://docs.google.com/spreadsheets/d/copy-1/edit",
        });
    });

    it("throws when the copy has no id", async () => {
        driveApi.files.copy.mockResolvedValueOnce({ data: {} });
        await expect(new Drive().copyFile("source-9", "x")).rejects.toThrow(/Datei-ID/);
    });

    it("shares a file as anyone-with-link editor", async () => {
        await new Drive().shareAnyoneWriter("copy-1");
        expect(driveApi.permissions.create).toHaveBeenCalledWith(expect.objectContaining({
            fileId: "copy-1",
            requestBody: { role: "writer", type: "anyone" },
        }));
    });

    it("deletes a file by id", async () => {
        await new Drive().deleteFile("copy-1");
        expect(driveApi.files.delete).toHaveBeenCalledWith(expect.objectContaining({
            fileId: "copy-1",
            supportsAllDrives: true,
        }));
    });

    it("reuses one authenticated drive client per instance", async () => {
        const drive = new Drive();
        await drive.deleteFile("a");
        await drive.deleteFile("b");
        expect(mockGetClient).toHaveBeenCalledTimes(1);
    });
});
