// The roster of a category as the council's candidate list (#667): which
// characters, with which status, and the profile's class and spec as hint.
const mockRosterForCategory = jest.fn(() => null);
const mockGetRoster = jest.fn(() => null);
const mockListProfiles = jest.fn(() => []);
jest.mock("../../../src/stores/rosterStore", () => ({ rosterForCategory: (...a) => mockRosterForCategory(...a), getRoster: (...a) => mockGetRoster(...a) }));
jest.mock("../../../src/stores/raiderProfileStore", () => ({ listProfiles: (...a) => mockListProfiles(...a) }));

const { rosterCandidates, specIdOf, CANDIDATE_STATUSES } = require("../../../src/web/loot/councilRosterSource");

beforeEach(() => {
    jest.clearAllMocks();
    mockRosterForCategory.mockReturnValue(null);
    mockListProfiles.mockReturnValue([]);
});

describe("councilRosterSource with a roster id (#676)", () => {
    it("reads the named roster instead of the category's - also one without category", () => {
        mockGetRoster.mockReturnValue({ id: "r9", name: "PuG", versionId: "tbc", members: { 1001: { status: "trial", chars: ["devi"], charNames: {} } } });
        const out = rosterCandidates("", { rosterId: "r9" });
        expect(mockGetRoster).toHaveBeenCalledWith("r9");
        expect(mockRosterForCategory).not.toHaveBeenCalled();
        expect(out.roster).toEqual({ id: "r9", name: "PuG", versionId: "tbc" });
        expect(out.candidates).toEqual(["devi"]);
        mockGetRoster.mockReturnValue(null);
        expect(rosterCandidates("c1", { rosterId: "gone" })).toBeNull();
    });
});

describe("councilRosterSource", () => {
    it("answers null without a category or without a roster", () => {
        expect(rosterCandidates("")).toBeNull();
        expect(mockRosterForCategory).not.toHaveBeenCalled();
        expect(rosterCandidates("c1")).toBeNull();
        expect(mockRosterForCategory).toHaveBeenCalledWith("c1");
    });

    it("keys characters by their bare name, keeps the roster key, the typed name without realm and the status", () => {
        mockRosterForCategory.mockReturnValue({
            id: "r1", name: "Montag", versionId: "forever",
            members: {
                1001: { status: "core", chars: ["forever~devi res", "forever~devi rew"], charNames: { "forever~devi res": "Devi Res-Realm" } },
                1002: { status: "bench", chars: ["forever~bank"], charNames: {} },
            },
        });
        mockListProfiles.mockReturnValue([{
            userId: "1001",
            characters: [{ key: "forever~devi rew", name: "Devi Rew", className: "Mage", specs: [{ key: "Mage-Fire" }] }],
        }]);
        const out = rosterCandidates("c1");
        expect(out.roster).toEqual({ id: "r1", name: "Montag", versionId: "forever" });
        expect(out.candidates).toEqual(["devi res", "devi rew"]);
        expect(out.counts).toEqual({ core: 2, trial: 0, bench: 1, pause: 0 });
        expect(out.entries.get("devi res")).toMatchObject({ rosterKey: "forever~devi res", name: "Devi Res", status: "core", userId: "1001", className: "", specs: [] });
        expect(out.entries.get("devi rew")).toMatchObject({ name: "Devi Rew", className: "Mage", specs: ["Fire"] });
        expect(rosterCandidates("c1", { showBench: true }).candidates).toEqual(["devi res", "devi rew", "bank"]);
    });

    it("gives a character two members name the stronger status", () => {
        mockRosterForCategory.mockReturnValue({
            id: "r1", name: "R", versionId: "tbc",
            members: {
                1001: { status: "pause", chars: ["geteilt"], charNames: {} },
                1002: { status: "trial", chars: ["geteilt"], charNames: {} },
                1003: { status: "bench", chars: ["geteilt"], charNames: {} },
            },
        });
        const out = rosterCandidates("c1");
        expect(out.entries.get("geteilt").status).toBe("trial");
        expect(out.candidates).toEqual(["geteilt"]);
        expect(out.counts.trial).toBe(1);
    });

    it("reads the spec out of a profile spec key", () => {
        expect(specIdOf("Priest-Shadow")).toBe("Shadow");
        expect(specIdOf("Hunter-BeastMastery")).toBe("BeastMastery");
        expect(specIdOf("nonsense")).toBe("");
        expect(CANDIDATE_STATUSES).toEqual(["core", "trial"]);
    });
});
