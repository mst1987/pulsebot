const { VERSIONS, DEFAULT_VERSION, examplesOf, publicVersions, rulesFor } = require("../../../src/config/gameVersions");

describe("examples of a game version for input hints", () => {
    describe.each(VERSIONS.map((v) => [v.id, v]))("%s", (_id, version) => {
        it("has every example in both languages", () => {
            for (const lang of ["de", "en"]) {
                const examples = examplesOf(version.id, lang);
                for (const key of ["short", "tag", "raid", "raids", "item"]) expect(examples[key]).toEqual(expect.any(String));
                for (const key of ["short", "tag", "raid", "raids", "item"]) expect(examples[key]).not.toBe("");
            }
        });

        it("names only raids of this version in `short`", () => {
            const shorts = version.instances.map((i) => i.short);
            for (const part of version.examples.short.split(" + ")) expect(shorts).toContain(part);
        });

        it("spells `tag` as the channel form of `short`", () => {
            expect(version.examples.tag).toBe(version.examples.short.toLowerCase().replace(" + ", "-"));
        });
    });

    it("keeps the examples apart: no version shows another version's raids", () => {
        expect(examplesOf("tbc").raid).toBe("Black Temple");
        expect(examplesOf("classic", "en").raid).toBe("Molten Core");
        expect(examplesOf("classic", "de").raid).toBe("Geschmolzener Kern");
        expect(examplesOf("forever").raid).toBe("Barrow Deeps");
    });

    it("names each language's potion", () => {
        expect(examplesOf("tbc", "de").item).toBe("Erstklassiger Manatrank");
        expect(examplesOf("tbc", "en").item).toBe("Super Mana Potion");
        expect(examplesOf("classic", "de").item).toBe("Erheblicher Manatrank");
        expect(examplesOf("classic", "en").item).toBe("Major Mana Potion");
    });

    it("answers an unknown version with the default one's, an unknown language in German", () => {
        expect(examplesOf("nope")).toEqual(examplesOf(DEFAULT_VERSION));
        expect(examplesOf("")).toEqual(examplesOf(DEFAULT_VERSION));
        expect(examplesOf("classic", "fr").raid).toBe("Geschmolzener Kern");
    });

    it("hands the examples to the web client", () => {
        for (const v of publicVersions()) expect(v.examples).toEqual(rulesFor(v.id).examples);
    });
});
