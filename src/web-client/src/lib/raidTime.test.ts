// The time bands and dates of the raid lists (lib/raidTime.ts) in the active
// language (#435: formerly a source scan in test/web-client/i18n-raids.test.js).
import { describe, expect, it } from "vitest";
import { eventDay, monthBands, weekBands } from "./raidTime";
import { inLang } from "../test/i18n";

const WEEK = 7 * 86400;
// Thursday 17 Sept 2026, 19:45 in Berlin
const NOW = Date.UTC(2026, 8, 17, 17, 45);
const at = (weeks: number) => ({ startTime: Math.floor(NOW / 1000) + weeks * WEEK });

describe("raid list time bands", () => {
    // the bands are raid IDs (Wednesday to Tuesday), not calendar weeks
    it("labels the week bands in the active language", async () => {
        const rows = [at(-3), at(-1), at(0), at(1), at(2)];
        expect(weekBands(rows, NOW).map((b) => b.label)).toEqual(["Vor 3 IDs", "Letzte ID", "Diese ID", "Nächste ID", "In 2 IDs"]);
        await inLang("en", () => {
            expect(weekBands(rows, NOW).map((b) => b.label)).toEqual(["3 IDs ago", "Last ID", "This ID", "Next ID", "In 2 IDs"]);
        });
    });

    it("gives each band its Wednesday-to-Tuesday range", () => {
        expect(weekBands([at(0), at(2)], NOW).map((b) => b.range)).toEqual(["16.–22.09.", "30.09.–06.10."]);
    });

    it("names months and event days in the active locale", async () => {
        const october = { startTime: Math.floor(Date.UTC(2026, 9, 8, 17, 45) / 1000) };
        expect(monthBands([october])[0].label).toBe("Oktober 2026");
        expect(eventDay(at(0).startTime)).toEqual({ day: "Do 17.09.", time: "19:45" });
        await inLang("en", () => {
            expect(monthBands([october])[0].label).toBe("October 2026");
            expect(eventDay(at(0).startTime)).toEqual({ day: "Thu 17/09", time: "19:45" });
        });
    });
});
