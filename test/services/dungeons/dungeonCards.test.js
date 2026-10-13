// The Discord cards of the dungeon times, German and English.
const { MessageFlags } = require("discord.js");
const cards = require("../../../src/services/dungeons/dungeonCards");
const { cardText, cardButtons, cardColor } = require("../../helpers/cardText");

const members = [{ name: "Devira", classId: "Paladin", color: "", icon: "" }, { name: "Thalor", classId: "Warrior", color: "", icon: "" }];
const runRow = (over = {}) => ({ rank: 1, id: "dr_1", dungeon: "The Deadmines", seconds: 1902, medal: "gold", startedAt: 1791700000000, finishedAt: 0, members, ...over });
const table = { dungeon: "The Deadmines", runCount: 7, goldRuns: 1, bestSeconds: 1902, runs: [runRow(), runRow({ rank: 2, seconds: 2000, medal: "silver" })] };
const player = (over = {}) => ({ rank: 1, key: "g:1", name: "Devira", gold: 3, silver: 1, bronze: 0, runs: 4, goldDungeons: ["A", "B"], ...over });

describe("dungeonCard", () => {
    it("lists the dungeon's fastest runs with medal, group and date, ephemeral, with the web link", () => {
        const payload = cards.dungeonCard("de", { versionId: "forever", dungeon: "deadmines", table });
        const text = cardText(payload);
        expect(text).toContain("WoW Forever · Dungeon-Bestzeiten");
        expect(text).toContain("## The Deadmines");
        expect(text).toContain("**1.** `31:42` · 🟨 Gold · Devira, Thalor · <t:1791700000:d>");
        expect(text).toContain("**2.** `33:20` · ⬜ Silber");
        expect(text).toContain("**Gespeichert** 7 Läufe · **Mit Gold** 1 Lauf");
        expect(payload.flags & MessageFlags.Ephemeral).toBeTruthy();
        expect(cardButtons(payload)[0]).toMatchObject({ label: "Im Web öffnen", url: expect.stringMatching(/\/roster\/dungeons$/) });
    });

    it("shows at most five runs", () => {
        const many = { ...table, runs: Array.from({ length: 10 }, (_, i) => runRow({ rank: i + 1 })) };
        expect(cardText(cards.dungeonCard("de", { versionId: "forever", table: many })).match(/`31:42`/g)).toHaveLength(cards.CARD_ROWS);
    });

    it("says when the dungeon has no run, in English too", () => {
        expect(cardText(cards.dungeonCard("en", { versionId: "forever", dungeon: "Nowhere", table: null }))).toContain("No group run of this dungeon is stored yet.");
        expect(cardText(cards.dungeonCard("de", { versionId: "forever", dungeon: "Nowhere", table: null }))).toContain("## Nowhere");
    });
});

describe("overallCard", () => {
    it("ranks the players by medals", () => {
        const text = cardText(cards.overallCard("en", { versionId: "forever", players: [player(), player({ rank: 2, name: "Mira", gold: 0, silver: 0, bronze: 0, goldDungeons: [] })], dungeons: 4 }));
        expect(text).toContain("## Overall ranking");
        expect(text).toContain("**1.** **Devira** · 🟨 3 gold · ⬜ 1 silver · gold in 2 dungeons");
        expect(text).toContain("**2.** **Mira** · no medal yet");
        expect(text).toContain("**Dungeons** 4");
    });

    it("explains where the data comes from while there is none", () => {
        expect(cardText(cards.overallCard("de", { versionId: "forever", players: [], dungeons: 0 })))
            .toContain("Für WoW Forever sind noch keine Gruppenläufe gespeichert.");
    });
});

describe("recordCard", () => {
    it("is a public gold card with the time it beat", () => {
        const payload = cards.recordCard("de", { versionId: "forever", run: runRow(), previous: 1950 });
        const text = cardText(payload);
        expect(text).toContain("WoW Forever · Neuer Gildenrekord");
        expect(text).toContain("**`31:42`** · 🟨 Gold");
        expect(text).toContain("Bisherige Bestzeit: 32:30");
        expect(text).toContain("**Gruppe** Devira, Thalor");
        expect(payload.flags & MessageFlags.Ephemeral).toBeFalsy();
        expect(cardColor(payload)).toBe(0xd4a72c);
        expect(cardText(cards.recordCard("en", { versionId: "forever", run: runRow() }))).not.toContain("Previous best");
    });

    it("names the medal in the language", () => {
        expect(cards.medalWord("de", "bronze")).toBe("Bronze");
        expect(cards.medalWord("en", "silver")).toBe("Silver");
        expect(cards.medalWord("de", null)).toBe("");
    });
});
