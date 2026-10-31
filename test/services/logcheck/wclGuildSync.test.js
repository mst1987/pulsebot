// The WCL guild fetch (#922): when an entry is due, that a new report becomes a
// log of the server and version (a known one creates nothing), the error paths
// (400, 429 with the site pause, network, no key, no site), lost-update safety
// and that a double click or the job joins a running fetch. No network: the WCL
// client is a stand-in.
let mockConfig;
jest.mock("../../../src/stores/settings/settingsStore", () => ({
    getConfig: jest.fn(() => mockConfig),
    // like the real store: serverSettings merge per server and key
    saveConfig: jest.fn((partial) => {
        const servers = { ...(mockConfig.serverSettings || {}) };
        for (const [gid, block] of Object.entries(partial.serverSettings || {})) servers[gid] = { ...(servers[gid] || {}), ...block };
        mockConfig = { ...mockConfig, serverSettings: servers };
        return mockConfig;
    }),
}));
jest.mock("../../../src/stores/loot/logStore", () => ({
    getByReportId: jest.fn(() => null),
    saveLog: jest.fn((log) => ({ id: `log-${log.reportId}`, ...log })),
    setReportStart: jest.fn(),
}));
jest.mock("../../../src/services/logcheck/logVersion", () => ({
    wclApiSite: jest.fn((v) => (v === "tbc" ? "https://fresh.warcraftlogs.com" : v === "classic" ? "https://vanilla.warcraftlogs.com" : "")),
    wclClientFor: jest.fn(),
    reportLink: jest.fn(({ reportId }) => `https://fresh.warcraftlogs.com/reports/${reportId}`),
}));
jest.mock("../../../src/services/logcheck/logAutoLink", () => ({ autoLinkLogs: jest.fn(async () => ({})) }));

const settingsStore = require("../../../src/stores/settings/settingsStore");
const logStore = require("../../../src/stores/loot/logStore");
const logVersion = require("../../../src/services/logcheck/logVersion");
const { autoLinkLogs } = require("../../../src/services/logcheck/logAutoLink");
const sync = require("../../../src/services/logcheck/wclGuildSync");

const MIN = 60 * 1000;
const KEY = "tbc|pulse|thunderstrike|EU";
const entry = (over = {}) => ({ versionId: "tbc", guildName: "Pulse", realm: "Thunderstrike", region: "EU", interval: 60, lastRunAt: 0, lastResult: null, ...over });
const stored = (gid = "g1") => mockConfig.serverSettings[gid].wclGuilds;
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

let client;
beforeEach(() => {
    jest.clearAllMocks();
    sync._resetForTests();
    mockConfig = { serverSettings: { g1: { logChannels: [{ channelId: "c1", versionId: "tbc" }], wclGuilds: [entry()] } } };
    client = { getGuildReports: jest.fn(async () => []) };
    logVersion.wclClientFor.mockImplementation(() => client);
    logStore.getByReportId.mockReturnValue(null);
});
afterAll(() => sync._resetForTests());

describe("services/logcheck/wclGuildSync (#922)", () => {
    describe("isDue", () => {
        it.each([15, 30, 60, 180, 360, 1440])("an entry every %i minutes is due once that time has passed", (interval) => {
            const last = 1_000_000;
            expect(sync.isDue({ interval, lastRunAt: last }, last + interval * MIN - 1)).toBe(false);
            expect(sync.isDue({ interval, lastRunAt: last }, last + interval * MIN)).toBe(true);
        });

        it("a never fetched entry is due at once", () => {
            expect(sync.isDue({ interval: 1440, lastRunAt: 0 }, Date.now())).toBe(true);
        });

        it("Aus (0) is never due, however long ago", () => {
            expect(sync.isDue({ interval: 0, lastRunAt: 0 }, Date.now())).toBe(false);
            expect(sync.isDue(null)).toBe(false);
        });
    });

    describe("errorMessage", () => {
        it("names each failure without a key", () => {
            expect(sync.errorMessage(httpError(400))).toMatch(/nicht gefunden/);
            expect(sync.errorMessage({ response: { status: 403 } })).toMatch(/API-Schlüssel/);
            expect(sync.errorMessage(httpError(429))).toMatch(/429/);
            expect(sync.errorMessage(httpError(502))).toMatch(/HTTP 502/);
            expect(sync.errorMessage({ code: "no_key" })).toMatch(/Kein Warcraft-Logs-API-Schlüssel/);
            expect(sync.errorMessage({ code: "no_site" })).toMatch(/keine Warcraft-Logs-Seite/);
            expect(sync.errorMessage(new Error("ECONNRESET"))).toBe("Warcraft Logs nicht erreichbar.");
        });
    });

    describe("fetchEntry", () => {
        it("a new report becomes a log of the server and version, linked like a log-channel post", async () => {
            client.getGuildReports.mockResolvedValue([{ id: "AbC123", title: "Karazhan", start: 1700000000000 }]);
            const result = await sync.fetchEntry("g1", KEY);

            expect(result).toMatchObject({ found: 1, error: "" });
            expect(logVersion.wclClientFor).toHaveBeenCalledWith("tbc");
            expect(client.getGuildReports).toHaveBeenCalledWith("Pulse", "Thunderstrike", "EU", { start: expect.any(Number) });
            expect(logStore.saveLog).toHaveBeenCalledWith({
                guildId: "g1", reportId: "AbC123", link: "https://fresh.warcraftlogs.com/reports/AbC123",
                title: "Karazhan", source: "guild", postedAt: 1700000000000, channelVersionId: "tbc",
            });
            expect(logStore.setReportStart).toHaveBeenCalledWith("log-AbC123", 1700000000000);
            expect(autoLinkLogs).toHaveBeenCalledWith("g1");
            expect(stored()[0]).toMatchObject({ lastRunAt: result.at, lastSuccessAt: result.at, lastResult: { found: 1, error: "", at: result.at } });
            // the server's other settings stay
            expect(mockConfig.serverSettings.g1.logChannels).toEqual([{ channelId: "c1", versionId: "tbc" }]);
        });

        it("a report the bot already knows creates nothing, and nothing is linked", async () => {
            client.getGuildReports.mockResolvedValue([{ id: "Known1", start: 5 }, { id: "../bad" }, null]);
            logStore.getByReportId.mockImplementation((id) => (id === "Known1" ? { id: "l1" } : null));
            const result = await sync.fetchEntry("g1", KEY);
            expect(result).toMatchObject({ found: 0, error: "" });
            expect(logStore.saveLog).not.toHaveBeenCalled();
            expect(autoLinkLogs).not.toHaveBeenCalled();
        });

        it("the first fetch looks 14 days back, later ones 48 h before the last successful fetch", async () => {
            const before = Date.now();
            await sync.fetchEntry("g1", KEY);
            const { start } = client.getGuildReports.mock.calls[0][3];
            expect(start).toBeGreaterThanOrEqual(before - sync.FIRST_LOOKBACK_MS);
            expect(start).toBeLessThanOrEqual(Date.now() - sync.FIRST_LOOKBACK_MS);

            const success = Date.now() - 3600 * 1000;
            mockConfig.serverSettings.g1.wclGuilds = [entry({ lastRunAt: success, lastSuccessAt: success })];
            await sync.fetchEntry("g1", KEY);
            expect(client.getGuildReports.mock.calls[1][3]).toEqual({ start: success - sync.LOOKBACK_MS });
        });

        it("the window never reaches further back than 14 days", () => {
            const now = 100 * 24 * 3600 * 1000;
            expect(sync.windowStart({ lastSuccessAt: now - 30 * 24 * 3600 * 1000 }, now)).toBe(now - sync.FIRST_LOOKBACK_MS);
            expect(sync.windowStart({ lastSuccessAt: 0 }, now)).toBe(now - sync.FIRST_LOOKBACK_MS);
            expect(sync.windowStart(null, now)).toBe(now - sync.FIRST_LOOKBACK_MS);
        });

        it("a raid that started hours before the last fetch but was uploaded later is still saved", async () => {
            // WCL filters by the report START: raid from 20:00, last fetch 23:40, upload 23:30 seen only now
            const lastFetch = Date.now() - 5 * MIN;
            const raidStart = lastFetch - 3 * 3600 * 1000 - 40 * MIN;
            mockConfig.serverSettings.g1.wclGuilds = [entry({ lastRunAt: lastFetch, lastSuccessAt: lastFetch })];
            client.getGuildReports.mockImplementation(async (g, r, reg, { start }) => (raidStart >= start ? [{ id: "Late1", start: raidStart }] : []));
            const result = await sync.fetchEntry("g1", KEY);
            expect(result).toMatchObject({ found: 1, error: "" });
            expect(logStore.saveLog).toHaveBeenCalledWith(expect.objectContaining({ reportId: "Late1", postedAt: raidStart }));
        });

        it("a failed fetch moves lastRunAt but not the window: the next one starts from the old success", async () => {
            const success = Date.now() - 2 * 3600 * 1000;
            mockConfig.serverSettings.g1.wclGuilds = [entry({ lastRunAt: success, lastSuccessAt: success })];
            client.getGuildReports.mockRejectedValueOnce(new Error("ETIMEDOUT"));
            const failed = await sync.fetchEntry("g1", KEY);
            expect(stored()[0]).toMatchObject({ lastRunAt: failed.at, lastSuccessAt: success });

            await sync.fetchEntry("g1", KEY);
            expect(client.getGuildReports.mock.calls[1][3]).toEqual({ start: success - sync.LOOKBACK_MS });
            expect(stored()[0].lastSuccessAt).toBeGreaterThan(success);
        });

        it("a report saveLog did not create is not counted", async () => {
            client.getGuildReports.mockResolvedValue([{ id: "Gone1", start: 5 }]);
            logStore.saveLog.mockReturnValueOnce(null);
            await expect(sync.fetchEntry("g1", KEY)).resolves.toMatchObject({ found: 0, error: "" });
            expect(logStore.setReportStart).not.toHaveBeenCalled();
            expect(autoLinkLogs).not.toHaveBeenCalled();
        });

        it("a report without a start keeps the fetch time and sets no start", async () => {
            client.getGuildReports.mockResolvedValue([{ id: "NoStart" }]);
            const result = await sync.fetchEntry("g1", KEY);
            expect(logStore.saveLog).toHaveBeenCalledWith(expect.objectContaining({ title: "", postedAt: result.at }));
            expect(logStore.setReportStart).not.toHaveBeenCalled();
        });

        it("a failing auto link is only logged", async () => {
            client.getGuildReports.mockResolvedValue([{ id: "AbC123", start: 5 }]);
            autoLinkLogs.mockRejectedValueOnce(new Error("boom"));
            await expect(sync.fetchEntry("g1", KEY)).resolves.toMatchObject({ found: 1, error: "" });
        });

        it("null for a server or key without such an entry, nothing asked", async () => {
            await expect(sync.fetchEntry("g1", "tbc|other|x|EU")).resolves.toBeNull();
            await expect(sync.fetchEntry("g2", KEY)).resolves.toBeNull();
            expect(client.getGuildReports).not.toHaveBeenCalled();
        });

        it("400 (unknown guild) lands in lastResult and creates nothing", async () => {
            client.getGuildReports.mockRejectedValue(httpError(400));
            const result = await sync.fetchEntry("g1", KEY);
            expect(result).toMatchObject({ found: 0, error: expect.stringMatching(/nicht gefunden/) });
            expect(stored()[0].lastResult.error).toMatch(/nicht gefunden/);
            expect(logStore.saveLog).not.toHaveBeenCalled();
        });

        it("a network error lands in lastResult", async () => {
            client.getGuildReports.mockRejectedValue(new Error("ETIMEDOUT"));
            await expect(sync.fetchEntry("g1", KEY)).resolves.toMatchObject({ error: "Warcraft Logs nicht erreichbar." });
        });

        it("no key and no site are noted without asking WCL", async () => {
            logVersion.wclClientFor.mockImplementationOnce(() => { throw new Error("WARCRAFTLOGS_API_KEY missing"); });
            await expect(sync.fetchEntry("g1", KEY)).resolves.toMatchObject({ error: expect.stringMatching(/API-Schlüssel/) });

            logVersion.wclClientFor.mockImplementationOnce(() => null);
            await expect(sync.fetchEntry("g1", KEY)).resolves.toMatchObject({ error: expect.stringMatching(/keine Warcraft-Logs-Seite/) });

            mockConfig.serverSettings.g1.wclGuilds = [entry({ versionId: "forever" })];
            await expect(sync.fetchEntry("g1", "forever|pulse|thunderstrike|EU")).resolves.toMatchObject({ error: expect.stringMatching(/keine Warcraft-Logs-Seite/) });
            expect(client.getGuildReports).not.toHaveBeenCalled();
        });

        it("429 pauses only that site: the next fetch there waits, another site is asked", async () => {
            mockConfig.serverSettings.g1.wclGuilds = [entry(), entry({ versionId: "classic" })];
            client.getGuildReports.mockRejectedValueOnce(httpError(429));
            await expect(sync.fetchEntry("g1", KEY)).resolves.toMatchObject({ error: expect.stringMatching(/429/) });
            expect(client.getGuildReports).toHaveBeenCalledTimes(1);

            await expect(sync.fetchEntry("g1", KEY)).resolves.toMatchObject({ error: expect.stringMatching(/429/) });
            expect(client.getGuildReports).toHaveBeenCalledTimes(1); // paused, not asked

            await expect(sync.fetchEntry("g1", "classic|pulse|thunderstrike|EU")).resolves.toMatchObject({ error: "" });
            expect(client.getGuildReports).toHaveBeenCalledTimes(2);
        });

        it("an edit of the list while WCL answered is kept (lost update), a removed entry gets no note", async () => {
            let answer;
            client.getGuildReports.mockImplementation(() => new Promise((r) => { answer = r; }));
            const p = sync.fetchEntry("g1", KEY);
            await Promise.resolve();
            // the orga adds a guild and changes the interval meanwhile
            mockConfig = { ...mockConfig, serverSettings: { g1: { ...mockConfig.serverSettings.g1, wclGuilds: [entry({ interval: 15 }), entry({ guildName: "Neu" })] } } };
            answer([]);
            const result = await p;
            expect(stored()).toHaveLength(2);
            expect(stored()[0]).toMatchObject({ interval: 15, lastRunAt: result.at });
            expect(stored()[1]).toMatchObject({ guildName: "Neu", lastRunAt: 0, lastResult: null });

            client.getGuildReports.mockImplementation(() => new Promise((r) => { answer = r; }));
            const q = sync.fetchEntry("g1", KEY);
            await Promise.resolve();
            mockConfig.serverSettings.g1.wclGuilds = [];
            const saves = settingsStore.saveConfig.mock.calls.length;
            answer([]);
            await q;
            expect(settingsStore.saveConfig.mock.calls.length).toBe(saves);
            expect(stored()).toEqual([]);
        });

        it("a double click joins the running fetch: WCL is asked once", async () => {
            let answer;
            client.getGuildReports.mockImplementation(() => new Promise((r) => { answer = r; }));
            const a = sync.fetchEntry("g1", KEY);
            const b = sync.fetchEntry("g1", KEY);
            expect(b).toBe(a);
            expect(sync.isFetching("g1", KEY)).toBe(true);
            await Promise.resolve();
            answer([]);
            await a;
            expect(client.getGuildReports).toHaveBeenCalledTimes(1);
            expect(sync.isFetching("g1", KEY)).toBe(false);
        });
    });

    describe("runDue", () => {
        it("fetches the due entries of every server one after another, skips Aus and the not yet due", async () => {
            const now = Date.now();
            mockConfig.serverSettings = {
                g1: { wclGuilds: [entry(), entry({ guildName: "Aus", interval: 0 }), entry({ guildName: "Frisch", lastRunAt: now - 5 * MIN })] },
                g2: { wclGuilds: [entry({ versionId: "classic", interval: 15, lastRunAt: now - 20 * MIN })] },
            };
            let active = 0;
            let maxActive = 0;
            client.getGuildReports.mockImplementation(async () => {
                active++; maxActive = Math.max(maxActive, active);
                await new Promise((r) => setImmediate(r));
                active--;
                return [];
            });
            await expect(sync.runDue(now)).resolves.toBe(2);
            expect(client.getGuildReports.mock.calls.map((c) => c[0])).toEqual(["Pulse", "Pulse"]);
            expect(maxActive).toBe(1);
            expect(mockConfig.serverSettings.g2.wclGuilds[0].lastRunAt).toBeGreaterThan(now - 20 * MIN);
            expect(mockConfig.serverSettings.g1.wclGuilds[1].lastRunAt).toBe(0);
        });

        it("a pass still running is joined, not doubled", async () => {
            let answer;
            client.getGuildReports.mockImplementation(() => new Promise((r) => { answer = r; }));
            const a = sync.runDue();
            const b = sync.runDue();
            expect(b).toBe(a);
            await new Promise((r) => setImmediate(r));
            answer([]);
            await a;
            expect(client.getGuildReports).toHaveBeenCalledTimes(1);
        });

        it("a broken config ends the pass with 0, the next one runs again", async () => {
            settingsStore.getConfig.mockImplementationOnce(() => { throw new Error("disk"); });
            await expect(sync.runDue()).resolves.toBe(0);
            await expect(sync.runDue()).resolves.toBe(1);
        });
    });

    describe("start/stop", () => {
        it("a test instance starts no tick, a manual fetch still works", async () => {
            jest.useFakeTimers();
            try {
                sync.startWclGuildSync({ live: false });
                jest.advanceTimersByTime(5 * MIN);
                expect(settingsStore.getConfig).not.toHaveBeenCalled();
            } finally {
                sync._resetForTests();
                jest.useRealTimers();
            }
            await expect(sync.fetchEntry("g1", KEY)).resolves.toMatchObject({ error: "" });
        });

        it("without an option it asks runMode: Jest is not live", () => {
            jest.useFakeTimers();
            try {
                sync.startWclGuildSync();
                jest.advanceTimersByTime(5 * MIN);
                expect(settingsStore.getConfig).not.toHaveBeenCalled();
            } finally {
                sync._resetForTests();
                jest.useRealTimers();
            }
        });

        it("ticks every minute once started (idempotent), stops cleanly", () => {
            jest.useFakeTimers();
            mockConfig.serverSettings.g1.wclGuilds = [];
            try {
                sync.startWclGuildSync({ live: true });
                sync.startWclGuildSync({ live: true });
                jest.advanceTimersByTime(MIN);
                expect(settingsStore.getConfig).toHaveBeenCalledTimes(1);
                sync.stopWclGuildSync();
                jest.advanceTimersByTime(5 * MIN);
                expect(settingsStore.getConfig).toHaveBeenCalledTimes(1);
            } finally {
                sync._resetForTests();
                jest.useRealTimers();
            }
        });
    });
});
