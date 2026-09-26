// The "signups" namespace in two languages, with the real `t` (#435: formerly
// test/web-client/i18n-signups.test.js; the source rules are in
// test/web-client/conventions/i18n-signups.test.js).
import { describe, expect, it } from "vitest";
import { t } from ".";
import { GEAR_LABEL, SIGNUP_STATUS } from "../lib/signups";
import { inLang } from "../test/i18n";

describe("signups namespace", () => {
    it("keeps the German texts and reads naturally in English", async () => {
        expect(t("signups.page.upcoming", { count: 1 })).toBe("1 kommender Raid");
        expect(t("signups.page.upcoming", { count: 3 })).toBe("3 kommende Raids");
        expect(t("signups.bulk.signUpAll", { count: 1 })).toBe("Für 1 Raids anmelden");
        await inLang("en", () => {
            expect(t("signups.bulk.signUpAll", { count: 1 })).toBe("Sign up for 1 raid");
            expect(t("signups.selectedCount", { count: 2 })).toBe("2 raids selected");
            expect(t("signups.status.bench")).toBe("Bench");
            expect(t("signups.dialog.wishSignedUp", { count: 1, names: "Zibbo" })).toBe("Zibbo is signed up too");
            expect(t("signups.specPicker.add")).toBe("Add spec");
        });
    });

    // lib/signups.ts keeps its tables behind getters: read at render time, a
    // label follows a language switch instead of freezing the one the page loaded in
    it("reads the status and gear labels in the language active at the time", async () => {
        expect(SIGNUP_STATUS.signed.label).toBe(t("signups.status.signed"));
        expect(GEAR_LABEL.none).toBe("kein Gear");
        await inLang("en", () => {
            expect(SIGNUP_STATUS.signed.label).toBe(t("signups.status.signed"));
            expect(SIGNUP_STATUS.signed.label).not.toBe("Angemeldet");
            expect(GEAR_LABEL.none).toBe("no gear");
        });
        expect(SIGNUP_STATUS.signed.label).toBe("Angemeldet");
    });
});
