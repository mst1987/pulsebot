// The badges of the Einstellungen sections in the page's icon rail (settingsNav.ts).
import { describe, expect, it } from "vitest";
import { sectionBadge } from "./settingsNav";

describe("sectionBadge", () => {
    const counts = { verbindungen: 2, discordserver: 1, kategorien: 3 };

    it("gives the three counted sections their badge and tone, the rest none", () => {
        expect(sectionBadge("verbindungen", counts)).toEqual({ count: 2, tone: "mid", tip: "2 Verbindungen nicht eingerichtet" });
        expect(sectionBadge("discordserver", counts)).toMatchObject({ count: 1, tone: "mid" });
        expect(sectionBadge("kategorien", counts)).toEqual({ count: 3, tip: "3 aktive Raid-Kategorien" });
        expect(sectionBadge("logs", counts)).toBeNull();
        expect(sectionBadge("verbindungen", null)).toBeNull();
    });
});
