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

    it("needs first and last name in a version with last names", () => {
        const pick = (name: string) => ({ classId: "Warrior", spec: "Warrior-Arms", name });
        expect(newCharacterReady(pick("Bert Sturm"), true)).toBe(true);
        expect(newCharacterReady(pick("  Bert   Sturm "), true)).toBe(true);
        expect(newCharacterReady(pick("Bert"), true)).toBe(false);
        expect(newCharacterReady(pick("Bert S"), true)).toBe(false);
        expect(newCharacterReady(pick("Bert von Sturm"), true)).toBe(false);
    });
});
