// stopJobs() really ends the jobs (#424): with the real job modules and fake
// timers, every interval and delayed first run they set up is gone after the
// stop, and a new start sets them up again. The stores read the suite's own
// empty data directory (test/setup/environment.js) and the bot has no Discord
// client, so the boot-time runs find nothing to do.
jest.mock("../../../src/utils/raidhelper/client", () => ({
    ...jest.requireActual("../../../src/utils/raidhelper/client"),
    createRaidhelperClient: () => ({ fetchEvents: async () => [], getAllEvents: async () => [], getSetup: async () => undefined }),
}));

const { startJobs, stopJobs } = require("../../../src/web/http/jobs");

beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
    stopJobs();
    jest.useRealTimers();
    console.log.mockRestore();
});

describe("web/http/jobs with the real job modules", () => {
    it("sets up timers on start and leaves none behind on stop", () => {
        startJobs();
        // eight intervals (the event message sync has one too) plus the delayed
        // first runs of the role sync, the talk overview, the event series and the
        // event message sweep
        expect(jest.getTimerCount()).toBeGreaterThanOrEqual(9);
        stopJobs();
        expect(jest.getTimerCount()).toBe(0);
    });

    it("starts afresh after a stop", () => {
        startJobs();
        const running = jest.getTimerCount();
        stopJobs();
        startJobs();
        expect(jest.getTimerCount()).toBe(running);
    });

    it("stops idempotently, also when nothing runs", () => {
        expect(() => {
            stopJobs();
            stopJobs();
        }).not.toThrow();
        expect(jest.getTimerCount()).toBe(0);
    });
});
