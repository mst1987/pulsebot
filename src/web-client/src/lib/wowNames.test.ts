// WoW names in the menu language: the ids the server sends next to its German labels.
import { afterAll, describe, expect, it } from "vitest";
import { classLabel, contentName, instanceName, slotLabel, specClassLabel, specLabel } from "./wowNames";
import { inLang, switchLang } from "../test/i18n";

describe("lib/wowNames", () => {
    afterAll(() => switchLang("de"));

    it("names classes, specs and instances in German by default", () => {
        expect(classLabel("Priest")).toBe("Priester");
        expect(specLabel("Hunter-BeastMastery")).toBe("Tierherrschaft");
        expect(instanceName("ssc")).toBe("Höhle des Schlangenschreins");
    });

    it("names the loot council's specs and the equip slots like the server does in German", () => {
        expect(specClassLabel("Warlock-Destruction", "Zerstörungs-Hexer")).toBe("Zerstörungs-Hexer");
        expect(slotLabel(9, "Hände")).toBe("Hände");
        // the server's label stays for a content in German, even where the instance is named shorter
        expect(contentName("tk", "Festung der Stürme — Das Auge")).toBe("Festung der Stürme — Das Auge");
    });

    it("gives the English names", async () => {
        await inLang("en", () => {
            expect(specClassLabel("Warlock-Destruction", "Zerstörungs-Hexer")).toBe("Destruction Warlock");
            expect(specClassLabel("Paladin-Holy", "Heilig-Paladin")).toBe("Holy Paladin");
            expect(slotLabel(9, "Hände")).toBe("Hands");
            expect(slotLabel(17, "Wand/Idol/Relikt")).toBe("Wand/Idol/Relic");
            expect(contentName("tk", "Festung der Stürme — Das Auge")).toBe("Tempest Keep");
        });
    });

    it("keeps the server's label for what the dictionaries do not know", async () => {
        await inLang("en", () => {
            expect(specClassLabel("Rogue-Combat", "Kampf-Schurke")).toBe("Kampf-Schurke");
            expect(slotLabel(3, "Hemd")).toBe("Hemd");
            expect(contentName("new", "Neuer Raid")).toBe("Neuer Raid");
        });
    });
});
