import { describe, expect, it } from "vitest";
import { attendanceGroups } from "./rosterView";

const night = (eventId: string, startTime: number, reason = "nicht im Log") => ({ eventId, title: "Kara", startTime, reason });

describe("attendanceGroups", () => {
    it("lists the attended nights and the missed ones by reason, known reasons in a fixed order, newest first", () => {
        const g = attendanceGroups({
            attended: 2, total: 6, pct: 33,
            present: [{ eventId: "p1", title: "Kara", startTime: 100 }, { eventId: "p2", title: "Kara", startTime: 300 }],
            missed: [night("a", 50, "Ersatzbank"), night("b", 200), night("c", 400, "abgemeldet"), night("d", 250), night("e", 10, "Sonderfall")],
        });
        expect(g.present.map((n) => n.eventId)).toEqual(["p2", "p1"]);
        expect(g.absent.map((x) => [x.reason, x.key, x.nights.map((n) => n.eventId)])).toEqual([
            ["nicht im Log", "notInLog", ["d", "b"]],
            ["abgemeldet", "absence", ["c"]],
            ["Ersatzbank", "bench", ["a"]],
            ["Sonderfall", "", ["e"]],
        ]);
    });

    it("falls back to the character page's night list for the attended nights", () => {
        const g = attendanceGroups({
            attended: 1, total: 2, pct: 50, missed: [night("m", 200)],
            raids: [{ ...night("m", 200), attended: false }, { ...night("x", 100, "im Log"), attended: true }],
        });
        expect(g.present.map((n) => n.eventId)).toEqual(["x"]);
    });

    it("no lists at all: two empty groups", () => {
        expect(attendanceGroups({ attended: 0, total: 0, pct: null, missed: [] })).toEqual({ present: [], absent: [] });
    });
});
