// The background jobs moved out of server.js (#424): jobs.js starts each one
// exactly once, in the old order, and stopJobs() ends all of them.
const mockCalls = [];
function mockJob(startName, stopName) {
    return {
        [startName]: jest.fn(() => mockCalls.push(`start:${startName}`)),
        [stopName]: jest.fn(() => mockCalls.push(`stop:${stopName}`)),
    };
}
jest.mock("../../../src/services/discord/discord", () => ({ setClient: jest.fn() }));
jest.mock("../../../src/utils/setup/sheetCleanup", () => mockJob("startSheetCleanup", "stopSheetCleanup"));
jest.mock("../../../src/web/raidEventScan", () => mockJob("startRaidEventScan", "stopRaidEventScan"));
jest.mock("../../../src/web/logAutoLink", () => mockJob("startLogAutoLink", "stopLogAutoLink"));
jest.mock("../../../src/web/eventMessage", () => mockJob("startEventMessageSync", "stopEventMessageSync"));
jest.mock("../../../src/web/reminders", () => mockJob("startReminders", "stopReminders"));
jest.mock("../../../src/services/discord/roleSync", () => mockJob("startRoleSync", "stopRoleSync"));
jest.mock("../../../src/web/talkOverview", () => mockJob("startTalkOverview", "stopTalkOverview"));
jest.mock("../../../src/web/eventSeries", () => mockJob("startEventSeries", "stopEventSeries"));
jest.mock("../../../src/utils/recruitment/applicationState", () => mockJob("start", "stop"));

const discord = require("../../../src/services/discord/discord");
const { startJobs, stopJobs, JOBS } = require("../../../src/web/http/jobs");

const START_ORDER = [
    "startSheetCleanup", "startRaidEventScan", "startLogAutoLink", "startEventMessageSync",
    "startReminders", "startRoleSync", "startTalkOverview", "startEventSeries", "start",
];

beforeEach(() => {
    stopJobs();
    mockCalls.length = 0;
    jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => console.log.mockRestore());

describe("web/http/jobs", () => {
    it("starts every job exactly once, in the order server.js and bot.js used", () => {
        const names = startJobs();
        expect(mockCalls).toEqual(START_ORDER.map((n) => `start:${n}`));
        expect(names).toEqual([
            "sheetCleanup", "raidEventScan", "logAutoLink", "eventMessageSync",
            "reminders", "roleSync", "talkOverview", "eventSeries", "applicationState",
        ]);
        expect(JOBS.map((j) => j.name)).toEqual(names);
    });

    it("says once in the log which jobs came up", () => {
        startJobs();
        startJobs();
        const lines = console.log.mock.calls.map((c) => c[0]).filter((l) => /Background jobs started/.test(l));
        expect(lines).toEqual(["Background jobs started: sheetCleanup, raidEventScan, logAutoLink, eventMessageSync, reminders, roleSync, talkOverview, eventSeries, applicationState"]);
    });

    it("is idempotent: a second call starts nothing", () => {
        startJobs();
        mockCalls.length = 0;
        startJobs();
        expect(mockCalls).toEqual([]);
    });

    it("hands the bot client to the Discord module before any job runs", () => {
        const client = { id: "client" };
        discord.setClient.mockImplementation(() => mockCalls.push("setClient"));
        startJobs(client);
        expect(discord.setClient).toHaveBeenCalledWith(client);
        expect(mockCalls[0]).toBe("setClient");
    });

    it("leaves the client alone when none is passed", () => {
        startJobs();
        expect(discord.setClient).not.toHaveBeenCalled();
    });

    it("stops every job, in reverse order, and can start them again afterwards", () => {
        startJobs();
        mockCalls.length = 0;
        stopJobs();
        expect(mockCalls).toEqual([
            "stop:stop", "stop:stopEventSeries", "stop:stopTalkOverview", "stop:stopRoleSync", "stop:stopReminders",
            "stop:stopEventMessageSync", "stop:stopLogAutoLink", "stop:stopRaidEventScan", "stop:stopSheetCleanup",
        ]);
        mockCalls.length = 0;
        startJobs();
        expect(mockCalls).toHaveLength(START_ORDER.length);
    });
});
