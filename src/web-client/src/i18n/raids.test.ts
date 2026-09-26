// The Raid-Events list and the raid table in two languages (namespace `raids`),
// with the real `t` (#435: formerly test/web-client/i18n-raids.test.js; the
// source rules are in test/web-client/conventions/i18n-raids.test.js, the time
// bands in lib/raidTime.test.ts).
import { describe, expect, it } from "vitest";
import { t } from ".";
import { inLang } from "../test/i18n";

describe("raids namespace", () => {
    it("reads the key texts in both languages", async () => {
        expect(t("raids.page.noneUpcoming")).toBe("Keine anstehenden Events gefunden.");
        expect(t("raids.list.pendingTip", { count: 1 })).toBe("1 Log nicht zugeordnet");
        expect(t("raids.table.pendingLogs", { count: 3 })).toBe("3 Logs offen");
        await inLang("en", () => {
            expect(t("raids.page.noneUpcoming")).toBe("No upcoming events found.");
            expect(t("raids.list.pendingTip", { count: 2 })).toBe("2 logs not assigned");
            expect(t("raids.list.seatsOf", { count: 12, size: 25 })).toBe("12 of 25 spots");
        });
    });
});
