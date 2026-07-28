// In-memory fs so the store never touches the repo disk.
jest.mock("fs", () => {
    const store = new Map();
    const enoent = (p) => {
        const e = new Error(`ENOENT: no such file '${p}'`);
        e.code = "ENOENT";
        return e;
    };
    return {
        __store: store,
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn((p, data) => {
            store.set(p, String(data));
        }),
        readFileSync: jest.fn((p) => {
            if (!store.has(p)) throw enoent(p);
            return store.get(p);
        }),
    };
});

const fs = require("fs");
const {
    getCategoryAssignments, listAllAssignments, setCategoryAssignments, resolveAssignmentProfiles,
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
});
