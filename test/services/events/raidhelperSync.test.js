// The one job that asks Raid-Helper for the event list (#608), per Discord server (#927).
const A = "111111111111111111";
const B = "222222222222222222";
const C = "333333333333333333";
const RH_ON = { raidhelper: { enabled: true, apiKey: "fake-key-for-tests" } };
// A and B have Raid-Helper switched on, C has not
const mockConfig = jest.fn();
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: () => mockConfig() }));
const mockFetchEvents = jest.fn();
const mockSetAfterWrite = jest.fn();
const mockCreateClient = jest.fn(({ guildId }) => ({ fetchEvents: (since) => mockFetchEvents(since, guildId) }));
jest.mock("../../../src/utils/raidhelper/client", () => ({
    ...jest.requireActual("../../../src/utils/raidhelper/client"),
    createRaidhelperClient: (...a) => mockCreateClient(...a),
    setAfterWrite: (...a) => mockSetAfterWrite(...a),
}));
const mockScanAllGuilds = jest.fn(async () => 0);
jest.mock("../../../src/services/events/raidEventScan", () => ({ scanAllGuilds: (...a) => mockScanAllGuilds(...a) }));
jest.mock("../../../src/services/events/raidEventGroups", () => ({ EVENT_LOOKBACK_DAYS: 60 }));

const { tempStoreFile } = require("../../helpers/tempStore");
const eventsStore = require("../../../src/stores/events/raidhelperEventsStore");
const budgetStore = require("../../../src/stores/events/raidhelperBudgetStore");
const sync = require("../../../src/services/events/raidhelperSync");

const NOW = 1_800_000_000_000;
let nowSpy;

beforeEach(() => {
    eventsStore.useFile(tempStoreFile("raidhelper-events.json"));
    budgetStore.useFile(tempStoreFile("raidhelper-budget.json"));
    nowSpy = jest.spyOn(Date, "now").mockReturnValue(NOW);
    mockFetchEvents.mockReset().mockResolvedValue([{ id: "e1", startTime: 1 }]);
    mockConfig.mockReset().mockReturnValue({
        discordServers: { servers: [{ guildId: A }, { guildId: B }, { guildId: C }] },
        serverSettings: { [A]: RH_ON },
    });
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
            expect(await sync.syncRaidhelperEvents()).toEqual({ ok: true, servers: { [A]: { ok: true } } });
            expect(mockCreateClient).toHaveBeenCalledWith({ live: true, guildId: A });
            expect(mockFetchEvents).toHaveBeenCalledTimes(1);
            expect(mockFetchEvents).toHaveBeenCalledWith(Math.floor(NOW / 1000) - 60 * 86400, A);
            expect(eventsStore.readSnapshot(A)).toMatchObject({ syncedAt: NOW, events: [{ id: "e1", startTime: 1 }], error: "" });
            // a server without Raid-Helper is never asked and keeps no list
            expect(eventsStore.readSnapshot(C).syncedAt).toBe(0);
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
            expect(await sync.syncRaidhelperEvents()).toMatchObject({ ok: false, error: "Raid-Helper: Rate limit encountered" });
            expect(eventsStore.readSnapshot(A)).toMatchObject({
                syncedAt: NOW, events: [{ id: "e1", startTime: 1 }], error: "Raid-Helper: Rate limit encountered", errorAt: NOW + 1000,
            });
            expect(mockScanAllGuilds).toHaveBeenCalledTimes(1);
        });

        it("still counts the sync as done when the snapshot scan fails", async () => {
            mockScanAllGuilds.mockRejectedValue(new Error("discord down"));
            expect(await sync.syncRaidhelperEvents()).toMatchObject({ ok: true });
        });

        it("asks nothing while no server has Raid-Helper switched on", async () => {
            mockConfig.mockReturnValue({ discordServers: { servers: [{ guildId: A }] }, serverSettings: { [A]: { raidhelper: { enabled: false, apiKey: "fake-key-for-tests" } } } });
            expect(await sync.syncRaidhelperEvents()).toEqual({ ok: false, disabled: true });
            expect(mockFetchEvents).not.toHaveBeenCalled();
        });

        // #927: each server with its own key into its own list; a 429 on A leaves B alone
        it("syncs every active server into its own list, and a 429 on one does not stop the other", async () => {
            mockConfig.mockReturnValue({
                discordServers: { servers: [{ guildId: A }, { guildId: B }, { guildId: C }] },
                serverSettings: { [A]: RH_ON, [B]: { raidhelper: { enabled: true, apiKey: "other-fake-key" } } },
            });
            mockFetchEvents.mockImplementation(async (since, guildId) => {
                if (guildId === A) throw new Error("Raid-Helper: Rate limit encountered");
                return [{ id: `ev-${guildId}`, startTime: 1 }];
            });
            const result = await sync.syncRaidhelperEvents();
            expect(result).toMatchObject({ ok: true, servers: { [A]: { ok: false }, [B]: { ok: true } } });
            expect(mockCreateClient.mock.calls.map(([o]) => o.guildId)).toEqual([A, B]);
            expect(eventsStore.readSnapshot(A)).toMatchObject({ events: [], error: "Raid-Helper: Rate limit encountered" });
            expect(eventsStore.readSnapshot(B)).toMatchObject({ events: [{ id: `ev-${B}` }], error: "" });
            expect(mockScanAllGuilds).toHaveBeenCalledTimes(1);
        });
    });

    describe("refreshNow / syncStatus", () => {
        it("syncs on a click and reports the result with the budget", async () => {
            const result = await sync.refreshNow(A);
            expect(result).toMatchObject({ syncedAt: NOW, events: 1, error: "", throttled: false, ok: true, disabled: false, intervalMs: sync.SYNC_INTERVAL_MS });
            expect(result.budget).toMatchObject({ limit: 1000 });
            expect(mockCreateClient).toHaveBeenCalledWith({ live: true, guildId: A });
        });

        it("asks nothing on a click for a server without Raid-Helper", async () => {
            expect(await sync.refreshNow(C)).toMatchObject({ disabled: true, ok: false, events: 0 });
            expect(mockFetchEvents).not.toHaveBeenCalled();
        });

        it("reports each server's own budget", () => {
            budgetStore.writeBudget(A, { hours: {}, blockedUntil: NOW + 3600000, blockedReason: "limit" });
            expect(sync.syncStatus(A).budget.blockedUntil).toBe(NOW + 3600000);
            expect(sync.syncStatus(B).budget.blockedUntil).toBe(0);
        });

        it("sends nothing when the last attempt is younger than 30 seconds", async () => {
            await sync.refreshNow(A);
            nowSpy.mockReturnValue(NOW + sync.MANUAL_MIN_GAP_MS - 1);
            expect(await sync.refreshNow(A)).toMatchObject({ throttled: true });
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
