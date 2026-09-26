// Wiederkehrende Events (#289) in the client: the rules behind the series page
// (lib/eventSeries.ts), run for real. The page's shape is checked on the
// source in test/web-client/eventSeries.test.js.
import { afterEach, describe, expect, it } from "vitest";
import { switchLang } from "../test/i18n";
import * as mod from "./eventSeries";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests hand the lib loose fixtures, as the Jest version did
const lib: any = mod;
const ms = (iso: string) => Date.parse(iso);
const date = (over: Record<string, unknown> = {}) => ({
    date: "2026-09-23", startTime: ms("2026-09-23T17:30:00Z") / 1000, createAt: ms("2026-09-17T17:30:00Z"), skipped: false,
    state: "planned", eventId: "", channelName: "", error: "", at: 0, attempts: 0, willRetry: false, ...over,
});

describe("the lines a date reads as", () => {
    it("names calendar days the German way", () => {
        expect(lib.dayLabel("2026-09-23")).toBe("Mi 23.09.");
        expect(lib.dayLabel("2026-10-25")).toBe("So 25.10.");
        expect(lib.momentDay(ms("2026-09-17T17:30:00Z"))).toBe("Do 17.09.");
        expect(lib.momentTime(ms("2026-09-17T17:30:00Z"))).toBe("19:30");
    });

    it("says when a date will be created and, afterwards, as what", () => {
        expect(lib.dateLine(date())).toBe("wird am Do 17.09. um 19:30 angelegt");
        expect(lib.dateLine(date({ state: "created", at: ms("2026-09-17T17:31:00Z"), channelName: "mi-23-09-ssc-tk" })))
            .toBe("angelegt am Do 17.09. 19:31 als #mi-23-09-ssc-tk");
        expect(lib.dateLine(date({ state: "cancelled" }))).toMatch(/nicht neu angelegt/);
        expect(lib.dateLine(date({ state: "skipped" }))).toMatch(/übersprungen/);
        expect(lib.dateLine(date({ state: "deleted" }))).toBe("Event gelöscht — wird nicht neu angelegt");
        expect(lib.dateLine(date({ state: "failed", error: "fehlende Rechte", willRetry: true }))).toBe("fehlgeschlagen: fehlende Rechte · neuer Versuch folgt");
        expect(lib.dateLine(date({ state: "existing", channelName: "mi-23" }))).toMatch(/gab es schon als #mi-23/);
    });

    it("gives every state a badge and a tone", () => {
        for (const s of ["planned", "due", "creating", "interrupted", "created", "existing", "cancelled", "deleted", "failed", "skipped", "off"]) {
            expect(lib.stateBadge(s).label).toBeTruthy();
        }
        expect(lib.stateBadge("deleted").label).toBe("gelöscht");
        expect(lib.stateBadge("failed").tone).toBe("bad");
        expect(lib.stateBadge("created").tone).toBe("ok");
    });

    it("names the next date the series still has to act on, and what it created last", () => {
        expect(lib.nextDate([date({ date: "a", state: "skipped" }), date({ date: "b" })]).date).toBe("b");
        expect(lib.nextDate([date({ date: "a", state: "created" }), date({ date: "b" })]).date).toBe("b");
        expect(lib.nextDate([date({ date: "a", state: "deleted" }), date({ date: "b" })]).date).toBe("b");
        expect(lib.nextDate([date({ date: "a", state: "skipped" }), date({ date: "b", state: "created" })]).date).toBe("b");
        expect(lib.nextDate([])).toBeNull();
        expect(lib.channelOf(date({ previewName: "mi-23" }))).toBe("mi-23");
        expect(lib.channelOf(date({ state: "failed", channelName: "real", previewName: "mi-23" }))).toBe("real");
        // a created date names its channel in its own line, not twice
        expect(lib.channelOf(date({ state: "created", channelName: "real" }))).toBe("");
        expect(lib.lastCreatedLine({ date: "2026-09-21", at: ms("2026-09-16T17:57:00Z"), channelName: "mo-21-09-ssc-tk" }))
            .toBe("zuletzt angelegt: Mo 21.09. als #mo-21-09-ssc-tk (am Mi 16.09.)");
        expect(lib.lastCreatedLine(null)).toBe("");
    });
});

describe("the weekdays", () => {
    afterEach(() => switchLang("de"));

    it("keep their stored numbers and are named in the menu language", async () => {
        expect(lib.WEEKDAYS.map((d: { value: number }) => d.value)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(lib.weekdayShort(3)).toBe("Mi");
        expect(lib.weekdayLong(7)).toBe("Sonntag");
        await switchLang("en");
        expect(lib.weekdayShort(3)).toBe("Wed");
        expect(lib.weekdayLong(7)).toBe("Sunday");
    });
});

describe("the lines in English", () => {
    afterEach(() => switchLang("de"));

    it("names days, states and what happens to a date in English", async () => {
        await switchLang("en");
        expect(lib.dayLabel("2026-09-23")).toBe("Wed 23/09");
        expect(lib.dateLine(date())).toBe("will be created on Thu 17/09 at 19:30");
        expect(lib.dateLine(date({ state: "created", at: ms("2026-09-17T17:31:00Z"), channelName: "mi-23-09-ssc-tk" })))
            .toBe("created on Thu 17/09 19:31 as #mi-23-09-ssc-tk");
        expect(lib.dateLine(date({ state: "failed", error: "", willRetry: true }))).toBe("failed: unknown error · will be retried");
        expect(lib.stateBadge("deleted").label).toBe("deleted");
        expect(lib.stateBadge("bogus").label).toBe("planned");
        expect(lib.lastCreatedLine({ date: "2026-09-21", at: ms("2026-09-16T17:57:00Z"), channelName: "mo-21-09-ssc-tk" }))
            .toBe("last created: Mon 21/09 as #mo-21-09-ssc-tk (on Wed 16/09)");
    });
});

describe("the modal's draft", () => {
    it("starts from the stored series or from Wednesday 19:30, 6 days before", () => {
        expect(lib.draftOf(null, "cat")).toEqual({ categoryId: "cat", enabled: true, weekdays: [3], time: "19:30", raidTemplateId: "", daysBefore: 6, title: "", skipDates: [] });
        const stored = { categoryId: "cat", enabled: false, weekdays: [3, 6], time: "20:00", raidTemplateId: "t", daysBefore: 4, title: "X", skipDates: ["2026-12-23"] };
        expect(lib.draftOf(stored, "cat")).toEqual(stored);
    });

    it("toggles weekdays and skipped dates, and becomes the preview query", () => {
        let d = lib.draftOf(null, "cat");
        d = lib.toggleWeekday(d, 6);
        d = lib.toggleWeekday(d, 1);
        expect(d.weekdays).toEqual([1, 3, 6]);
        d = lib.toggleSkip(d, "2026-09-23");
        expect(d.skipDates).toEqual(["2026-09-23"]);
        expect(lib.toggleSkip(d, "2026-09-23").skipDates).toEqual([]);
        const q = new URLSearchParams(lib.previewQuery(d));
        expect(Object.fromEntries(q)).toEqual({ category: "cat", weekdays: "1,3,6", time: "19:30", daysBefore: "6", template: "", skip: "2026-09-23", enabled: "1" });
    });
});
