const mockGetConfig = jest.fn();
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: mockGetConfig }));

const MockRaidhelper = jest.fn().mockImplementation((opts) => ({ opts }));
jest.mock("../../../src/classes/raidhelper", () => MockRaidhelper);

const { tempStoreFile } = require("../../helpers/tempStore");
const eventsStore = require("../../../src/stores/raidhelperEventsStore");
const { createRaidhelperClient, setAfterWrite, NOT_SYNCED } = require("../../../src/utils/raidhelper/client");

beforeEach(() => eventsStore.useFile(tempStoreFile("raidhelper-events.json")));
afterAll(() => eventsStore.useFile(null));

describe("utils/raidhelper/client", () => {
    afterEach(() => {
        jest.clearAllMocks();
        setAfterWrite(null);
    });

    it("passes the admin-configured serverId to Raidhelper", () => {
        mockGetConfig.mockReturnValue({ raidhelperServerId: "server-from-store" });
        const client = createRaidhelperClient();
        expect(MockRaidhelper).toHaveBeenCalledWith(expect.objectContaining({ serverId: "server-from-store" }));
        expect(client.opts.serverId).toBe("server-from-store");
    });

    it("passes an empty serverId through when nothing is stored (Raidhelper falls back to env)", () => {
        mockGetConfig.mockReturnValue({ raidhelperServerId: "" });
        createRaidhelperClient();
        expect(MockRaidhelper).toHaveBeenCalledWith(expect.objectContaining({ serverId: "" }));
    });

    // #608: the pages read the synced list, only the sync job asks Raid-Helper
    describe("the synced event list", () => {
        beforeEach(() => mockGetConfig.mockReturnValue({ raidhelperServerId: "s" }));

        it("hands out a client that reads the list from the store by default", () => {
            const { opts } = createRaidhelperClient();
            expect(typeof opts.snapshot).toBe("function");
            expect(opts.cacheMs).toBeGreaterThan(0);
        });

        it("hands the sync job a live client", () => {
            expect(createRaidhelperClient({ live: true }).opts.snapshot).toBeNull();
        });

        it("answers the events from the given start on, ascending", () => {
            eventsStore.saveSnapshot({
                syncedAt: 1000, since: 0,
                events: [{ id: "b", startTime: 300 }, { id: "old", startTime: 50 }, { id: "a", startTime: 200 }],
            });
            const { snapshot } = createRaidhelperClient().opts;
            expect(snapshot(100).map((e) => e.id)).toEqual(["a", "b"]);
        });

        it("says so before the first sync, with the last error once there is one", () => {
            const { snapshot } = createRaidhelperClient().opts;
            expect(() => snapshot(0)).toThrow(NOT_SYNCED);
            eventsStore.saveSyncError("Raid-Helper: Rate limit encountered", 5);
            expect(() => snapshot(0)).toThrow(/Letzter Fehler: Raid-Helper: Rate limit/);
        });

        it("runs the registered hook after a write, and nothing without one", () => {
            const hook = jest.fn();
            setAfterWrite(hook);
            createRaidhelperClient().opts.onWrite();
            expect(hook).toHaveBeenCalledTimes(1);
            setAfterWrite(null);
            expect(() => createRaidhelperClient().opts.onWrite()).not.toThrow();
        });
    });
});
