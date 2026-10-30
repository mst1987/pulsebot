// The sections of a raid category (#738): which version it played when, the
// history a switch writes, and the one rule for a template of another version.
const { erasOf, categoryEraAt, categoryNameAt, currentEra, switchEras, templateVersionProblem } = require("../../../src/services/categories/categoryEras");

const T1 = Date.UTC(2026, 9, 1);
const T2 = Date.UTC(2026, 11, 1);
const config = {
    mainVersion: "tbc",
    categoryVersion: { mon: "forever", fri: "tbc" },
    categoryEras: {
        mon: [
            { versionId: "forever", from: T2, name: "Forever Montag" },
            { versionId: "tbc", from: 0, name: "TBC Montag" },
            { versionId: "classic", from: T1, name: "Classic Montag" },
        ],
    },
};

describe("services/categories/categoryEras", () => {
    it("lists a category's sections oldest first", () => {
        expect(erasOf("mon", { config }).map((e) => [e.versionId, e.from])).toEqual([["tbc", 0], ["classic", T1], ["forever", T2]]);
    });

    it("reads a category never switched as one section since always in its version", () => {
        expect(erasOf("fri", { config })).toEqual([{ versionId: "tbc", from: 0, name: "" }]);
        expect(erasOf("new", { config: { mainVersion: "forever" } })).toEqual([{ versionId: "forever", from: 0, name: "" }]);
    });

    it("finds the section of a moment, in seconds or ms", () => {
        expect(categoryEraAt("mon", T1 - 1, { config })).toMatchObject({ versionId: "tbc", name: "TBC Montag", current: false });
        expect(categoryEraAt("mon", Math.floor(T1 / 1000) + 60, { config })).toMatchObject({ versionId: "classic", current: false });
        expect(categoryEraAt("mon", T2 + 1, { config })).toMatchObject({ versionId: "forever", current: true });
        expect(categoryEraAt("fri", T2, { config })).toMatchObject({ versionId: "tbc", current: true });
    });

    describe("categoryNameAt (#744: a renamed category)", () => {
        it("gives a raid of a closed section the name the category had then", () => {
            expect(categoryNameAt("mon", T1 - 1, "Forever Montag", { config })).toBe("TBC Montag");
            expect(categoryNameAt("mon", Math.floor(T1 / 1000) + 60, "Forever Montag", { config })).toBe("Classic Montag");
        });

        it("gives a raid of the current section the live name, not the one stored at the switch", () => {
            expect(categoryNameAt("mon", T2 + 1, "Montag (neu)", { config })).toBe("Montag (neu)");
        });

        it("keeps the live name for a category never switched, a closed section without a name, and without a time", () => {
            expect(categoryNameAt("fri", T1, "Freitag", { config })).toBe("Freitag");
            const unnamed = { categoryEras: { mon: [{ versionId: "tbc", from: 0, name: "" }, { versionId: "forever", from: T2, name: "" }] } };
            expect(categoryNameAt("mon", T1, "Forever Montag", { config: unnamed })).toBe("Forever Montag");
            expect(categoryNameAt("mon", 0, "Forever Montag", { config })).toBe("Forever Montag");
            expect(categoryNameAt("", T1, "x", { config })).toBe("x");
        });
    });

    it("names the current section", () => {
        expect(currentEra("mon", { config })).toEqual({ versionId: "forever", from: T2, name: "Forever Montag", current: true });
        expect(currentEra("fri", { config })).toMatchObject({ versionId: "tbc", from: 0, current: true });
    });

    describe("switchEras", () => {
        it("starts a history: the old section since always, closed under today's name, and the new one", () => {
            expect(switchEras([], { fromVersion: "tbc", toVersion: "forever", at: T1, name: "Raids Montag" })).toEqual([
                { versionId: "tbc", from: 0, name: "Raids Montag" },
                { versionId: "forever", from: T1, name: "Raids Montag" },
            ]);
        });

        it("appends to a history and leaves the stored list alone", () => {
            const stored = [{ versionId: "tbc", from: 0, name: "Alt" }, { versionId: "forever", from: T1, name: "Alt" }];
            const next = switchEras(stored, { fromVersion: "forever", toVersion: "tbc", at: T2, name: "Neu" });
            expect(next).toEqual([
                { versionId: "tbc", from: 0, name: "Alt" },
                { versionId: "forever", from: T1, name: "Neu" },
                { versionId: "tbc", from: T2, name: "Neu" },
            ]);
            expect(stored[1].name).toBe("Alt");
        });

        it("keeps a name it knows when the category has none now, and changes nothing for the same version", () => {
            const stored = [{ versionId: "tbc", from: 0, name: "Alt" }];
            expect(switchEras(stored, { fromVersion: "tbc", toVersion: "forever", at: T1, name: "" })[1]).toEqual({ versionId: "forever", from: T1, name: "Alt" });
            expect(switchEras(stored, { fromVersion: "tbc", toVersion: "tbc", at: T1, name: "x" })).toEqual(stored);
        });
    });

    describe("templateVersionProblem", () => {
        it("says why a template of another version does not fit", () => {
            expect(templateVersionProblem({ template: { name: "SSC + TK", versionId: "tbc" }, categoryId: "mon", config }))
                .toBe("Die Raid-Vorlage „SSC + TK“ ist für TBC Anniversary, die Kategorie spielt WoW Forever.");
            expect(templateVersionProblem({ template: { versionId: "tbc" }, categoryId: "mon", config })).toMatch(/^Die Raid-Vorlage ist für/);
        });

        it("is empty when it fits or there is nothing to compare", () => {
            expect(templateVersionProblem({ template: { versionId: "tbc" }, categoryId: "fri", config })).toBe("");
            expect(templateVersionProblem({ template: { versionId: "forever" }, categoryId: "mon", config })).toBe("");
            expect(templateVersionProblem({ template: null, categoryId: "mon", config })).toBe("");
            expect(templateVersionProblem({ template: { name: "alt" }, categoryId: "mon", config })).toBe("");
            expect(templateVersionProblem({ template: { versionId: "forever" }, categoryId: "", config })).toBe("");
        });
    });
});
