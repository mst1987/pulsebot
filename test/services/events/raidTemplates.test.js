// The rules of a raid template (#266): normalisation, validation against the
// rule set, the tanks/healers a size proposes, the migration of the old
// Raid-Helper list and the badges the list shows.
const {
    isLegacy, migrateLegacy, normalizeTemplate, validateTemplate, proposeComposition, decorateTemplate, legacyId,
} = require("../../../src/services/events/raidTemplates");

const valid = (over = {}) => normalizeTemplate({
    name: "SSC + TK", versionId: "tbc", instanceIds: ["ssc", "tk"], size: 25,
    composition: { tank: 3, healer: 7 }, ...over,
});

describe("raidTemplates", () => {
    describe("normalizeTemplate", () => {
        it("fills the full shape and drops unknown fields", () => {
            const t = normalizeTemplate({ name: "  Kara ", instanceIds: ["kara", "kara", ""], evil: true });
            expect(t).toEqual({
                id: "", name: "Kara", versionId: "tbc", instanceIds: ["kara"], size: null,
                composition: { tank: 0, healer: 0, melee: null, ranged: null },
                requiredBuffs: [], signupDeadline: null, durationMinutes: null, fairness: false, wishes: false, raidhelperTemplateId: "",
                overflow: "bench", lockAtLimit: false,
                // #307: no own look — the rule set of the instances decides.
                color: "", image: { mode: "thumbnail", url: "" }, emojiStyle: "arcane",
            });
        });

        it("keeps ranges, buffs, deadline and flags", () => {
            const t = normalizeTemplate({
                name: "x", size: "25", composition: { tank: "3", healer: 6, melee: { min: 4, max: 8 }, ranged: { max: 10 } },
                requiredBuffs: ["kings", "kings"], signupDeadline: { hoursBefore: "24" }, fairness: true, wishes: "yes",
                raidhelperTemplateId: " 7 ",
            });
            expect(t.size).toBe(25);
            expect(t.composition).toEqual({ tank: 3, healer: 6, melee: { min: 4, max: 8 }, ranged: { min: 0, max: 10 } });
            expect(t.requiredBuffs).toEqual(["kings"]);
            expect(t.signupDeadline).toEqual({ hoursBefore: 24 });
            expect(t.fairness).toBe(true);
            // only a real true switches a flag on
            expect(t.wishes).toBe(false);
            expect(t.raidhelperTemplateId).toBe("7");
        });
    });

    describe("validateTemplate", () => {
        it("accepts a sound template", () => {
            expect(validateTemplate(valid())).toBe("");
        });

        it("accepts a template without size — the migrated state", () => {
            expect(validateTemplate(valid({ size: null, instanceIds: [] }))).toBe("");
        });

        it("wants a name and a known version", () => {
            expect(validateTemplate(valid({ name: " " }))).toBe("Name fehlt.");
            expect(validateTemplate(valid({ versionId: "retail" }))).toMatch(/Spielversion/);
        });

        it("takes instances only from the rule set of the template's version", () => {
            expect(validateTemplate(valid({ instanceIds: ["myraid"] }))).toMatch(/Instanz „myraid“/);
            // Onyxia exists, but in Classic, not in TBC
            expect(validateTemplate(valid({ instanceIds: ["ony"] }))).toMatch(/TBC/);
            expect(validateTemplate(valid({ versionId: "classic", instanceIds: ["ony"], size: 40 }))).toBe("");
        });

        it("checks tanks + healers against the size", () => {
            expect(validateTemplate(valid({ size: 10, instanceIds: ["kara"], composition: { tank: 5, healer: 6 } }))).toMatch(/Tanks \+ Heiler \(11\)/);
            expect(validateTemplate(valid({ size: 10, instanceIds: ["kara"], composition: { tank: 4, healer: 6 } }))).toBe("");
            expect(validateTemplate(valid({ composition: { tank: -1, healer: 2 } }))).toMatch(/Tanks/);
            expect(validateTemplate(valid({ size: 41 }))).toMatch(/zwischen 1 und 40/);
            expect(validateTemplate(valid({ size: "abc" }))).toMatch(/keine Zahl/);
        });

        it("checks the melee and ranged ranges", () => {
            expect(validateTemplate(valid({ composition: { tank: 3, healer: 7, melee: { min: 9, max: 5 } } }))).toMatch(/Minimum ist größer/);
            expect(validateTemplate(valid({ composition: { tank: 3, healer: 7, ranged: { min: 0, max: 30 } } }))).toMatch(/Maximum ist größer/);
            expect(validateTemplate(valid({ composition: { tank: 3, healer: 7, melee: { min: 8, max: 10 }, ranged: { min: 8, max: 12 } } }))).toMatch(/Minima \(26\)/);
            expect(validateTemplate(valid({ composition: { tank: 3, healer: 7, melee: { min: 5, max: 10 }, ranged: { min: 8 } } }))).toBe("");
        });

        it("knows the buffs of the version and a sane deadline", () => {
            expect(validateTemplate(valid({ requiredBuffs: ["kings", "wrath-of-air-nope"] }))).toMatch(/Buff/);
            expect(validateTemplate(valid({ requiredBuffs: ["kings"] }))).toBe("");
            expect(validateTemplate(valid({ signupDeadline: { hoursBefore: 400 } }))).toMatch(/Anmeldeschluss/);
            expect(validateTemplate(valid({ signupDeadline: { hoursBefore: 24 } }))).toBe("");
        });

        it("takes a duration between 30 and 600 minutes, or none at all (#305)", () => {
            expect(validateTemplate(valid({ durationMinutes: 240 }))).toBe("");
            expect(validateTemplate(valid({ durationMinutes: null }))).toBe("");
            expect(validateTemplate(valid({ durationMinutes: 20 }))).toMatch(/Dauer/);
            expect(validateTemplate(valid({ durationMinutes: 900 }))).toMatch(/Dauer/);
            expect(validateTemplate(valid({ durationMinutes: "lang" }))).toMatch(/Dauer/);
            // a migrated Raid-Helper template has no duration
            expect(migrateLegacy({ id: "7", name: "Kara" }).durationMinutes).toBeNull();
        });

        it("prüft Farbe und Bild am Rohtext, damit ein Tippfehler nicht still verschwindet (#307)", () => {
            // normalizeTemplate wirft Unbrauchbares weg — die Prüfung sieht deshalb das Original
            const raw = { name: "SSC", versionId: "tbc", instanceIds: ["ssc"], size: 25, composition: { tank: 3, healer: 7 } };
            expect(validateTemplate(normalizeTemplate({ ...raw, color: "rot" }), { ...raw, color: "rot" })).toMatch(/#rrggbb/);
            expect(validateTemplate(normalizeTemplate({ ...raw, image: { url: "http://x/y.png" } }), { ...raw, image: { url: "http://x/y.png" } })).toMatch(/https/);
            expect(validateTemplate(normalizeTemplate({ ...raw, image: { mode: "gross", url: "https://x/y.png" } }), { ...raw, image: { mode: "gross", url: "https://x/y.png" } })).toMatch(/thumbnail/);
            // leer ist erlaubt und heißt "nimm die Instanz"
            expect(validateTemplate(valid({ color: "", image: { mode: "thumbnail", url: "" } }))).toBe("");
            expect(validateTemplate(valid({ color: "#1f8ba5", image: { mode: "banner", url: "https://cdn.example/a.png" } }))).toBe("");
            expect(migrateLegacy({ id: "7", name: "Kara" })).toMatchObject({ color: "", image: { mode: "thumbnail", url: "" } });
        });
    });

    describe("proposeComposition", () => {
        it("uses the instance's own suggestion", () => {
            expect(proposeComposition("tbc", ["kara"], 10)).toEqual({ tank: 2, healer: 3 });
        });

        it("takes the stricter suggestion of a combined night", () => {
            // gruul suggests 4/6, mag 3/6
            expect(proposeComposition("tbc", ["gruul", "mag"], 25)).toEqual({ tank: 4, healer: 6 });
        });

        it("falls back to the default curve for another size or no instance", () => {
            expect(proposeComposition("tbc", ["kara"], 25)).toEqual({ tank: 3, healer: 6 });
            expect(proposeComposition("classic", [], 40)).toEqual({ tank: 4, healer: 10 });
            // an incomplete Forever raid has no suggestion of its own
            expect(proposeComposition("forever", ["forever-hyjal"], 20)).toEqual({ tank: 2, healer: 5 });
        });
    });

    describe("migration", () => {
        it("tells the old { id, name } shape from a template", () => {
            expect(isLegacy({ id: "3", name: "Kara" })).toBe(true);
            expect(isLegacy(valid())).toBe(false);
            expect(isLegacy(migrateLegacy({ id: "3" }))).toBe(false);
        });

        it("keeps the Raid-Helper id as the link and a stable id", () => {
            const t = migrateLegacy({ id: " 3 ", name: "" });
            expect(t.id).toBe(legacyId("3"));
            expect(t).toMatchObject({ name: "Raid-Helper 3", raidhelperTemplateId: "3", size: null });
            expect(validateTemplate(normalizeTemplate(t))).toBe("");
        });
    });

    describe("decorateTemplate", () => {
        it("badges a missing size, an incomplete instance and the categories using it", () => {
            const forever = { ...valid({ versionId: "forever", instanceIds: ["forever-hyjal"], size: 20 }), id: "f" };
            expect(decorateTemplate(forever, { c1: "f", c2: "x" })).toMatchObject({ needsSize: false, incomplete: true, defaultFor: ["c1"] });
            const migrated = migrateLegacy({ id: "3" });
            expect(decorateTemplate(migrated)).toMatchObject({ needsSize: true, incomplete: false, defaultFor: [] });
        });
    });
});
