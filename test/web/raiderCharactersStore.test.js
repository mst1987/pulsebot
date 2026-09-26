// In-memory fs so the store never touches the repo disk.
jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());

const fs = require("fs");
const {
    getCategoryAssignments, listAllAssignments, setCategoryAssignments, resolveAssignmentProfiles, charactersForUser,
} = require("../../src/web/raiderCharactersStore");
const { saveCharacter } = require("../../src/web/characterStore");

beforeEach(() => {
    fs.__store.clear();
});

describe("web/raiderCharactersStore", () => {
    it("returns an empty map for an unknown/blank category", () => {
        expect(getCategoryAssignments("cat1")).toEqual({});
        expect(getCategoryAssignments("")).toEqual({});
    });

    it("saves and reads back a category's assignments", () => {
        const saved = setCategoryAssignments("cat1", { u1: "Elesham", u2: "Mage" });
        expect(saved).toEqual({ u1: "Elesham", u2: "Mage" });
        expect(getCategoryAssignments("cat1")).toEqual({ u1: "Elesham", u2: "Mage" });
    });

    it("keeps different categories independent", () => {
        setCategoryAssignments("monday", { sedroc: "Elesham" });
        setCategoryAssignments("wednesday", { sedroc: "Mage" });
        expect(getCategoryAssignments("monday")).toEqual({ sedroc: "Elesham" });
        expect(getCategoryAssignments("wednesday")).toEqual({ sedroc: "Mage" });
    });

    it("trims values and drops blank entries", () => {
        setCategoryAssignments("cat1", { " u1 ": "  Elesham  ", u2: "   ", u3: "" });
        expect(getCategoryAssignments("cat1")).toEqual({ u1: "Elesham" });
    });

    it("removing all entries drops the category entirely", () => {
        setCategoryAssignments("cat1", { u1: "Elesham" });
        setCategoryAssignments("cat1", { u1: "" });
        expect(getCategoryAssignments("cat1")).toEqual({});
    });

    it("replaces the whole category map on each save (no partial merge)", () => {
        setCategoryAssignments("cat1", { u1: "Elesham", u2: "Mage" });
        setCategoryAssignments("cat1", { u1: "Priest" });
        expect(getCategoryAssignments("cat1")).toEqual({ u1: "Priest" });
    });

    it("ignores a blank categoryId on save", () => {
        expect(setCategoryAssignments("", { u1: "Elesham" })).toEqual({});
        expect(getCategoryAssignments("")).toEqual({});
    });

    it("tolerates a missing/corrupt file", () => {
        expect(getCategoryAssignments("cat1")).toEqual({});
    });

    describe("listAllAssignments", () => {
        it("returns every category's map in one read", () => {
            setCategoryAssignments("monday", { sedroc: "Elesham" });
            setCategoryAssignments("wednesday", { sedroc: "Mage", anna: "Priest" });
            expect(listAllAssignments()).toEqual({
                monday: { sedroc: "Elesham" },
                wednesday: { sedroc: "Mage", anna: "Priest" },
            });
        });

        it("returns {} when nothing is assigned yet", () => {
            expect(listAllAssignments()).toEqual({});
        });

        it("hands out copies, so a caller cannot mutate the stored state", () => {
            setCategoryAssignments("monday", { sedroc: "Elesham" });
            listAllAssignments().monday.sedroc = "Hacked";
            expect(getCategoryAssignments("monday")).toEqual({ sedroc: "Elesham" });
        });
    });

    describe("resolveAssignmentProfiles", () => {
        it("attaches class/spec from characterStore when the character is known", () => {
            saveCharacter("Elesham", { className: "Shaman", spec: "Elemental", source: "manual" });
            setCategoryAssignments("monday", { sedroc: "Elesham" });
            expect(resolveAssignmentProfiles("monday")).toEqual({
                sedroc: { character: "Elesham", className: "Shaman", spec: "Elemental" },
            });
        });

        it("still returns the character name when its class/spec is unknown", () => {
            setCategoryAssignments("monday", { sedroc: "Brandnewchar" });
            expect(resolveAssignmentProfiles("monday")).toEqual({
                sedroc: { character: "Brandnewchar", className: null, spec: null },
            });
        });

        it("returns {} for a category with no assignments", () => {
            expect(resolveAssignmentProfiles("empty-cat")).toEqual({});
        });
    });

    describe("charactersForUser", () => {
        it("collects one account's characters over every category, once per character", () => {
            setCategoryAssignments("monday", { sedroc: "Elesham", other: "Brokk" });
            setCategoryAssignments("thursday", { sedroc: "elesham" });
            setCategoryAssignments("pug", { sedroc: "Dorn" });
            expect(charactersForUser("sedroc")).toEqual([
                { character: "Elesham", categoryIds: ["monday", "thursday"] },
                { character: "Dorn", categoryIds: ["pug"] },
            ]);
        });

        it("returns [] for an account without assignments or without an id", () => {
            setCategoryAssignments("monday", { other: "Brokk" });
            expect(charactersForUser("sedroc")).toEqual([]);
            expect(charactersForUser("")).toEqual([]);
        });
    });
});
