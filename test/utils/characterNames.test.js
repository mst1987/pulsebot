const {
    NAME_PART_MAX, NAME_MAX, allowsLastName, normalizeForCheck, isProfane, validateCharacterName,
} = require("../../src/utils/characterNames");

describe("allowsLastName", () => {
    it("is on for WoW Forever only", () => {
        expect(allowsLastName("forever")).toBe(true);
        expect(allowsLastName("tbc")).toBe(false);
        expect(allowsLastName("classic")).toBe(false);
    });

    it("allows one when no version is known (the web profile)", () => {
        expect(allowsLastName("")).toBe(true);
        expect(allowsLastName(undefined)).toBe(true);
        expect(allowsLastName("unknown")).toBe(true);
    });
});

describe("validateCharacterName", () => {
    it("takes first and last name in Forever, twelve letters each", () => {
        expect(NAME_PART_MAX).toBe(12);
        expect(NAME_MAX).toBe(25);
        expect(validateCharacterName("Aldric Sturmwind", { versionId: "forever" })).toEqual({ name: "Aldric Sturmwind" });
        expect(validateCharacterName("Abcdefghijkl Abcdefghijkl", { versionId: "forever" })).toEqual({ name: "Abcdefghijkl Abcdefghijkl" });
    });

    it("keeps a first name alone valid in Forever", () => {
        expect(validateCharacterName("Aldric", { versionId: "forever" })).toEqual({ name: "Aldric" });
    });

    it("refuses a part over twelve letters and names which one", () => {
        expect(validateCharacterName("Abcdefghijklm Sturm", { versionId: "forever" }).error).toMatch(/Vorname hat 13 Buchstaben/);
        expect(validateCharacterName("Aldric Abcdefghijklm", { versionId: "forever" }).error).toMatch(/Nachname hat 13 Buchstaben/);
        expect(validateCharacterName("Abcdefghijklm", { versionId: "tbc" }).error).toMatch(/Name hat 13 Buchstaben/);
    });

    it("refuses a last name outside Forever", () => {
        expect(validateCharacterName("Aldric Sturmwind", { versionId: "tbc" }).error).toMatch(/nur in WoW Forever/);
        expect(validateCharacterName("Aldric Sturmwind", { versionId: "classic" }).error).toMatch(/nur in WoW Forever/);
    });

    it("refuses a third name part", () => {
        expect(validateCharacterName("Aldric von Sturmwind", { versionId: "forever" }).error).toMatch(/Höchstens Vor- und Nachname/);
    });

    it("counts letters, not bytes: umlauts and accents are letters", () => {
        expect(validateCharacterName("Äöüßéèñåøæäö", { versionId: "tbc" })).toEqual({ name: "Äöüßéèñåøæäö" });
        expect(validateCharacterName("Naphfß", { versionId: "tbc" })).toEqual({ name: "Naphfß" });
    });

    it("refuses digits, signs and single letters", () => {
        expect(validateCharacterName("Aldric1", { versionId: "tbc" }).error).toMatch(/nur Buchstaben/);
        expect(validateCharacterName("Al-dric", { versionId: "tbc" }).error).toMatch(/nur Buchstaben/);
        expect(validateCharacterName("Aldric X", { versionId: "forever" }).error).toMatch(/Nachname braucht mindestens 2/);
        expect(validateCharacterName("   ").error).toMatch(/Bitte einen Namen/);
    });

    it("writes the name as the game does and folds spaces", () => {
        expect(validateCharacterName("  aldric   STURMWIND ", { versionId: "forever" })).toEqual({ name: "Aldric Sturmwind" });
    });

    it("lets `lastName` override the version", () => {
        expect(validateCharacterName("Aldric Sturmwind", { versionId: "tbc", lastName: true })).toEqual({ name: "Aldric Sturmwind" });
        expect(validateCharacterName("Aldric Sturmwind", { lastName: false }).error).toBeTruthy();
    });

    it("refuses profanity with its own message", () => {
        expect(validateCharacterName("Fuckface", { versionId: "tbc" }).error).toMatch(/nicht erlaubt/);
        expect(validateCharacterName("Aldric Hurensohn", { versionId: "forever" }).error).toMatch(/nicht erlaubt/);
    });
});

describe("isProfane", () => {
    it("finds words anywhere, at the start or as a whole part", () => {
        expect(isProfane("Superfick")).toBe(true); // contains
        expect(isProfane("Naziboy")).toBe(true); // prefix
        expect(isProfane("Ass")).toBe(true); // exact
        expect(isProfane("Aldric Dick")).toBe(true); // exact, last name
    });

    it("finds a word split over first and last name", () => {
        expect(isProfane("Hit Ler")).toBe(true);
        expect(isProfane("Sieg Heil")).toBe(true);
    });

    it("sees through doubled letters and accents", () => {
        expect(isProfane("Fuuuuck")).toBe(true);
        expect(isProfane("Fötze")).toBe(true);
        expect(isProfane("Fótze")).toBe(true);
        expect(isProfane("Scheißkerl")).toBe(true);
    });

    it("lets harmless names through (no Scunthorpe)", () => {
        for (const name of [
            "Hancock", "Barsch", "Torpedo", "Classic", "Assassin", "Dickens", "Cassandra",
            "Sieg", "Heil", "Heinrich", "Titania", "Aldric Sturmwind", "Peacock", "Fagan", "Sussex",
            "Analena", "Shiva", "Mongol",
        ]) {
            expect({ name, profane: isProfane(name) }).toEqual({ name, profane: false });
        }
    });
});

describe("normalizeForCheck", () => {
    it("lowers, strips accents and keeps letters a–z", () => {
        expect(normalizeForCheck("SSéñ Ø-1")).toBe("sseno");
    });
});
