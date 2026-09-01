jest.mock("../../src/web/characterStore", () => ({ characterMap: jest.fn(() => ({})) }));

const { characterMap } = require("../../src/web/characterStore");
const { withClassLook, classLook } = require("../../src/web/lootClassLook");

describe("web/lootClassLook", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        characterMap.mockReturnValue({
            anna: { className: "Paladin", spec: "Holy" },
            bob: { className: "Warrior" },
            noclass: { spec: "Fury" },
        });
    });

    it("adds class, spec, colour and spec icon to every row", () => {
        const [row] = withClassLook([{ character: "Anna", characterKey: "anna", itemName: "Sword" }]);
        expect(row).toMatchObject({ itemName: "Sword", className: "Paladin", spec: "Holy" });
        expect(row.classColor).toMatch(/^#/);
        expect(row.specIconUrl).toBeTruthy();
    });

    it("leaves a character nobody resolved blank instead of guessing", () => {
        expect(classLook({}, "ghost")).toEqual({ className: "", spec: "", classColor: "", specIconUrl: "" });
        // A record with a spec but no class is no better than none — the colour
        // comes from the class.
        expect(classLook(characterMap(), "noclass")).toEqual({ className: "", spec: "", classColor: "", specIconUrl: "" });
    });

    it("works without a spec: the class alone still colours the name", () => {
        const look = classLook(characterMap(), "bob");
        expect(look.className).toBe("Warrior");
        expect(look.spec).toBe("");
        expect(look.classColor).toMatch(/^#/);
    });

    it("reads the character store once for the whole list", () => {
        withClassLook([
            { characterKey: "anna" }, { characterKey: "bob" }, { characterKey: "anna" },
        ]);
        expect(characterMap).toHaveBeenCalledTimes(1);
    });

    it("does not touch the store for an empty list", () => {
        expect(withClassLook([])).toEqual([]);
        expect(withClassLook(null)).toEqual([]);
        expect(characterMap).not.toHaveBeenCalled();
    });
});
