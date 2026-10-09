// The pure rules of the absence/attendance section and dialog.
import { afterEach, describe, expect, it } from "vitest";
import type { AvailabilityResult } from "../../api";
import { t } from "../../i18n";
import { switchLang } from "../../test/i18n";
import { countResults, dayMs, firstSpec, nextTo, periodLabel, resultSummary, skipReason, staysAsIs } from "./availability";
import { formatDayDate } from "../format";

const result = (over: Partial<AvailabilityResult> = {}): AvailabilityResult => ({
    eventId: "e1", title: "Kara", startTime: 1_790_000_000, ok: true, skipped: "", error: "", ...over,
});

afterEach(() => switchLang("de"));

describe("availability rules", () => {
    it("knows the raids a save leaves alone anyway", () => {
        expect(staysAsIs("presence", "")).toBe(false);
        expect(staysAsIs("presence", "tentative")).toBe(true);
        expect(staysAsIs("presence", "absence")).toBe(true);
        expect(staysAsIs("absence", "signed")).toBe(false);
        expect(staysAsIs("absence", "absence")).toBe(true);
    });

    it("reads a day as noon UTC, so the guild's calendar day stays the same", () => {
        expect(new Date(dayMs("2026-10-05")).toISOString()).toBe("2026-10-05T12:00:00.000Z");
        expect(dayMs("05.10.2026")).toBe(0);
        expect(dayMs("")).toBe(0);
    });

    it("writes a period with its weekdays, one day once", () => {
        expect(periodLabel("2026-10-05", "2026-10-09")).toBe(`${formatDayDate(dayMs("2026-10-05"))} – ${formatDayDate(dayMs("2026-10-09"))}`);
        expect(periodLabel("2026-10-05", "2026-10-05")).toBe(formatDayDate(dayMs("2026-10-05")));
        expect(periodLabel("2026-10-05", "2026-10-05")).toBe("Mo 05.10.");
    });

    it("moves 'Bis' along only when 'Von' passes it", () => {
        expect(nextTo("2026-10-07", "2026-10-05")).toBe("2026-10-07");
        expect(nextTo("2026-10-03", "2026-10-05")).toBe("2026-10-05");
        expect(nextTo("2026-10-03", "")).toBe("2026-10-03");
    });

    it("suggests the first raid-ready spec, else the first", () => {
        const c = (gears: string[]) => ({ key: "k", name: "N", className: "Priest", versionId: "tbc", specs: gears.map((gear, i) => ({ key: `s${i}`, label: `S${i}`, gear })) });
        expect(firstSpec(c(["usable", "ready"]))).toBe("s1");
        expect(firstSpec(c(["usable", "usable"]))).toBe("s0");
        expect(firstSpec(c([]))).toBe("");
        expect(firstSpec(undefined)).toBe("");
    });

    it("counts and sums up what a save did", () => {
        const results = [result(), result({ eventId: "e2" }), result({ eventId: "e3", ok: false, skipped: "already_absent" }), result({ eventId: "e4", ok: false, error: "Anmeldung geschlossen" })];
        expect(countResults(results)).toEqual({ done: 2, skipped: 1, failed: 1 });
        expect(resultSummary("absence", results, true)).toBe([
            t("signups.availability.result.signedOff", { count: 2 }),
            t("signups.availability.result.skipped", { count: 1 }),
            t("signups.availability.result.failed", { count: 1 }),
        ].join(" · "));
        expect(resultSummary("presence", [result()], false)).toBe(`${t("signups.availability.result.signedUp", { count: 1 })} · ${t("signups.availability.result.noDm")}`);
        expect(resultSummary("absence", [], true)).toBe(t("signups.availability.result.noRaid"));
    });

    it("says why a raid was left alone: the skip in words, else the server's reason", async () => {
        expect(skipReason(result())).toBe("");
        expect(skipReason(result({ ok: false, skipped: "already_signed" }))).toBe(t("signups.availability.skip.already_signed"));
        expect(skipReason(result({ ok: false, error: "Anmeldeschluss vorbei" }))).toBe("Anmeldeschluss vorbei");
        await switchLang("en");
        expect(skipReason(result({ ok: false, skipped: "absent" }))).toBe("an absence covers it");
    });
});
