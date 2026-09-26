// The setup editor in two languages (namespace "setup"), with the real `t`
// (#435: formerly test/web-client/i18n-setup.test.js; the source rules are in
// test/web-client/conventions/i18n-setup.test.js).
import { describe, expect, it } from "vitest";
import { t } from ".";
import { inLang } from "../test/i18n";

describe("setup namespace", () => {
    it("reads well in English", async () => {
        await inLang("en", () => {
            expect(t("setup.status.draft")).toBe("Draft");
            expect(t("setup.editor.placesBadge", { count: 24, size: 25 })).toBe("24/25 spots");
            expect(t("setup.summary.hints", { count: 1 })).toBe("1 note");
            expect(t("setup.summary.hints", { count: 3 })).toBe("3 notes");
            expect(t("setup.publish.dmsSent", { count: 2 })).toBe("2 DMs");
            expect(t("setup.editor.approveAnywayTitle")).toBe("Approve anyway?");
        });
    });

    it("keeps the German texts as they were", () => {
        expect(t("setup.summary.hints", { count: 1 })).toBe("1 Hinweis");
        expect(t("setup.summary.hints", { count: 2 })).toBe("2 Hinweise");
        expect(t("setup.editor.placesSub", { count: 20, size: 25, bench: 3 })).toBe("20 von 25 Plätzen besetzt · 3 auf der Bank");
    });
});
