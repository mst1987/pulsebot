// Roster › Abwesenheiten: the layout rules of the timeline and the raid cards.
import { describe, expect, it } from "vitest";
import type { AbsenceRaid, AbsenceRaider } from "../api";
import {
    addDays, barLabel, barPlace, categoryTone, currentAbsence, dayIndex, dayWidth, displayName, isoWeek, namesOf,
    playsLine, raidDays, raidShares, raidShort, roleLines, timelineWeeks, upcomingRaids, visibleRaiders,
} from "./absences";

const raider = (userId: string, over: Partial<AbsenceRaider> = {}): AbsenceRaider => ({
    userId, name: `acc-${userId}`, character: `Char${userId}`, spec: "", specLabel: "", classId: "", classColor: "", specIcon: "", role: "",
    periods: [], singles: [], longest: 0, long: false, awayToday: false, hint: null, onlyPresence: false, firstDay: "9999", ...over,
});

const raid = (id: string, day: string, over: Partial<AbsenceRaid> = {}): AbsenceRaid => ({
    id, title: id, startTime: Date.parse(`${day}T18:00:00Z`) / 1000, day, categoryId: "mon", categoryName: "Montag", size: 25, signed: 20, away: 0,
    roles: { tank: { need: 2, have: 2, away: 0 }, healer: { need: 5, have: 5, away: 0 } }, absent: [], url: "", ...over,
});

describe("days and weeks", () => {
    it("counts columns from the first day, also across the end of daylight saving time", () => {
        expect(dayIndex("2026-10-05", "2026-10-05")).toBe(0);
        expect(dayIndex("2026-10-05", "2026-10-12")).toBe(7);
        expect(dayIndex("2026-10-05", "2026-11-02")).toBe(28);
        expect(dayIndex("2026-10-05", "2026-10-01")).toBe(-4);
        expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    });

    it("names ISO calendar weeks, also over the turn of the year", () => {
        expect(isoWeek("2026-10-05")).toBe(41);
        expect(isoWeek("2026-12-28")).toBe(53);
        expect(isoWeek("2027-01-04")).toBe(1);
    });

    it("lays out the weeks from Monday with seven days each", () => {
        const weeks = timelineWeeks("2026-10-05", 2);
        expect(weeks.map((w) => [w.start, w.end, w.kw])).toEqual([["2026-10-05", "2026-10-11", 41], ["2026-10-12", "2026-10-18", 42]]);
        expect(weeks[1].days).toHaveLength(7);
    });

    it("gives a shorter span wider days", () => {
        expect(dayWidth(4)).toBeGreaterThan(dayWidth(8));
        expect(dayWidth(8)).toBeGreaterThan(dayWidth(13));
    });
});

describe("bars", () => {
    it("places a period on its days and clips it at both ends", () => {
        expect(barPlace({ from: "2026-10-12", to: "2026-11-08" }, "2026-10-05", 56)).toEqual({ start: 7, span: 28, cutStart: false, cutEnd: false });
        expect(barPlace({ from: "2026-09-28", to: "2026-10-07" }, "2026-10-05", 56)).toEqual({ start: 0, span: 3, cutStart: true, cutEnd: false });
        expect(barPlace({ from: "2026-11-25", to: "2026-12-20" }, "2026-10-05", 56)).toEqual({ start: 51, span: 5, cutStart: false, cutEnd: true });
        expect(barPlace({ from: "2026-12-01", to: "2026-12-05" }, "2026-10-05", 56)).toBeNull();
    });

    it("says the reason, else how long", () => {
        expect(barLabel({ comment: "Urlaub", days: 28 })).toBe("Urlaub");
        expect(barLabel({ comment: "", days: 28 })).toBe("28 Tage");
        expect(barLabel({ comment: "", days: 1 })).toBe("1 Tag");
    });
});

describe("raid days", () => {
    it("counts distinct raiders away per day and the categories raiding", () => {
        const days = raidDays([
            raid("a", "2026-10-12", { absent: [{ userId: "1", how: "period", until: "", comment: "" }, { userId: "2", how: "single", until: "", comment: "" }] }),
            raid("b", "2026-10-12", { categoryId: "wed", absent: [{ userId: "1", how: "period", until: "", comment: "" }] }),
        ]);
        expect(days.get("2026-10-12")).toEqual({ categories: ["mon", "wed"], away: 2 });
    });

    it("gives every category its own colour, six round", () => {
        const cats = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ id }));
        expect(categoryTone("b", cats)).toBe(1);
        expect(categoryTone("g", cats)).toBe(0);
        expect(categoryTone("x", cats.slice(0, 2))).toBe(2);
    });
});

describe("filters", () => {
    const rows = [
        raider("1", { character: "Heilchen", periods: [{ id: "p", kind: "presence", from: "2026-10-12", to: "2026-10-13", days: 2, comment: "", categoryId: "", categoryName: "", byOrga: false, state: "planned" }], singles: [{ eventId: "e", day: "2026-10-12", title: "" }] }),
        raider("2", { name: "Nwek", character: "", onlyPresence: true }),
    ];

    it("drops attendance without the switch, keeping the order", () => {
        const off = visibleRaiders(rows, { presence: false, search: "" });
        expect(off.map((r) => r.userId)).toEqual(["1"]);
        expect(off[0].periods).toEqual([]);
        expect(visibleRaiders(rows, { presence: true, search: "" })).toHaveLength(2);
    });

    it("searches name and character", () => {
        expect(visibleRaiders(rows, { presence: true, search: " heil " }).map((r) => r.userId)).toEqual(["1"]);
        expect(visibleRaiders(rows, { presence: true, search: "nwek" }).map((r) => r.userId)).toEqual(["2"]);
    });
});

describe("raid cards", () => {
    it("keeps the coming raids only, in date order", () => {
        const list = upcomingRaids([raid("b", "2026-10-20"), raid("past", "2026-10-05"), raid("a", "2026-10-08")], "2026-10-08");
        expect(list.map((r) => r.id)).toEqual(["a", "b"]);
    });

    it("lists a role only when somebody is away from it and marks it short below the target", () => {
        const r = raid("a", "2026-10-12", { roles: { tank: { need: 2, have: 1, away: 1 }, healer: { need: 5, have: 6, away: 1 } } });
        expect(roleLines(r).map((l) => [l.role, l.short])).toEqual([["tank", true], ["healer", false]]);
        expect(raidShort(r)).toBe(true);
        expect(roleLines(raid("b", "2026-10-12"))).toEqual([]);
        expect(raidShort(raid("b", "2026-10-12"))).toBe(false);
    });

    it("splits the bar into in and away", () => {
        expect(raidShares({ signed: 15, away: 5, size: 25 })).toEqual({ in: 60, away: 20 });
        expect(raidShares({ signed: 0, away: 0, size: 0 })).toEqual({ in: 0, away: 0 });
    });
});

describe("names", () => {
    it("names raiders by character, else by account, and drops unknown ids", () => {
        expect(namesOf(["2", "x", "1"], [raider("1"), raider("2", { character: "" })])).toEqual(["acc-2", "Char1"]);
        expect(displayName({ character: "", name: "Acc" })).toBe("Acc");
        expect(playsLine({ spec: "Druid-Restoration", specLabel: "Wiederherstellung", role: "healer" })).toBe("Wiederherstellung · Heiler");
    });

    it("finds the running absence first, else the next one", () => {
        const e = (from: string, state: "planned" | "running" | "past", kind: "absence" | "presence" = "absence") => ({ from, state, kind });
        expect(currentAbsence([e("2026-11-01", "planned"), e("2026-10-20", "planned"), e("2026-09-01", "past")])?.from).toBe("2026-10-20");
        expect(currentAbsence([e("2026-11-01", "planned"), e("2026-10-01", "running")])?.from).toBe("2026-10-01");
        expect(currentAbsence([e("2026-10-01", "running", "presence")])).toBeNull();
    });
});
