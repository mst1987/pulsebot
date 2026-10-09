import { describe, expect, it } from "vitest";
import type { AttendanceStatus } from "../../api";
import { attendanceGroups } from "./rosterView";

const night = (eventId: string, startTime: number, status?: AttendanceStatus, reason = "") => ({ eventId, title: "Kara", startTime, reason, ...(status ? { status } : {}) });

describe("attendanceGroups", () => {
    it("groups by status in the order Dabei, Bench, Nicht angemeldet, Abgemeldet, Urlaub, Nicht erschienen — newest first (#677)", () => {
        const g = attendanceGroups({
            attended: 3, total: 9, pct: 33,
            present: [
                { eventId: "p1", title: "Kara", startTime: 100, status: "present" },
                { eventId: "p2", title: "Kara", startTime: 300, status: "present" },
                { eventId: "b1", title: "Kara", startTime: 150, status: "bench" },
            ],
            missed: [
                night("x", 50, "noShow"), night("v", 200, "vacation"), night("a", 400, "absence"),
                night("n2", 250, "noSignup"), night("n1", 10, "noSignup"), night("x2", 500, "noShow"),
            ],
        });
        expect(g.map((x) => [x.status, x.nights.map((n) => n.eventId)])).toEqual([
            ["present", ["p2", "p1"]],
            ["bench", ["b1"]],
            ["noSignup", ["n2", "n1"]],
            ["absence", ["a"]],
            ["vacation", ["v"]],
            ["noShow", ["x2", "x"]],
        ]);
    });

    it("reads an older answer without status codes from the server's German words", () => {
        const g = attendanceGroups({
            attended: 1, total: 3, pct: 33,
            present: [{ eventId: "p", title: "Kara", startTime: 100 }],
            missed: [night("a", 50, undefined, "abgemeldet"), night("e", 60, undefined, "Ersatzbank")],
        });
        expect(g.map((x) => [x.status, x.nights.map((n) => n.eventId)])).toEqual([["present", ["p"]], ["bench", ["e"]], ["absence", ["a"]]]);
    });

    it("keeps the override of a night set by hand", () => {
        const override = { status: "bench" as const, reason: "hat gewartet", by: "1", byName: "Marc", at: 5 };
        const g = attendanceGroups({ attended: 1, total: 1, pct: 100, missed: [], present: [{ eventId: "o", title: "Kara", startTime: 1, status: "bench", override }] });
        expect(g[0]).toEqual({ status: "bench", nights: [{ eventId: "o", startTime: 1, status: "bench", override }] });
    });

    it("falls back to the character page's night list for the counted nights", () => {
        const g = attendanceGroups({
            attended: 1, total: 2, pct: 50, missed: [night("m", 200, "noShow")],
            raids: [{ ...night("m", 200, "noShow"), attended: false }, { ...night("x", 100, "present"), attended: true }],
        });
        expect(g.map((x) => [x.status, x.nights.map((n) => n.eventId)])).toEqual([["present", ["x"]], ["noShow", ["m"]]]);
    });

    it("no lists at all: no groups", () => {
        expect(attendanceGroups({ attended: 0, total: 0, pct: null, missed: [] })).toEqual([]);
    });
});
