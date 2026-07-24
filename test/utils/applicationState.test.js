// Use fake timers BEFORE requiring the module so its module-level setInterval
// (the 30-minute stale-entry sweep) registers against the fake clock.
jest.useFakeTimers();
const { pendingApplications } = require("../../src/utils/applicationState.js");

describe("utils/applicationState", () => {
    beforeEach(() => {
        pendingApplications.clear();
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    it("exposes a Map for pending applications", () => {
        expect(pendingApplications).toBeInstanceOf(Map);
        pendingApplications.set("u1", { timestamp: Date.now(), foo: "bar" });
        expect(pendingApplications.get("u1")).toEqual({ timestamp: expect.any(Number), foo: "bar" });
    });

    it("sweeps entries older than 30 minutes but keeps fresh ones", () => {
        const now = Date.now();
        pendingApplications.set("stale", { timestamp: now - 31 * 60 * 1000 });
        pendingApplications.set("fresh", { timestamp: now });

        // Advance past one 5-minute sweep interval.
        jest.advanceTimersByTime(5 * 60 * 1000);

        expect(pendingApplications.has("stale")).toBe(false);
        expect(pendingApplications.has("fresh")).toBe(true);
    });
});
