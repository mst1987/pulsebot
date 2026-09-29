// #534: the plan's progress from the event's linked log (src/services/raidplan/raidplanProgress.js):
// the raid window, the report lookup, the one-request-per-minute cache and the failure path.
// WCL is never hit: the client is a stand-in (and the module mock makes a forgotten one fail loudly).
jest.mock("../../../src/classes/warcraftlogs", () => jest.fn(() => ({ getFights: jest.fn(async () => { throw new Error("no real WCL in tests"); }) })));
jest.mock("../../../src/stores/logStore", () => ({ listLogsForEvent: jest.fn(() => []) }));

const logStore = require("../../../src/stores/logStore");
const WarcraftLogs = require("../../../src/classes/warcraftlogs");
const progress = require("../../../src/services/raidplan/raidplanProgress");

const START = 1800000000; // seconds, like an own event
const START_MS = START * 1000;
const event = { id: "eh_1", startTime: START, instanceIds: ["bt"] };
const FIGHTS = { fights: [
    { id: 1, boss: 50601, name: "High Warlord Naj'entus", kill: true, inProgress: false },
    { id: 2, boss: 0, name: "Trash" },
    { id: 3, boss: 50602, name: "Supremus", kill: false, inProgress: false },
] };
const client = (answer = FIGHTS) => ({ getFights: jest.fn(async () => answer) });

beforeEach(() => {
    jest.clearAllMocks();
    progress._resetCache();
    logStore.listLogsForEvent.mockReturnValue([{ id: "l1", reportId: "abcDEF123" }]);
    jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("raid window", () => {
    it("runs from 30 minutes before the start to 6 hours after", () => {
        expect(progress.inRaidWindow(event, START_MS - 31 * 60000)).toBe(false);
        expect(progress.inRaidWindow(event, START_MS - 30 * 60000)).toBe(true);
        expect(progress.inRaidWindow(event, START_MS + 6 * 3600000)).toBe(true);
        expect(progress.inRaidWindow(event, START_MS + 6 * 3600000 + 1)).toBe(false);
        // a start in ms is read as such; no start means no window
        expect(progress.inRaidWindow({ startTime: START_MS }, START_MS)).toBe(true);
        expect(progress.inRaidWindow({ startTime: 0 }, START_MS)).toBe(false);
        expect(progress.raidWindow({})).toBeNull();
    });

    it("asks nothing outside the window and answers empty", async () => {
        const c = client();
        const p = await progress.progressFor(event, { now: START_MS + 7 * 3600000, client: c });
        expect(p).toEqual({ live: false, killed: [], current: null, next: null, updatedAt: null });
        expect(c.getFights).not.toHaveBeenCalled();
        expect(await progress.progressFor(null, { client: c })).toMatchObject({ live: false });
    });
});

describe("progressFor", () => {
    it("reads the newest linked log with a report and derives killed / current / next", async () => {
        logStore.listLogsForEvent.mockReturnValue([{ id: "l0" }, { id: "l1", reportId: "abcDEF123" }]);
        const c = client();
        const p = await progress.progressFor(event, { now: START_MS + 3600000, client: c });
        expect(c.getFights).toHaveBeenCalledWith("abcDEF123");
        expect(p).toEqual({ live: true, killed: ["bt/high-warlord-najentus"], current: null, next: "bt/supremus", updatedAt: START_MS + 3600000 });
        expect(progress.reportIdForEvent("eh_1")).toBe("abcDEF123");
    });

    it("answers empty without a linked log", async () => {
        logStore.listLogsForEvent.mockReturnValue([]);
        const c = client();
        expect(await progress.progressFor(event, { now: START_MS, client: c })).toMatchObject({ live: false, killed: [], current: null, next: null });
        expect(c.getFights).not.toHaveBeenCalled();
    });

    it("asks WCL at most once a minute per report, however many pages poll", async () => {
        const c = client();
        const now = START_MS + 3600000;
        await Promise.all([progress.progressFor(event, { now, client: c }), progress.progressFor(event, { now: now + 1000, client: c })]);
        await progress.progressFor(event, { now: now + 59000, client: c });
        expect(c.getFights).toHaveBeenCalledTimes(1);
        const later = await progress.progressFor(event, { now: now + 60000, client: c });
        expect(c.getFights).toHaveBeenCalledTimes(2);
        expect(later.updatedAt).toBe(now + 60000);
    });

    it("caches a failure for the minute too and answers empty (private report, rate limit, no key)", async () => {
        const c = { getFights: jest.fn(async () => { throw Object.assign(new Error("429"), { status: 429 }); }) };
        const now = START_MS;
        expect(await progress.progressFor(event, { now, client: c })).toMatchObject({ live: false, killed: [] });
        await progress.progressFor(event, { now: now + 30000, client: c });
        expect(c.getFights).toHaveBeenCalledTimes(1);
        // without a client the real class is built; a missing key throws there and ends the same way
        WarcraftLogs.mockImplementationOnce(() => { throw new Error("WARCRAFTLOGS_API_KEY is not set"); });
        expect(await progress.progressFor(event, { now: now + 120000 })).toMatchObject({ live: false });
    });

    it("builds the real client when none is given", async () => {
        WarcraftLogs.mockImplementationOnce(() => client());
        const p = await progress.progressFor(event, { now: START_MS });
        expect(WarcraftLogs).toHaveBeenCalled();
        expect(p.live).toBe(true);
    });

    it("lists the plan's bosses without Allgemein and trash, in the sections' order", () => {
        const b = progress.planBosses({ instanceIds: ["hyjal", "bt"] });
        expect(b[0]).toEqual({ key: "hyjal/rage-winterchill", name: "Rage Winterchill", instanceId: "hyjal" });
        expect(b.some((x) => x.key.endsWith("/trash") || x.key === "general")).toBe(false);
        expect(b.map((x) => x.name).slice(9, 11)).toEqual(["Reliquary of the Lost", "Gurtogg Bloodboil"]);
    });
});
