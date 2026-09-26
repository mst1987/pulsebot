const applicationState = require("../../../src/utils/recruitment/applicationState.js");
const { pendingApplications, sweepStaleApplications } = applicationState;

describe("utils/applicationState", () => {
    beforeEach(() => {
        pendingApplications.clear();
        applicationState.stop();
    });

    afterEach(() => {
        applicationState.stop();
    });

    it("exposes a Map for pending applications", () => {
        expect(pendingApplications).toBeInstanceOf(Map);
        pendingApplications.set("u1", { timestamp: Date.now(), foo: "bar" });
        expect(pendingApplications.get("u1")).toEqual({ timestamp: expect.any(Number), foo: "bar" });
    });

    it("sweepStaleApplications removes entries older than 30 minutes but keeps fresh ones", () => {
        const now = Date.now();
        pendingApplications.set("stale", { timestamp: now - 31 * 60 * 1000 });
        pendingApplications.set("fresh", { timestamp: now });

        sweepStaleApplications(now);

        expect(pendingApplications.has("stale")).toBe(false);
        expect(pendingApplications.has("fresh")).toBe(true);
    });

    it("does not sweep before start() is called (no auto-start on require)", () => {
        jest.useFakeTimers();
        try {
            const now = Date.now();
            pendingApplications.set("stale", { timestamp: now - 31 * 60 * 1000 });
            jest.advanceTimersByTime(10 * 60 * 1000);
            expect(pendingApplications.has("stale")).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });

    it("start() runs a periodic sweep and is idempotent", () => {
        jest.useFakeTimers();
        try {
            const timer1 = applicationState.start({ intervalMs: 1000 });
            const timer2 = applicationState.start({ intervalMs: 1000 });
            expect(timer2).toBe(timer1);

            const now = Date.now();
            pendingApplications.set("stale", { timestamp: now - 31 * 60 * 1000 });
            jest.advanceTimersByTime(1000);

            expect(pendingApplications.has("stale")).toBe(false);
        } finally {
            jest.useRealTimers();
        }
    });

    it("start()'s timer is unref'd so it never keeps the process alive on its own", () => {
        const timer = applicationState.start({ intervalMs: 60000 });
        expect(timer.hasRef()).toBe(false);
    });

    it("stop() clears the timer so no further sweep runs", () => {
        jest.useFakeTimers();
        try {
            applicationState.start({ intervalMs: 1000 });
            applicationState.stop();

            const now = Date.now();
            pendingApplications.set("stale", { timestamp: now - 31 * 60 * 1000 });
            jest.advanceTimersByTime(5000);

            expect(pendingApplications.has("stale")).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });
});
