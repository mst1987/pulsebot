// The bot's text layer (src/utils/i18n/botText.js): English source, German catalog.
const botText = require("../../../src/utils/i18n/botText");

describe("utils/i18n/botText", () => {
    it("knows two languages, German by default", () => {
        expect(botText.normalizeLang(" EN ")).toBe("en");
        expect(botText.normalizeLang("fr")).toBe("de");
        expect(botText.normalizeLang("")).toBe("de");
        expect(botText.dateLocale("en")).toBe("en");
        expect(botText.dateLocale("x")).toBe("de");
    });

    it("translates a catalog sentence to German and keeps English as written", () => {
        expect(botText.tr("de", "Enter absence")).toBe("Abwesenheit eintragen");
        expect(botText.tr("en", "Enter absence")).toBe("Enter absence");
        expect(botText.tr("de", "Away {period}", { period: "Mo 5.10." })).toBe("Weg Mo 5.10.");
        expect(botText.tr("en", "Away {period}", { period: "Mon 5 Oct" })).toBe("Away Mon 5 Oct");
    });

    it("falls back to the English sentence without a German entry and keeps unknown placeholders", () => {
        expect(botText.tr("de", "Not in any catalog {x}", { y: 1 })).toBe("Not in any catalog {x}");
        expect(botText.fill("{a} and {b}", { a: 1, b: null })).toBe("1 and {b}");
    });

    it("passes German service messages through in German, translates them for English", () => {
        expect(botText.serviceText("de", "Eintrag nicht gefunden.")).toBe("Eintrag nicht gefunden.");
        expect(botText.serviceText("en", "Eintrag nicht gefunden.")).toBe("Entry not found.");
        expect(botText.serviceText("de", null)).toBe("");
    });

    it("takes the rule set's label in German and labelEn in English", () => {
        const info = { label: "Heilig", labelEn: "Holy" };
        expect(botText.specLabel("de", info)).toBe("Heilig");
        expect(botText.specLabel("en", info)).toBe("Holy");
        expect(botText.specLabel("en", { label: "Nur Deutsch" })).toBe("Nur Deutsch");
        expect(botText.classLabel("de", null, "Priest")).toBe("Priest");
    });
});
