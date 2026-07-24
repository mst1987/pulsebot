// Mock googleapis before requiring the client.
const mockSetCredentials = jest.fn();
const mockOAuth2 = jest.fn().mockImplementation(() => ({ setCredentials: mockSetCredentials }));

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
        auth: { OAuth2: mockOAuth2 },
        drive: mockDrive,
    },
}));

const Drive = require("../../src/classes/drive.js");

describe("classes/Drive (OAuth as a real user)", () => {
    const OLD = { ...process.env };
    beforeEach(() => {
        jest.clearAllMocks();
        driveApi.files.copy.mockResolvedValue({ data: { id: "copy-1" } });
        process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
        process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
        process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "rtok";
    });
    afterEach(() => { process.env = { ...OLD }; });

    it("throws a helpful error when OAuth env vars are missing", () => {
        delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
        expect(() => new Drive()).toThrow(/GOOGLE_OAUTH_REFRESH_TOKEN|OAuth/);
    });

    it("authenticates as the user with the stored refresh token", () => {
        new Drive();
        expect(mockOAuth2).toHaveBeenCalledWith("cid", "secret");
        expect(mockSetCredentials).toHaveBeenCalledWith({ refresh_token: "rtok" });
    });

    it("copies a file and returns its id + spreadsheet url", async () => {
        const res = await new Drive().copyFile("source-9", "GDKP Kara");
        expect(driveApi.files.copy).toHaveBeenCalledWith(expect.objectContaining({
            fileId: "source-9",
            requestBody: { name: "GDKP Kara" },
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
});
