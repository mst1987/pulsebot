// What the logs know about a raider's characters (#255): the index over the
// stored evaluations plus the character store, the "laut Logs" badge and the
// suggestions for "Aus den Logs übernehmen". The report and character stores
// are factory mocks; the profile store runs for real on a scratch file.
jest.mock("../../../src/stores/reportStore", () => ({
    listReports: jest.fn(() => []),
    getReportRoster: jest.fn(() => null),
}));
jest.mock("../../../src/stores/characterStore", () => ({ listCharacters: jest.fn(() => []) }));
jest.mock("../../../src/stores/raiderCharactersStore", () => ({ listAllAssignments: jest.fn(() => ({})) }));

const fs = require("fs");
const { listReports, getReportRoster } = require("../../../src/stores/reportStore");
const characterStore = require("../../../src/stores/characterStore");
const raiderCharacters = require("../../../src/stores/raiderCharactersStore");
const profiles = require("../../../src/stores/raiderProfileStore");
const {
    logIndex, specEvidence, logSuggestions, matchReason, MAX_REPORTS, MAX_SUGGESTIONS,
} = require("../../../src/web/characters/profileLogs");
const { tempStoreFile } = require("../../helpers/tempStore");

const PROFILES_FILE = tempStoreFile("eh-profile-logs.json");

/** Stored profiles by user id, written as the store keeps them. */
function seedProfiles(byId) {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify({ profiles: byId }));
}

const ch = (name, className, over = {}) => ({ name, className, source: "log", ...over });

/** Reports r1 (newest) and r2 plus a report whose roster is gone. */
function seedReports() {
    listReports.mockReturnValue([
        { id: "r1", generatedAt: 2000 },
        { id: "r2" },
        { id: "r3", generatedAt: 500 },
    ]);
    getReportRoster.mockImplementation((id) => ({
        r1: { roster: [{ name: "Alpha", type: "Mage" }, { name: "alpha", type: "Mage" }, { name: "Beta", type: "Unknown" }, { name: "" }, null] },
        r2: { generatedAt: 1000, roster: [{ name: "Alpha", type: "mage" }] },
    }[id] || null));
    characterStore.listCharacters.mockReturnValue([
        { character: "Alpha", className: "mage", spec: "Fire", source: "wcl", updatedAt: 5 },
        { character: "Gamma", className: "Priest", spec: "Holy", updatedAt: 3000 },
        { character: "Beta", className: "Warrior", spec: "Bogus" },
        { character: "Delta", className: "Rogue", spec: "" },
        { character: "", className: "Mage" },
    ]);
}

beforeAll(() => profiles.useFile(PROFILES_FILE));
afterAll(() => profiles.useFile(null));

beforeEach(() => {
    jest.clearAllMocks();
    listReports.mockReturnValue([]);
    getReportRoster.mockReturnValue(null);
    characterStore.listCharacters.mockReturnValue([]);
    raiderCharacters.listAllAssignments.mockReturnValue({});
    seedProfiles({});
});

describe("logIndex", () => {
    it("merges the evaluations and the character store into one entry per character", () => {
        seedReports();
        const index = logIndex();
        expect([...index.keys()].sort()).toEqual(["alpha", "beta", "delta", "gamma"]);
        expect(index.get("alpha")).toEqual({
            key: "alpha", character: "Alpha", className: "Mage", reports: 2, lastSeen: 2000,
            spec: "Fire", specKey: "Mage-Fire", specSource: "wcl",
        });
        // Unknown class in the log, the class from the store; a spec the rule set does not know stays empty.
        expect(index.get("beta")).toEqual({
            key: "beta", character: "Beta", className: "Warrior", reports: 1, lastSeen: 2000,
            spec: "", specKey: "", specSource: "",
        });
        // Only in the store: seen when the store last updated it.
        expect(index.get("gamma")).toEqual({
            key: "gamma", character: "Gamma", className: "Priest", reports: 0, lastSeen: 3000,
            spec: "Holy", specKey: "Priest-Holy", specSource: "",
        });
        expect(index.get("delta")).toMatchObject({ className: "Rogue", specKey: "", lastSeen: 0 });
    });

    it("walks only the newest MAX_REPORTS evaluations", () => {
        listReports.mockReturnValue(Array.from({ length: MAX_REPORTS + 5 }, (_, i) => ({ id: `r${i}` })));
        logIndex();
        expect(MAX_REPORTS).toBe(60);
        expect(getReportRoster).toHaveBeenCalledTimes(60);
        expect(getReportRoster).toHaveBeenLastCalledWith("r59");
    });

    it("is empty without evaluations and characters", () => {
        expect(logIndex().size).toBe(0);
    });
});

describe("specEvidence", () => {
    it("says seen for the spec the logs resolved, with the count and source", () => {
        seedReports();
        expect(specEvidence("Alpha", "Mage-Fire")).toEqual({ status: "seen", reports: 2, source: "wcl" });
    });

    it("says other for a known character with another or no known spec", () => {
        seedReports();
        const index = logIndex();
        expect(specEvidence("alpha", "Mage-Frost", index)).toEqual({ status: "other", reports: 2, loggedSpec: "Mage-Fire" });
        expect(specEvidence("Beta", "Warrior-Arms", index)).toEqual({ status: "other", reports: 1, loggedSpec: "" });
        expect(specEvidence("Gamma", "Priest-Shadow", index)).toEqual({ status: "other", reports: 0, loggedSpec: "Priest-Holy" });
    });

    it("says unknown for a character the logs do not know or know nothing about", () => {
        seedReports();
        const index = logIndex();
        expect(specEvidence("Nobody", "Mage-Fire", index)).toEqual({ status: "unknown", reports: 0 });
        // Delta is only in the store and without a spec: nothing to say.
        expect(specEvidence("Delta", "Rogue-Combat", index)).toEqual({ status: "unknown", reports: 0 });
    });
});

describe("matchReason", () => {
    const entry = (character) => ({ key: profiles.characterKey(character), character });

    it("prefers an existing assignment over any name match", () => {
        expect(matchReason(entry("Zed"), { userName: "x", assigned: new Set(["zed"]) })).toBe("assigned");
    });

    it("matches when the account name contains the character or both start alike", () => {
        const ctx = { userName: "Nerathil#1234", assigned: new Set() };
        expect(matchReason(entry("Nerathil"), ctx)).toBe("name");
        expect(matchReason(entry("Nerasol"), ctx)).toBe("name");
        expect(matchReason(entry("Bobbington"), ctx)).toBe("");
    });

    it("never matches on names shorter than four letters", () => {
        expect(matchReason(entry("Nera"), { userName: "Ner", assigned: new Set() })).toBe("");
        expect(matchReason(entry("Bo"), { userName: "Bobby", assigned: new Set() })).toBe("");
        expect(matchReason(entry("Bobby"), { userName: undefined, assigned: new Set() })).toBe("");
    });
});

describe("logSuggestions", () => {
    const USER = { id: "100001", name: "alphaplayer" };

    it("leaves out own characters and classless ones, ranks assigned, name matches and claims", () => {
        seedReports();
        seedProfiles({
            100001: { name: "Me", characters: [ch("Gamma", "Priest")] },
            100002: { name: "Other", characters: [ch("Delta", "Rogue")] },
        });
        raiderCharacters.listAllAssignments.mockReturnValue({ c1: { 100001: "Beta" }, c2: { 100009: "Alpha" } });

        const out = logSuggestions(USER);
        expect(out).toEqual([
            { character: "Beta", className: "Warrior", specKey: "", reports: 1, lastSeen: 2000, match: "assigned", claimedBy: [] },
            { character: "Alpha", className: "Mage", specKey: "Mage-Fire", reports: 2, lastSeen: 2000, match: "name", claimedBy: [] },
            { character: "Delta", className: "Rogue", specKey: "", reports: 0, lastSeen: 0, match: "", claimedBy: [{ userId: "100002", name: "Other" }] },
        ]);
    });

    it("narrows by the query on the character key", () => {
        seedReports();
        expect(logSuggestions(USER, { query: "  DEL " }).map((s) => s.character)).toEqual(["Delta"]);
        expect(logSuggestions(USER, { query: "zzz" })).toEqual([]);
    });

    it("orders unmatched names by claims, then last seen, then name, and caps the list", () => {
        const index = new Map();
        for (let i = 0; i < MAX_SUGGESTIONS + 5; i++) {
            const name = `Char${String(i).padStart(2, "0")}`;
            index.set(name.toLowerCase(), { key: name.toLowerCase(), character: name, className: "Mage", reports: 1, lastSeen: i < 3 ? 100 : 0, specKey: "" });
        }
        seedProfiles({ 100002: { name: "Other", characters: [ch("Char00", "Mage")] } });
        const out = logSuggestions({ id: "100001", name: "zz" }, { index });
        expect(out).toHaveLength(MAX_SUGGESTIONS);
        expect(out.slice(0, 3).map((s) => s.character)).toEqual(["Char01", "Char02", "Char03"]);
        expect(out.find((s) => s.character === "Char00")).toBeUndefined();
    });

    it("works for a caller without an id or name", () => {
        seedReports();
        const out = logSuggestions(null);
        expect(out.map((s) => s.character)).toEqual(["Gamma", "Alpha", "Beta", "Delta"]);
    });
});
