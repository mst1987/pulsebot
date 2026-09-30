// Forever names and nicknames in the Kaderplaner: the quick check while typing.
import { describe, expect, it } from "vitest";
import { inferNameStyle, nameOk, splitName, switchNameStyle } from "./names";

describe("lib/kader/names", () => {
    it("checks a Forever name: two parts of 2 to 12 letters", () => {
        expect(nameOk("Aldric Sturmwind", "forever")).toBe(true);
        expect(nameOk("Aldric", "forever")).toBe(false);
        expect(nameOk("A Sturmwind", "forever")).toBe(false);
        expect(nameOk("Aldric Sturmwindwindig", "forever")).toBe(false);
        expect(splitName("Aldric Sturmwind")).toEqual(["Aldric", "Sturmwind"]);
    });

    it("checks a nickname: 2 to 24 of letters, digits, space, hyphen, apostrophe", () => {
        expect(nameOk("Der Große Bär-2", "nick")).toBe(true);
        expect(nameOk("O'Neill", "nick")).toBe(true);
        expect(nameOk("K", "nick")).toBe(false);
        expect(nameOk("x".repeat(25), "nick")).toBe(false);
        expect(nameOk("Bär_1", "nick")).toBe(false);
    });

    it("infers the style of an old name and carries the name over on a switch", () => {
        expect(inferNameStyle("Aldric Sturmwind")).toBe("forever");
        expect(inferNameStyle("Knuffel")).toBe("nick");
        expect(switchNameStyle(" Aldric  Sturmwind ", "nick")).toBe("Aldric Sturmwind");
        expect(switchNameStyle("Der Bär-2 Klaus", "forever")).toBe("Der BärKlaus");
        expect(switchNameStyle("Knuffel", "forever")).toBe("Knuffel ");
    });
});
