const {
    matchLogsForEvent, pendingLogsForEvent, buildRecentEvents,
    LOG_WINDOW_BEFORE_MS, LOG_WINDOW_AFTER_MS, RECENT_WINDOW_DAYS,
} = require("../../src/web/recentEvents");

const HOUR = 3600000;
const DAY = 24 * HOUR;
// A fixed "now" so the tests never depend on the wall clock.
const NOW = 1_700_000_000_000;
// An event that started 3h ago (startTime is in SECONDS, like Raid-Helper's).
const startSecs = (msAgo) => Math.floor((NOW - msAgo) / 1000);

const log = (id, postedAt, extra = {}) => ({ id, reportId: `rep-${id}`, postedAt, ...extra });

describe("web/recentEvents", () => {
    describe("matchLogsForEvent", () => {
        const event = { id: "e1", startTime: startSecs(3 * HOUR) };
        const startMs = event.startTime * 1000;

        it("lists the logs assigned to this event, newest post first", () => {
            const logs = [
                log("during", startMs + 2 * HOUR, { eventId: "e1" }),
                log("nextMorning", startMs + 12 * HOUR, { eventId: "e1" }),
                log("justBefore", startMs - HOUR, { eventId: "e1" }),
            ];
            expect(matchLogsForEvent(event, logs).map((l) => l.id))
                .toEqual(["nextMorning", "during", "justBefore"]);
        });

        it("keeps an assigned log whatever the time — the assignment decides, not the window", () => {
            const logs = [log("assigned", startMs + 5 * DAY, { eventId: "e1" })];
            expect(matchLogsForEvent(event, logs).map((l) => l.id)).toEqual(["assigned"]);
        });

        it("never claims an unassigned log, even when the time fits perfectly", () => {
            // This is the whole point: the raid list must not show a log the
            // event's detail page reports as unassigned.
            expect(matchLogsForEvent(event, [log("unassigned", startMs + HOUR)])).toEqual([]);
        });

        it("drops a log assigned to a DIFFERENT event even when the time fits", () => {
            const logs = [
                log("otherEvent", startMs + 2 * HOUR, { eventId: "e2" }),
                log("mine", startMs + HOUR, { eventId: "e1" }),
            ];
            expect(matchLogsForEvent(event, logs).map((l) => l.id)).toEqual(["mine"]);
        });

        it("returns nothing for an event without an id", () => {
            expect(matchLogsForEvent({ startTime: startSecs(HOUR) }, [log("x", NOW, { eventId: "e1" })])).toEqual([]);
            expect(matchLogsForEvent(null, [log("x", NOW)])).toEqual([]);
        });

        it("tolerates a missing log list", () => {
            expect(matchLogsForEvent(event)).toEqual([]);
        });
    });

    describe("pendingLogsForEvent", () => {
        const event = { id: "e1", startTime: startSecs(3 * HOUR) };
        const startMs = event.startTime * 1000;

        it("reports unassigned logs posted within the window, newest first", () => {
            const logs = [
                log("during", startMs + 2 * HOUR),
                log("nextMorning", startMs + 12 * HOUR),
                log("justBefore", startMs - HOUR),
            ];
            expect(pendingLogsForEvent(event, logs).map((l) => l.id))
                .toEqual(["nextMorning", "during", "justBefore"]);
        });

        it("ignores logs posted before or after the window", () => {
            const logs = [
                log("tooEarly", startMs - LOG_WINDOW_BEFORE_MS - 1),
                log("tooLate", startMs + LOG_WINDOW_AFTER_MS + 1),
            ];
            expect(pendingLogsForEvent(event, logs)).toEqual([]);
        });

        it("includes logs exactly on the window edges", () => {
            const logs = [
                log("edgeBefore", startMs - LOG_WINDOW_BEFORE_MS),
                log("edgeAfter", startMs + LOG_WINDOW_AFTER_MS),
            ];
            expect(pendingLogsForEvent(event, logs)).toHaveLength(2);
        });

        it("skips logs that already carry an assignment — to this event or any other", () => {
            const logs = [
                log("mine", startMs + HOUR, { eventId: "e1" }),
                log("other", startMs + HOUR, { eventId: "e2" }),
            ];
            expect(pendingLogsForEvent(event, logs)).toEqual([]);
        });

        it("returns nothing without a start time and tolerates a missing log list", () => {
            expect(pendingLogsForEvent({ id: "e1" }, [log("x", NOW)])).toEqual([]);
            expect(pendingLogsForEvent(event)).toEqual([]);
        });
    });

    describe("buildRecentEvents", () => {
        it("keeps only events that already started, newest first", () => {
            const events = [
                { id: "past1", startTime: startSecs(2 * DAY) },
                { id: "future", startTime: startSecs(-2 * DAY) },
                { id: "past2", startTime: startSecs(5 * HOUR) },
            ];
            expect(buildRecentEvents(events, { now: NOW }).map((e) => e.id))
                .toEqual(["past2", "past1"]);
        });

        it("drops events older than the lookback window", () => {
            const events = [
                { id: "recent", startTime: startSecs(3 * DAY) },
                { id: "ancient", startTime: startSecs((RECENT_WINDOW_DAYS + 1) * DAY) },
            ];
            expect(buildRecentEvents(events, { now: NOW }).map((e) => e.id)).toEqual(["recent"]);
        });

        it("honours a custom lookback window", () => {
            const events = [{ id: "old", startTime: startSecs(10 * DAY) }];
            expect(buildRecentEvents(events, { now: NOW, windowDays: 7 })).toEqual([]);
            expect(buildRecentEvents(events, { now: NOW, windowDays: 14 })).toHaveLength(1);
        });

        it("caps the result at the limit", () => {
            const events = Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, startTime: startSecs((i + 1) * DAY) }));
            expect(buildRecentEvents(events, { now: NOW, limit: 3 }).map((e) => e.id))
                .toEqual(["e0", "e1", "e2"]);
            expect(buildRecentEvents(events, { now: NOW })).toHaveLength(5); // default limit
        });

        it("treats a just-started raid as still running when minAgeMs is set", () => {
            const events = [{ id: "running", startTime: startSecs(HOUR) }];
            expect(buildRecentEvents(events, { now: NOW, minAgeMs: 4 * HOUR })).toEqual([]);
            expect(buildRecentEvents(events, { now: NOW, minAgeMs: 0 })).toHaveLength(1);
        });

        it("attaches each event's assigned logs and leaves the event fields intact", () => {
            const events = [
                { id: "e1", title: "Kara", startTime: startSecs(2 * DAY), channelId: "c1" },
                { id: "e2", title: "Gruul", startTime: startSecs(9 * DAY), channelId: "c2" },
            ];
            const logs = [
                log("kara", (NOW - 2 * DAY) + 3 * HOUR, { eventId: "e1" }),
                log("gruul", (NOW - 9 * DAY) + HOUR, { eventId: "e2" }),
                log("stray", NOW - 5 * DAY),
            ];
            const [kara, gruul] = buildRecentEvents(events, { now: NOW, logs });
            expect(kara).toMatchObject({ id: "e1", title: "Kara", channelId: "c1" });
            expect(kara.logs.map((l) => l.id)).toEqual(["kara"]);
            expect(gruul.logs.map((l) => l.id)).toEqual(["gruul"]);
        });

        it("reports a time-matching but unassigned log as pending, not as the event's log", () => {
            const events = [{ id: "e1", startTime: startSecs(2 * DAY) }];
            const logs = [log("undecided", (NOW - 2 * DAY) + 3 * HOUR)];
            const [ev] = buildRecentEvents(events, { now: NOW, logs });
            expect(ev.logs).toEqual([]);
            expect(ev.pendingLogs.map((l) => l.id)).toEqual(["undecided"]);
        });

        it("gives an event without logs empty arrays", () => {
            const events = [{ id: "e1", startTime: startSecs(DAY) }];
            const [ev] = buildRecentEvents(events, { now: NOW, logs: [] });
            expect(ev.logs).toEqual([]);
            expect(ev.pendingLogs).toEqual([]);
        });

        it("ignores events without a start time and tolerates no input", () => {
            expect(buildRecentEvents([{ id: "e1" }], { now: NOW })).toEqual([]);
            expect(buildRecentEvents(null, { now: NOW })).toEqual([]);
            expect(buildRecentEvents()).toEqual([]);
        });
    });
});
