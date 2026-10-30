import { describe, expect, it } from "vitest";
import { nameFromAccount, newCharacterReady } from "../newCharacter";

describe("nameFromAccount (#907)", () => {
    it("keeps letters only, umlauts included, and at most 12 of them", () => {
        expect(nameFromAccount("Bert the 2nd!")).toBe("Bertthend");
        expect(nameFromAccount("Jörg_99")).toBe("Jörg");
        expect(nameFromAccount("Abcdefghijklmnop")).toBe("Abcdefghijkl");
        expect(nameFromAccount("")).toBe("");
    });
});

describe("newCharacterReady (#907)", () => {
    it("needs class, spec and a name of at least two letters", () => {
        expect(newCharacterReady({ classId: "Warrior", spec: "Warrior-Arms", name: "Bo" })).toBe(true);
        expect(newCharacterReady({ classId: "Warrior", spec: "Warrior-Arms", name: " B " })).toBe(false);
        expect(newCharacterReady({ classId: "Warrior", spec: "", name: "Bert" })).toBe(false);
        expect(newCharacterReady({ classId: "", spec: "Warrior-Arms", name: "Bert" })).toBe(false);
    });
});
