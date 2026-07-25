const {
    candidatesFor, bestMatch, autoMatches, annotateMatches, isLinked, eventStartMs,
    HOUR_MS,
} = require("../../src/web/logEventMatch");

// Raid-Helper hands out start times in SECONDS; the logs carry ms timestamps.
const START = Date.UTC(2026, 6, 24, 18, 0, 0); // Fri 24.07.2026 18:00 UTC
const secs = (ms) => Math.floor(ms / 1000);

const event = (over = {}) => ({
    id: "e1", title: "SSC/TK", startTime: secs(START), categoryId: "cat1", ...over,
});
const log = (over = {}) => ({
    id: "l1", reportId: "RPT1", postedAt: START + 30 * 60 * 1000, ...over,
});

describe("web/logEventMatch", () => {
    describe("eventStartMs", () => {
        it("converts second-based Raid-Helper times to ms", () => {
            expect(eventStartMs({ startTime: secs(START) })).toBe(START);
        });

        it("passes millisecond values through", () => {
            expect(eventStartMs({ startTime: START })).toBe(START);
        });

        it("returns 0 for missing/invalid times", () => {
            expect(eventStartMs({})).toBe(0);
            expect(eventStartMs({ startTime: "x" })).toBe(0);
            expect(eventStartMs({ startTime: -5 })).toBe(0);
            expect(eventStartMs(null)).toBe(0);
        });
    });

    describe("candidatesFor", () => {
        it("matches a log posted shortly after the raid start", () => {
            const cands = candidatesFor(log(), [event()]);
            expect(cands).toHaveLength(1);
            expect(cands[0].event.id).toBe("e1");
            expect(cands[0].diffMs).toBe(30 * 60 * 1000);
        });

        it("matches a log posted slightly BEFORE the start (early logging)", () => {
            const cands = candidatesFor(log({ postedAt: START - 45 * 60 * 1000 }), [event()]);
            expect(cands).toHaveLength(1);
            expect(cands[0].diffMs).toBe(-45 * 60 * 1000);
        });

        it("ignores events outside the window in both directions", () => {
            const tooEarly = log({ postedAt: START - 5 * HOUR_MS });
            const tooLate = log({ postedAt: START + 20 * HOUR_MS });
            expect(candidatesFor(tooEarly, [event()])).toEqual([]);
            expect(candidatesFor(tooLate, [event()])).toEqual([]);
        });

        it("honours a custom window", () => {
            const early = log({ postedAt: START - 5 * HOUR_MS });
            expect(candidatesFor(early, [event()], { beforeMs: 6 * HOUR_MS })).toHaveLength(1);
        });

        it("ranks the closest event first", () => {
            const later = event({ id: "e2", title: "Kara", startTime: secs(START + 3 * HOUR_MS) });
            const cands = candidatesFor(log({ postedAt: START + 2.5 * HOUR_MS }), [event(), later]);
            expect(cands.map((c) => c.event.id)).toEqual(["e2", "e1"]);
        });

        it("prefers an event from the log channel's own category over a closer one", () => {
            const sameCat = event({ id: "e2", title: "Kara", startTime: secs(START - 4 * HOUR_MS), categoryId: "cat9" });
            const cands = candidatesFor(log({ categoryId: "cat9" }), [event(), sameCat]);
            expect(cands[0].event.id).toBe("e2");
            expect(cands[0].sameCategory).toBe(true);
            expect(cands[1].sameCategory).toBe(false);
        });

        it("returns nothing without a usable log time", () => {
            expect(candidatesFor({ id: "l1" }, [event()])).toEqual([]);
        });

        it("skips events without a start time and tolerates empty input", () => {
            expect(candidatesFor(log(), [{ id: "x" }])).toEqual([]);
            expect(candidatesFor(log(), [])).toEqual([]);
            expect(candidatesFor(log(), null)).toEqual([]);
        });

        it("derives the log time from the Discord message id when postedAt is missing", () => {
            // snowflake = ((ms - discord epoch) << 22)
            const messageId = String((BigInt(START + 60 * 60 * 1000 - 1420070400000) << 22n));
            const cands = candidatesFor({ id: "l1", messageId }, [event()]);
            expect(cands).toHaveLength(1);
            expect(cands[0].diffMs).toBe(60 * 60 * 1000);
        });
    });

    describe("bestMatch", () => {
        it("returns the single obvious match as unambiguous", () => {
            const { match, ambiguous } = bestMatch(log(), [event()]);
            expect(match.event.id).toBe("e1");
            expect(ambiguous).toBe(false);
        });

        it("flags two similarly plausible events as ambiguous", () => {
            // two raids the same evening, log posted right between them
            const a = event({ id: "e1", startTime: secs(START) });
            const b = event({ id: "e2", startTime: secs(START + 2 * HOUR_MS) });
            const { match, ambiguous } = bestMatch(log({ postedAt: START + HOUR_MS }), [a, b]);
            expect(match).not.toBeNull();
            expect(ambiguous).toBe(true);
        });

        it("is not ambiguous when the second event is clearly further away", () => {
            const a = event({ id: "e1", startTime: secs(START) });
            const b = event({ id: "e2", startTime: secs(START - 9 * HOUR_MS) });
            const res = bestMatch(log(), [a, b]);
            expect(res.candidates).toHaveLength(2); // both in the window …
            expect(res.match.event.id).toBe("e1"); // … but only one is close
            expect(res.ambiguous).toBe(false);
        });

        it("resolves an otherwise ambiguous pair via the log's category", () => {
            const a = event({ id: "e1", startTime: secs(START), categoryId: "cat1" });
            const b = event({ id: "e2", startTime: secs(START + 2 * HOUR_MS), categoryId: "cat2" });
            const l = log({ postedAt: START + HOUR_MS, categoryId: "cat2" });
            const { match, ambiguous } = bestMatch(l, [a, b]);
            expect(match.event.id).toBe("e2");
            expect(ambiguous).toBe(false);
        });

        it("reports no match when nothing is in the window", () => {
            const res = bestMatch(log({ postedAt: START + 30 * HOUR_MS }), [event()]);
            expect(res).toEqual({ match: null, candidates: [], ambiguous: false });
        });
    });

    describe("isLinked", () => {
        it("detects an existing assignment", () => {
            expect(isLinked({ eventId: "e1" })).toBe(true);
            expect(isLinked({ eventId: "  " })).toBe(false);
            expect(isLinked({})).toBe(false);
            expect(isLinked(null)).toBe(false);
        });
    });

    describe("annotateMatches", () => {
        it("attaches render-ready candidates and the ambiguity flag", () => {
            const items = [log()];
            annotateMatches(items, [event({ categoryName: "Raids" })]);
            expect(items[0].matchAmbiguous).toBe(false);
            expect(items[0].candidates).toEqual([{
                eventId: "e1", title: "SSC/TK", startTime: secs(START),
                categoryName: "Raids", diffMs: 30 * 60 * 1000, sameCategory: false,
            }]);
        });

        it("leaves already linked logs untouched", () => {
            const items = [log({ eventId: "e9", eventLabel: "Alt" })];
            annotateMatches(items, [event()]);
            expect(items[0].candidates).toBeUndefined();
            expect(items[0].eventId).toBe("e9");
        });

        it("annotates an empty candidate list when nothing matches", () => {
            const items = [log({ postedAt: START + 30 * HOUR_MS })];
            annotateMatches(items, [event()]);
            expect(items[0].candidates).toEqual([]);
        });
    });

    describe("autoMatches", () => {
        it("returns one pairing per unambiguously matched log", () => {
            const logs = [log({ id: "l1" }), log({ id: "l2", postedAt: START + 2 * HOUR_MS })];
            const pairs = autoMatches(logs, [event()]);
            expect(pairs.map((p) => [p.log.id, p.event.id])).toEqual([["l1", "e1"], ["l2", "e1"]]);
        });

        it("skips ambiguous, unmatched and already linked logs", () => {
            const a = event({ id: "e1", startTime: secs(START) });
            const b = event({ id: "e2", startTime: secs(START + 5 * HOUR_MS) });
            // a second raid two hours after `a` makes the early log a coin flip
            const c = event({ id: "e3", startTime: secs(START + 2 * HOUR_MS) });
            const logs = [
                log({ id: "ambiguous", postedAt: START + HOUR_MS }),
                log({ id: "nomatch", postedAt: START + 40 * HOUR_MS }),
                log({ id: "linked", eventId: "e1" }),
                log({ id: "clean", postedAt: START + 5 * HOUR_MS + 10 * 60 * 1000 }),
            ];
            const pairs = autoMatches(logs, [a, b, c]);
            expect(pairs.map((p) => p.log.id)).toEqual(["clean"]);
            expect(pairs[0].event.id).toBe("e2");
        });

        it("tolerates empty input", () => {
            expect(autoMatches([], [event()])).toEqual([]);
            expect(autoMatches(null, null)).toEqual([]);
        });
    });
});
