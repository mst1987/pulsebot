// The raid-detail dialogs and the item search picker in two languages
// (namespaces raidModals + raidManage), with the real `t` (#435: formerly
// test/web-client/i18n-raidModals.test.js; the source rules are in
// test/web-client/conventions/i18n-raidModals.test.js).
import { describe, expect, it } from "vitest";
import { t } from ".";
import { inLang } from "../test/i18n";

describe("raid-detail dialogs in two languages", () => {
    it("reads the same in German as before and naturally in English", async () => {
        expect(t("raidModals.logAssign.hint", { count: 1 })).toBe("1 Log ohne Event");
        expect(t("raidModals.logAssign.hint", { count: 3 })).toBe("3 Logs ohne Event");
        expect(t("raidModals.lootAdd.added", { item: "Schwert", character: "Ahri" })).toBe("„Schwert“ für Ahri nachgetragen.");
        expect(t("raidModals.softres.instances", { count: 2 })).toBe("2 Instanzen");
        expect(t("raidManage.move.renameTip", { current: "a", next: "b" })).toBe("#a → #b. Nur Datum und Wochentag im Namen werden ersetzt.");
        await inLang("en", () => {
            expect(t("raidModals.logAssign.hint", { count: 3 })).toBe("3 logs without event");
            expect(t("raidModals.ping.submit", { count: 1 })).toBe("Ping 1 raider");
            expect(t("raidModals.ping.submit", { count: 4 })).toBe("Ping 4 raiders");
            expect(t("raidModals.softres.instances", { count: 1 })).toBe("1 instance");
            expect(t("raidManage.cancel.title")).toBe("Cancel event");
            expect(t("raidManage.raider.characters", { count: 2 })).toBe("2 characters");
            expect(t("raidModals.itemSearch.placeholder")).toBe("Search item names (Wowhead) …");
        });
    });
});
