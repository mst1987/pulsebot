const mockGetConfig = jest.fn();
jest.mock("../../src/web/settingsStore", () => ({ getConfig: mockGetConfig }));

const MockRaidhelper = jest.fn().mockImplementation((opts) => ({ opts }));
jest.mock("../../src/classes/raidhelper", () => MockRaidhelper);

const { createRaidhelperClient } = require("../../src/utils/raidhelperClient");

describe("utils/raidhelperClient", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it("passes the admin-configured serverId to Raidhelper", () => {
        mockGetConfig.mockReturnValue({ raidhelperServerId: "server-from-store" });
        const client = createRaidhelperClient();
        expect(MockRaidhelper).toHaveBeenCalledWith({ serverId: "server-from-store" });
        expect(client.opts).toEqual({ serverId: "server-from-store" });
    });

    it("passes an empty serverId through when nothing is stored (Raidhelper falls back to env)", () => {
        mockGetConfig.mockReturnValue({ raidhelperServerId: "" });
        createRaidhelperClient();
        expect(MockRaidhelper).toHaveBeenCalledWith({ serverId: "" });
    });
});
