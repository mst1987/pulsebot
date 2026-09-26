// The "Neues Raid-Event" dialog and the shared raid-plan fields in two
// languages (namespaces raidCreate + raidPlan), with the real `t` (#435:
// formerly test/web-client/i18n-raidCreate.test.js; the source rules are in
// test/web-client/conventions/i18n-raidCreate.test.js).
import { describe, expect, it } from "vitest";
import { t } from ".";
import { inLang } from "../test/i18n";

describe("i18n: raidCreate / raidPlan", () => {
    it("keeps German unchanged and reads naturally in English", async () => {
        expect(t("raidCreate.footer.titleNew")).toBe("Neues Raid-Event");
        expect(t("raidCreate.toast.templateCreated", { name: "Kara" })).toBe("Vorlage „Kara“ angelegt.");
        await inLang("en", () => {
            expect(t("raidCreate.footer.titleNew")).toBe("New raid event");
            expect(t("raidCreate.footer.stepOf", { n: 2, total: 5 })).toBe("Step 2 of 5");
            expect(t("raidCreate.start.players", { count: 25 })).toBe("25 players");
            expect(t("raidPlan.step.check")).toBe("Review");
            expect(t("raidPlan.comp.dpsLine", { count: 1 })).toBe("1 spot for DPS · suggestion on size change");
            expect(t("raidPlan.problem.maxOverSize", { label: t("wow.role.melee"), size: 10 })).toBe("Melee: maximum is greater than the size 10.");
        });
    });
});
