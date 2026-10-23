// How an account is tied to the raids (src/services/discord/memberRelation.js): open rosters
// with status, characters from profile, rosters and category assignments (each name once,
// class from the profile), and the index for a whole server answering the same.
const mockRosters = [];
const mockProfiles = {};
const mockAssignments = {};
jest.mock("../../../src/stores/rosterStore", () => ({
    listRosters: () => mockRosters,
    isClosed: (r) => !!r.closedAt,
}));
jest.mock("../../../src/stores/raiderProfileStore", () => ({
    hasProfile: (uid) => !!mockProfiles[uid],
    getProfile: (uid) => mockProfiles[uid],
    findCharacter: (profile, key) => (profile.characters || []).find((c) => c.key === key) || null,
}));
jest.mock("../../../src/stores/raiderCharactersStore", () => ({
    charactersForUser: (uid) => Object.values(mockAssignments)
        .filter((map) => map[uid])
        .map((map) => ({ character: map[uid], categoryIds: [] })),
    listAllAssignments: () => mockAssignments,
}));

const { relationOf, relationIndex } = require("../../../src/services/discord/memberRelation");

const U1 = "100000000000000001";
const U2 = "100000000000000002";

beforeEach(() => {
    mockRosters.length = 0;
    for (const o of [mockProfiles, mockAssignments]) for (const k of Object.keys(o)) delete o[k];
    mockRosters.push(
        {
            id: "r1", name: "TBC Main", categoryId: "c1", versionId: "tbc",
            members: { [U1]: { status: "core", chars: ["ostrava-tbc", "heiltrank-tbc"], charNames: { "heiltrank-tbc": "Heiltrank" } } },
        },
        { id: "r2", name: "Alt", categoryId: "c2", versionId: "tbc", closedAt: "2026-10-01", members: { [U1]: { status: "core", chars: ["alt-tbc"] } } },
        { id: "r3", name: "Forever", categoryId: "c3", versionId: "forever", members: { [U1]: { status: "trial", chars: [] } } },
    );
    mockProfiles[U1] = { characters: [{ key: "ostrava-tbc", name: "Ostrava", className: "Shaman", versionId: "tbc" }] };
    mockAssignments.c9 = { [U1]: "Dritter", [U2]: "Fremder" };
    mockAssignments.c8 = { [U1]: "ostrava" };
});

describe("memberRelation relationOf", () => {
    it("names the open rosters with status and version", () => {
        expect(relationOf(U1).rosters).toEqual([
            { id: "r1", name: "TBC Main", categoryId: "c1", versionId: "tbc", status: "core" },
            { id: "r3", name: "Forever", categoryId: "c3", versionId: "forever", status: "trial" },
        ]);
    });

    it("lists each character once, the class from the profile, a roster name without one, assignments last", () => {
        expect(relationOf(U1).characters).toEqual([
            { name: "Ostrava", className: "Shaman", versionId: "tbc" },
            { name: "Heiltrank", className: "", versionId: "tbc" },
            { name: "Dritter", className: "", versionId: "" },
        ]);
    });

    it("is empty for no id and for an account without anything", () => {
        expect(relationOf("")).toEqual({ rosters: [], characters: [] });
        expect(relationOf("100000000000000099")).toEqual({ rosters: [], characters: [] });
    });

    it("falls back to the name part of the key when the roster has no name for it", () => {
        mockRosters[0].members[U1].charNames = {};
        delete mockProfiles[U1];
        expect(relationOf(U1).characters.map((c) => c.name)).toEqual(["ostrava", "heiltrank", "Dritter"]);
    });
});

describe("memberRelation relationIndex", () => {
    it("answers like relationOf for every account, the stores read once", () => {
        const index = relationIndex();
        expect(index.of(U1)).toEqual(relationOf(U1));
        expect(index.of(U2)).toEqual({ rosters: [], characters: [{ name: "Fremder", className: "", versionId: "" }] });
        expect(index.of("")).toEqual({ rosters: [], characters: [] });
        expect(index.rosters.map((r) => r.id)).toEqual(["r1", "r3"]);
    });
});
