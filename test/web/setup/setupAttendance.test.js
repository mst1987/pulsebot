// Which characters stand behind a Discord account when the setup editor counts
// its attendance — manual links (assignment, own profile) vs. the signup's own
// characters (auto). The counting itself is tested in rosterAttendance.test.js.
const mockSignups = {};
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: (id) => mockSignups[id] || [] }));
let mockProfiles = [];
jest.mock("../../../src/stores/raiderProfileStore", () => ({ listProfiles: () => mockProfiles }));
jest.mock("../../../src/stores/characterStore", () => ({
    getCharacter: (name) => ({ Zibbo: { className: "Priest" } }[name] || null),
}));
let mockAssignments = {};
jest.mock("../../../src/stores/raiderCharactersStore", () => ({ getCategoryAssignments: () => mockAssignments }));
const mockCounted = jest.fn();
jest.mock("../../../src/services/characters/rosterAttendance", () => ({
    buildAttendanceContext: () => ({}),
    attendanceForAccounts: (...a) => mockCounted(...a),
}));

let mockHistory = [];
jest.mock("../../../src/services/setup/setupInput", () => ({ benchHistory: () => ({ source: "setups", history: mockHistory }) }));

const { setupAttendance, accountCharacters, comparableTo } = require("../../../src/web/setup/setupAttendance");

describe("comparableTo — the same kind of raid", () => {
    const night = (title, zone) => ({ title, logs: zone ? [{ zone }] : [] });

    it("keeps a 25-man event to 25-man nights and a 10-man event to 10-man nights, told from title or log zone", () => {
        const big = comparableTo({ size: 25 });
        expect(big(night("SSC&TK&Gruul"))).toBe(true);
        expect(big(night("Karazhan mit Sapa"))).toBe(false);
        expect(big(night("Freitag", "Karazhan"))).toBe(false);
        const small = comparableTo({ size: 10 });
        expect(small(night("Karazhan mit Sapa"))).toBe(true);
        expect(small(night("Hyjal+BT+Gruul"))).toBe(false);
    });

    it("lets a night through whose kind cannot be told, and asks for no filter without an event size", () => {
        expect(comparableTo({ size: 25 })(night("Spontan-Raid"))).toBe(true);
        expect(comparableTo({})).toBeNull();
        expect(comparableTo(undefined)).toBeNull();
    });
});

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

    it("says when a raider last signed up but stood on the bench — the newest night that benched them", () => {
        mockSignups.e1 = [
            { userId: "u1", character: "Anna", spec: "Priest-Holy", status: "signed" },
            { userId: "u2", character: "Bob", spec: "Mage-Fire", status: "signed" },
        ];
        mockCounted.mockReturnValue(new Map([
            ["u1", { pct: 80, attended: 8, total: 10, link: "auto", inferred: 0, missed: [] }],
            ["u2", { pct: 90, attended: 9, total: 10, link: "auto", inferred: 0, missed: [] }],
        ]));
        // newest first: u1 was benched on the second-newest night and on an older one — the newer counts
        mockHistory = [
            { eventId: "h3", startTime: 3000, placed: ["u1", "u2"], bench: [] },
            { eventId: "h2", startTime: 2000, placed: ["u2"], bench: ["u1"] },
            { eventId: "h1", startTime: 1000, placed: [], bench: ["u1"] },
        ];
        const out = setupAttendance([{ id: "e1", categoryId: "cat", guildId: "g" }]);
        expect(out.u1).toMatchObject({ lastBench: 2000, benchNights: 3 });
        // never benched in the nights looked at: 0, with the number of nights so the page can say "in the last 3 raids"
        expect(out.u2).toMatchObject({ lastBench: 0, benchNights: 3 });
        mockHistory = [];
    });

    it("does nothing for events without a category", () => {
        expect(setupAttendance([{ id: "e1", guildId: "g" }])).toEqual({});
        expect(mockCounted).not.toHaveBeenCalled();
    });
});
