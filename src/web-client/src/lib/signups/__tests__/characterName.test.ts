import { describe, expect, it } from "vitest";
import { shortCharacterName, shownCharacterName } from "../characterName";

describe("shortCharacterName", () => {
    it("keeps a name of up to 16 characters whole", () => {
        expect("Aldric Sturmwind").toHaveLength(16);
        expect(shortCharacterName("Aldric Sturmwind")).toBe("Aldric Sturmwind");
        expect(shortCharacterName("Tom Berg")).toBe("Tom Berg");
    });

    it("shortens the last name from 17 characters on", () => {
        expect(shortCharacterName("Aldric Sturmwinds")).toBe("Aldric S.");
        expect(shortCharacterName("Konstantinos Mustermann")).toBe("Konstantinos M.");
    });

    it("leaves a long name of one part alone", () => {
        expect(shortCharacterName("Averyveryverylongname")).toBe("Averyveryverylongname");
    });

    it("keeps an umlaut as the first letter", () => {
        expect(shortCharacterName("Konstantinos Überwald")).toBe("Konstantinos Ü.");
    });

    it("copes with extra spaces and an empty name", () => {
        expect(shortCharacterName("  Konstantinos   Mustermann ")).toBe("Konstantinos M.");
        expect(shortCharacterName("")).toBe("");
    });

    it("hands a missing name back instead of throwing: the data comes from the server", () => {
        expect(shortCharacterName(undefined as unknown as string)).toBeUndefined();
    });
});

describe("shownCharacterName", () => {
    it("shortens only where characters have a last name", () => {
        const long = "Konstantinos Mustermann";
        expect(shownCharacterName(long, true)).toBe("Konstantinos M.");
        expect(shownCharacterName(long, false)).toBe(long);
        expect(shownCharacterName(long, undefined)).toBe(long);
    });
});
