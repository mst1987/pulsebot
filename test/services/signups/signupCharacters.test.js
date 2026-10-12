// Characters per signup per raid category: the resolver, the normaliser of the
// setting and the limit rule (a signup from before a lowered limit keeps what it has).
const {
    MAX_CHARACTERS, DEFAULT_MAX_CHARACTERS, clampMaxCharacters, normalizeCategorySignupCharacters,
    maxCharactersFor, pickLimitFor, exceedsCharacterLimit, characterLimitError,
} = require("../../../src/services/signups/signupCharacters");

describe("services/signups/signupCharacters — characters per signup", () => {
    it("allows 8 by default and never more", () => {
        expect(DEFAULT_MAX_CHARACTERS).toBe(8);
        expect(MAX_CHARACTERS).toBe(8);
        expect(maxCharactersFor("cat-a", {})).toBe(8);
        expect(maxCharactersFor("cat-a", undefined)).toBe(8);
        expect(maxCharactersFor(null, { categorySignupCharacters: { "cat-a": 3 } })).toBe(8);
    });

    it("reads the category of an event or a category id", () => {
        const config = { categorySignupCharacters: { "cat-a": 3, "cat-b": 1 } };
        expect(maxCharactersFor({ id: "eh-1", categoryId: "cat-a" }, config)).toBe(3);
        expect(maxCharactersFor("cat-b", config)).toBe(1);
        expect(maxCharactersFor({ id: "eh-2", categoryId: "cat-c" }, config)).toBe(8);
    });

    it("clamps a stored value into 1..8", () => {
        expect(maxCharactersFor("x", { categorySignupCharacters: { x: 20 } })).toBe(8);
        expect(maxCharactersFor("x", { categorySignupCharacters: { x: 0 } })).toBe(1);
        expect(maxCharactersFor("x", { categorySignupCharacters: { x: "abc" } })).toBe(8);
        expect(clampMaxCharacters("4.4")).toBe(4);
        expect(clampMaxCharacters(-3)).toBe(1);
        expect(clampMaxCharacters(null)).toBeNull();
        expect(clampMaxCharacters(true)).toBeNull();
    });

    it("stores only what differs from the default; a patch keeps the 8 so the merge can reset", () => {
        const raw = { a: 3, b: 8, c: 12, d: "x", e: 0, " ": 2 };
        expect(normalizeCategorySignupCharacters(raw)).toEqual({ a: 3, e: 1 });
        expect(normalizeCategorySignupCharacters(raw, { keepDefault: true })).toEqual({ a: 3, b: 8, c: 8, e: 1 });
        expect(normalizeCategorySignupCharacters(null)).toEqual({});
        expect(normalizeCategorySignupCharacters([1, 2])).toEqual({});
    });

    it("refuses more than the limit, counting a character twice once", () => {
        const two = [{ character: "A" }, { character: "B" }];
        expect(exceedsCharacterLimit(two, null, 2)).toBe(false);
        expect(exceedsCharacterLimit([...two, { character: "a" }], null, 2)).toBe(false);
        expect(exceedsCharacterLimit([...two, { character: "C" }], null, 2)).toBe(true);
    });

    it("keeps a signup from before a lowered limit: fewer or the same characters pass, a new one does not", () => {
        const stored = { status: "signed", characters: [{ character: "A", spec: "Mage-Frost" }, { character: "B", spec: "Mage-Frost" }, { character: "C", spec: "Mage-Frost" }] };
        expect(exceedsCharacterLimit([{ character: "C" }, { character: "A" }, { character: "B" }], stored, 2)).toBe(false);
        expect(exceedsCharacterLimit([{ character: "A" }, { character: "B" }, { character: "D" }], stored, 2)).toBe(true);
        expect(exceedsCharacterLimit([{ character: "A" }, { character: "B" }, { character: "C" }, { character: "D" }], stored, 2)).toBe(true);
        expect(exceedsCharacterLimit([{ character: "A" }], stored, 2)).toBe(false);
    });

    it("lets a picker offer the limit, or as many as a stored signup already has", () => {
        const config = { categorySignupCharacters: { "cat-a": 2 } };
        expect(pickLimitFor("cat-a", null, config)).toBe(2);
        const stored = { status: "signed", characters: ["A", "B", "C"].map((character) => ({ character, spec: "Mage-Frost" })) };
        expect(pickLimitFor("cat-a", stored, config)).toBe(3);
        expect(pickLimitFor("cat-b", stored, config)).toBe(8);
    });

    it("names the limit in the refusal", () => {
        expect(characterLimitError(5)).toBe("Höchstens 5 Charaktere je Anmeldung in dieser Kategorie.");
    });
});
