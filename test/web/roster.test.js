// Every source the roster joins is mocked: this tests the join itself — which
// character lands in which category, and what each row carries.
const mockAnnotatedCharacters = jest.fn(() => []);
jest.mock("../../src/web/characterInfo", () => ({
    annotatedCharacters: (...a) => mockAnnotatedCharacters(...a),
}));

const mockListAllAssignments = jest.fn(() => ({}));
jest.mock("../../src/web/raiderCharactersStore", () => ({
    listAllAssignments: (...a) => mockListAllAssignments(...a),
}));

const mockCharacterMap = jest.fn(() => ({}));
jest.mock("../../src/web/characterStore", () => ({
    characterMap: (...a) => mockCharacterMap(...a),
}));

const mockLatestIssues = jest.fn(() => ({}));
jest.mock("../../src/web/charGearIssues", () => ({
    latestIssuesByCharacter: (...a) => mockLatestIssues(...a),
}));

// The roster labels its category ids through categoryNames.js, not through the
// live Discord list — see that module for why (categoryNames.test.js covers the
// resolution itself).
const mockListCategories = jest.fn(() => []);
jest.mock("../../src/web/categoryNames", () => ({
    listKnownCategories: (...a) => mockListCategories(...a),
}));

const { buildRoster } = require("../../src/web/roster");

const lootChar = (over = {}) => ({
    key: "anna", character: "Anna", realm: "Thunderstrike", count: 2,
    categoryIds: ["cat1"], items: [{ itemId: 1, itemName: "Sword" }],
    className: "Priest", spec: "Shadow", source: "wcl", reportId: "", ...over,
});

const byName = (roster, name) => roster.chars.find((c) => c.character === name);

describe("web/roster buildRoster", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAnnotatedCharacters.mockReturnValue([]);
        mockListAllAssignments.mockReturnValue({});
        mockCharacterMap.mockReturnValue({});
        mockLatestIssues.mockReturnValue({});
        mockListCategories.mockReturnValue([]);
    });

    it("returns an empty roster when nothing is known", () => {
        expect(buildRoster("guild-1")).toEqual({ chars: [], categories: [] });
    });

    it("takes the loot characters with their categories, class/spec and loot preview", () => {
        mockAnnotatedCharacters.mockReturnValue([lootChar()]);

        const anna = byName(buildRoster("guild-1"), "Anna");

        expect(anna).toMatchObject({
            key: "anna",
            realm: "Thunderstrike",
            categoryIds: ["cat1"],
            lootCount: 2,
            className: "Priest",
            spec: "Shadow",
            assigned: false,
            raiderIds: [],
        });
        expect(anna.items).toEqual([{ itemId: 1, itemName: "Sword" }]);
        expect(anna.classColor).toBeTruthy();
        expect(anna.iconUrl).toBeTruthy();
    });

    it("adds characters that only have a manual assignment, with their raider and category", () => {
        mockListAllAssignments.mockReturnValue({ cat2: { u1: "Bob" } });
        mockCharacterMap.mockReturnValue({ bob: { className: "Warrior", spec: "Fury", source: "manual" } });

        const bob = byName(buildRoster("guild-1"), "Bob");

        expect(bob).toMatchObject({
            character: "Bob",
            categoryIds: ["cat2"],
            assigned: true,
            raiderIds: ["u1"],
            lootCount: 0,
            className: "Warrior",
            spec: "Fury",
            source: "manual",
        });
        expect(bob.items).toEqual([]);
    });

    it("merges the categories of both sources into one character", () => {
        mockAnnotatedCharacters.mockReturnValue([lootChar({ categoryIds: ["cat1"] })]);
        mockListAllAssignments.mockReturnValue({ cat2: { u1: "anna-thunderstrike" } });

        const anna = byName(buildRoster("guild-1"), "Anna");

        expect(anna.categoryIds).toEqual(["cat1", "cat2"]);
        expect(anna.assigned).toBe(true);
        // The loot side's spelling wins — it's the display name the loot tool exported.
        expect(anna.character).toBe("Anna");
    });

    it("does not list a category twice when both sources name it", () => {
        mockAnnotatedCharacters.mockReturnValue([lootChar({ categoryIds: ["cat1"] })]);
        mockListAllAssignments.mockReturnValue({ cat1: { u1: "Anna" } });
        expect(byName(buildRoster("guild-1"), "Anna").categoryIds).toEqual(["cat1"]);
    });

    it("attaches the character's latest gear issues", () => {
        mockAnnotatedCharacters.mockReturnValue([lootChar()]);
        mockLatestIssues.mockReturnValue({
            anna: { issueCount: 2, issues: [{ label: "kein Item" }], reportRefId: "r1", generatedAt: 500 },
        });

        expect(byName(buildRoster("guild-1"), "Anna").gear).toMatchObject({ issueCount: 2, reportRefId: "r1" });
    });

    it("leaves gear null for a character no evaluation contains", () => {
        mockAnnotatedCharacters.mockReturnValue([lootChar()]);
        expect(byName(buildRoster("guild-1"), "Anna").gear).toBeNull();
    });

    it("fills the WCL and armory links from the character name", () => {
        mockAnnotatedCharacters.mockReturnValue([lootChar()]);
        const anna = byName(buildRoster("guild-1"), "Anna");
        expect(anna.wclUrl).toContain("Anna");
        expect(anna.wclUrl).toContain("warcraftlogs.com");
        expect(anna.armoryUrl).toContain("Anna");
    });

    it("leaves class-derived fields empty when the class is still unknown", () => {
        mockAnnotatedCharacters.mockReturnValue([lootChar({ className: "", spec: "" })]);
        const anna = byName(buildRoster("guild-1"), "Anna");
        expect(anna.classColor).toBe("");
        expect(anna.iconUrl).toBe("");
    });

    it("sorts characters by name and resolves the guild's categories", () => {
        mockAnnotatedCharacters.mockReturnValue([lootChar({ key: "zed", character: "Zed" }), lootChar()]);
        mockListCategories.mockReturnValue([{ id: "cat1", name: "Montagsraid" }]);

        const roster = buildRoster("guild-1");

        expect(roster.chars.map((c) => c.character)).toEqual(["Anna", "Zed"]);
        expect(roster.categories).toEqual([{ id: "cat1", name: "Montagsraid" }]);
        expect(mockListCategories).toHaveBeenCalledWith("guild-1");
    });

    // Without a guild the roster still asks for names: with the gateway down
    // there is no guild to select, and the remembered names are then the only
    // thing that keeps the table from showing raw category ids.
    it("still resolves category names when no guild is active", () => {
        mockListCategories.mockReturnValue([{ id: "cat1", name: "Montagsraid" }]);
        expect(buildRoster("").categories).toEqual([{ id: "cat1", name: "Montagsraid" }]);
        expect(mockListCategories).toHaveBeenCalledWith("");
    });

    it("ignores a blank character name in the assignments", () => {
        mockListAllAssignments.mockReturnValue({ cat1: { u1: "   " } });
        expect(buildRoster("guild-1").chars).toEqual([]);
    });
});
