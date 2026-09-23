// Which characters stand behind a Discord account when the setup editor counts
// its attendance — manual links (assignment, own profile) vs. the signup's own
// characters (auto). The counting itself is tested in rosterAttendance.test.js.
const mockSignups = {};
jest.mock("../../src/web/signupStore", () => ({ listSignups: (id) => mockSignups[id] || [] }));
let mockProfiles = [];
jest.mock("../../src/web/raiderProfileStore", () => ({ listProfiles: () => mockProfiles }));
jest.mock("../../src/web/characterStore", () => ({
    getCharacter: (name) => ({ Zibbo: { className: "Priest" } }[name] || null),
}));
let mockAssignments = {};
jest.mock("../../src/web/raiderCharactersStore", () => ({ getCategoryAssignments: () => mockAssignments }));
const mockCounted = jest.fn();
jest.mock("../../src/web/rosterAttendance", () => ({
    buildAttendanceContext: () => ({}),
    attendanceForAccounts: (...a) => mockCounted(...a),
}));

const { setupAttendance, accountCharacters } = require("../../src/web/setupAttendance");

describe("accountCharacters", () => {
    it("puts the orga's assignment and the profile's characters first, as manual links", () => {
        const chars = accountCharacters("u1", "cat", { character: "Sig", spec: "Rogue-Combat" }, { characters: [{ name: "Prof", className: "Mage" }] }, { u1: "Zibbo" });
        expect(chars).toEqual([
            { name: "Zibbo", className: "Priest", manual: true },
            { name: "Prof", className: "Mage", manual: true },
            { name: "Sig", className: "Rogue", manual: false },
        ]);
    });

    it("lets a manual link win when the signup names the same character, and reads all named characters", () => {
        const signup = { characters: [{ character: "zibbo", spec: "Priest-Holy" }, { character: "Twink", spec: "Mage-Fire" }] };
        const chars = accountCharacters("u1", "cat", signup, null, { u1: "Zibbo" });
        expect(chars).toEqual([
            { name: "Zibbo", className: "Priest", manual: true },
            { name: "Twink", className: "Mage", manual: false },
        ]);
    });
});

describe("setupAttendance", () => {
    beforeEach(() => {
        mockCounted.mockReset();
        mockAssignments = {};
        mockProfiles = [];
        for (const k of Object.keys(mockSignups)) delete mockSignups[k];
    });

    it("counts every signed-up raider once, skips absences and returns the result by user id", () => {
        mockSignups.e1 = [
            { userId: "u1", character: "Anna", spec: "Priest-Holy", status: "signed" },
            { userId: "u2", character: "Bob", spec: "Mage-Fire", status: "absence" },
        ];
        mockCounted.mockReturnValue(new Map([["u1", { pct: 80, attended: 8, total: 10, link: "auto", inferred: 0, missed: [] }]]));
        const out = setupAttendance([{ id: "e1", categoryId: "cat", guildId: "g" }]);
        expect(out).toEqual({ u1: expect.objectContaining({ pct: 80, link: "auto" }) });
        const [, category, accounts] = mockCounted.mock.calls[0];
        expect(category).toBe("cat");
        expect(accounts.map((a) => a.userId)).toEqual(["u1"]);
    });

    it("does nothing for events without a category", () => {
        expect(setupAttendance([{ id: "e1", guildId: "g" }])).toEqual({});
        expect(mockCounted).not.toHaveBeenCalled();
    });
});
