// The one job that asks Raid-Helper for the event list (#608).
const mockFetchEvents = jest.fn();
const mockDisabled = jest.fn(() => false);
const mockSetAfterWrite = jest.fn();
const mockCreateClient = jest.fn(() => ({ fetchEvents: mockFetchEvents }));
jest.mock("../../../src/utils/raidhelper/client", () => ({
    createRaidhelperClient: (...a) => mockCreateClient(...a),
    raidhelperDisabled: () => mockDisabled(),
    setAfterWrite: (...a) => mockSetAfterWrite(...a),
}));
const mockScanAllGuilds = jest.fn(async () => 0);
jest.mock("../../../src/services/events/raidEventScan", () => ({ scanAllGuilds: (...a) => mockScanAllGuilds(...a) }));
jest.mock("../../../src/services/events/raidEventGroups", () => ({ EVENT_LOOKBACK_DAYS: 60 }));

const { tempStoreFile } = require("../../helpers/tempStore");
const eventsStore = require("../../../src/stores/raidhelperEventsStore");
const budgetStore = require("../../../src/stores/raidhelperBudgetStore");
const sync = require("../../../src/services/events/raidhelperSync");

const NOW = 1_800_000_000_000;
let nowSpy;

beforeEach(() => {
    eventsStore.useFile(tempStoreFile("raidhelper-events.json"));
    budgetStore.useFile(tempStoreFile("raidhelper-budget.json"));
    nowSpy = jest.spyOn(Date, "now").mockReturnValue(NOW);
    mockFetchEvents.mockReset().mockResolvedValue([{ id: "e1", startTime: 1 }]);
    mockDisabled.mockReset().mockReturnValue(false);
    mockScanAllGuilds.mockReset().mockResolvedValue(0);
    mockCreateClient.mockClear();
    mockSetAfterWrite.mockClear();
});
afterEach(() => {
    sync.stopRaidhelperSync();
    nowSpy.mockRestore();
});
afterAll(() => {
    eventsStore.useFile(null);
    budgetStore.useFile(null);
});

describe("services/events/raidhelperSync", () => {
    describe("syncRaidhelperEvents", () => {
        it("fetches the list once, live, from the lookback window on, and stores it", async () => {
            expect(await sync.syncRaidhelperEvents()).toEqual({ ok: true });
            expect(mockCreateClient).toHaveBeenCalledWith({ live: true });
            expect(mockFetchEvents).toHaveBeenCalledTimes(1);
            expect(mockFetchEvents).toHaveBeenCalledWith(Math.floor(NOW / 1000) - 60 * 86400);
            expect(eventsStore.readSnapshot()).toMatchObject({ syncedAt: NOW, events: [{ id: "e1", startTime: 1 }], error: "" });
        });

        it("snapshots the past raids afterwards, raidplans included", async () => {
            await sync.syncRaidhelperEvents();
            expect(mockScanAllGuilds).toHaveBeenCalledWith({ probeSetups: true });
        });

        it("shares one request between calls that overlap", async () => {
            await Promise.all([sync.syncRaidhelperEvents(), sync.syncRaidhelperEvents()]);
            expect(mockFetchEvents).toHaveBeenCalledTimes(1);
        });

        it("keeps the last list on a failure and records the reason", async () => {
            await sync.syncRaidhelperEvents();
            mockFetchEvents.mockRejectedValue(new Error("Raid-Helper: Rate limit encountered"));
            nowSpy.mockReturnValue(NOW + 1000);
            expect(await sync.syncRaidhelperEvents()).toEqual({ ok: false, error: "Raid-Helper: Rate limit encountered" });
            expect(eventsStore.readSnapshot()).toMatchObject({
                syncedAt: NOW, events: [{ id: "e1", startTime: 1 }], error: "Raid-Helper: Rate limit encountered", errorAt: NOW + 1000,
            });
            expect(mockScanAllGuilds).toHaveBeenCalledTimes(1);
        });

        it("still counts the sync as done when the snapshot scan fails", async () => {
            mockScanAllGuilds.mockRejectedValue(new Error("discord down"));
            expect(await sync.syncRaidhelperEvents()).toEqual({ ok: true });
        });

        it("asks nothing while Raid-Helper is switched off", async () => {
            mockDisabled.mockReturnValue(true);
            expect(await sync.syncRaidhelperEvents()).toEqual({ ok: false, disabled: true });
            expect(mockFetchEvents).not.toHaveBeenCalled();
        });
    });

    describe("refreshNow / syncStatus", () => {
        it("syncs on a click and reports the result with the budget", async () => {
            const result = await sync.refreshNow();
            expect(result).toMatchObject({ syncedAt: NOW, events: 1, error: "", throttled: false, ok: true, intervalMs: sync.SYNC_INTERVAL_MS });
            expect(result.budget).toMatchObject({ limit: 1000 });
        });

        it("sends nothing when the last attempt is younger than 30 seconds", async () => {
            await sync.refreshNow();
            nowSpy.mockReturnValue(NOW + sync.MANUAL_MIN_GAP_MS - 1);
            expect(await sync.refreshNow()).toMatchObject({ throttled: true });
            expect(mockFetchEvents).toHaveBeenCalledTimes(1);
        });
    });

    describe("timers", () => {
        it("syncs once on start, registers the write hook and is idempotent", async () => {
            const timer = sync.startRaidhelperSync({ intervalMs: 60000 });
            expect(sync.startRaidhelperSync()).toBe(timer);
            await Promise.resolve();
            expect(mockFetchEvents).toHaveBeenCalledTimes(1);
            expect(mockSetAfterWrite).toHaveBeenCalledWith(sync.syncSoon);
            sync.stopRaidhelperSync();
            expect(mockSetAfterWrite).toHaveBeenLastCalledWith(null);
        });

        it("syncs a few seconds after a write, once for several writes", async () => {
            jest.useFakeTimers();
            try {
                sync.syncSoon();
                sync.syncSoon();
                expect(mockFetchEvents).not.toHaveBeenCalled();
                jest.advanceTimersByTime(5000);
                expect(mockFetchEvents).toHaveBeenCalledTimes(1);
            } finally {
                jest.useRealTimers();
            }
        });
    });
});
