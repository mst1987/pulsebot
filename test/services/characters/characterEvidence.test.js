// Does a profile character exist in game? Evidence from the stored evaluations
// (with their version), the class cache (export/report/wcl, never manual), the
// profile's own source, an armory answer or the orga's check. The report and
// character stores are factory mocks.
jest.mock("../../../src/stores/reportStore", () => ({
    listReports: jest.fn(() => []),
    getReportRoster: jest.fn(() => null),
}));
jest.mock("../../../src/stores/characterStore", () => ({ listCharacters: jest.fn(() => []) }));

const { listReports, getReportRoster } = require("../../../src/stores/reportStore");
const characterStore = require("../../../src/stores/characterStore");
const evidence = require("../../../src/services/characters/characterEvidence");

const { characterEvidence, isVerified, armoryAnswered, seenIndex, buildSeenIndex, resetCache, REPORTS_WALKED, INDEX_TTL_MS } = evidence;

const tbc = (name, extra = {}) => ({ name, versionId: "tbc", className: "Druid", source: "manual", armory: null, ...extra });
const forever = (name, extra = {}) => tbc(name, { versionId: "forever", ...extra });

beforeEach(() => {
    jest.clearAllMocks();
    listReports.mockReturnValue([]);
    getReportRoster.mockReturnValue(null);
    characterStore.listCharacters.mockReturnValue([]);
    resetCache();
});

describe("characterEvidence", () => {
    it("has none for a character the raider only typed", () => {
        expect(characterEvidence(tbc("Gentle"))).toEqual({ verified: false, via: "" });
        expect(isVerified(tbc("Gentle"))).toBe(false);
        expect(characterEvidence(null)).toEqual({ verified: false, via: "" });
        expect(characterEvidence({ name: "  " })).toEqual({ verified: false, via: "" });
    });

    it("takes a character from the logs (source log) as seen", () => {
        expect(characterEvidence(tbc("Gentleowl", { source: "log" }))).toEqual({ verified: true, via: "log" });
    });

    it("finds a character in the roster of a stored evaluation of its own version only", () => {
        listReports.mockReturnValue([{ id: "r1", versionId: "tbc" }, { id: "r2", versionId: "forever" }]);
        getReportRoster.mockImplementation((id) => ({
            r1: { roster: [{ name: "Gentleowl-Thunderstrike" }] },
            r2: { roster: [{ name: "Gentle" }, { name: "Devi Res" }] },
        }[id]));
        expect(characterEvidence(tbc("gentleowl"))).toEqual({ verified: true, via: "log" });
        // a Forever log of a "Gentle" is no evidence for the TBC "Gentle"
        expect(characterEvidence(tbc("Gentle"))).toEqual({ verified: false, via: "" });
        expect(characterEvidence(forever("Gentle"))).toEqual({ verified: true, via: "log" });
        expect(characterEvidence(forever("Devi Res"))).toEqual({ verified: true, via: "log" });
        // a character stored without a version is TBC
        expect(characterEvidence({ name: "Gentleowl" })).toEqual({ verified: true, via: "log" });
    });

    it("walks only the newest evaluations", () => {
        listReports.mockReturnValue(Array.from({ length: REPORTS_WALKED + 3 }, (_, i) => ({ id: `r${i}`, versionId: "tbc" })));
        buildSeenIndex();
        expect(getReportRoster).toHaveBeenCalledTimes(REPORTS_WALKED);
    });

    it("counts the class cache's export as loot and its report/wcl as log, never its manual entries — as TBC", () => {
        characterStore.listCharacters.mockReturnValue([
            { key: "lootie", character: "Lootie", source: "export" },
            { key: "reporty", character: "Reporty", source: "report" },
            { key: "wclly", character: "Wclly", source: "wcl" },
            { key: "handy", character: "Handy", source: "manual" },
        ]);
        expect(characterEvidence(tbc("Lootie"))).toEqual({ verified: true, via: "loot" });
        expect(characterEvidence(tbc("Reporty"))).toEqual({ verified: true, via: "log" });
        expect(characterEvidence(tbc("Wclly"))).toEqual({ verified: true, via: "log" });
        expect(characterEvidence(tbc("Handy"))).toEqual({ verified: false, via: "" });
        expect(characterEvidence(forever("Lootie"))).toEqual({ verified: false, via: "" });
    });

    it("prefers a log over the loot for the same character", () => {
        listReports.mockReturnValue([{ id: "r1", versionId: "tbc" }]);
        getReportRoster.mockReturnValue({ roster: [{ name: "Both" }] });
        characterStore.listCharacters.mockReturnValue([{ key: "both", character: "Both", source: "export" }]);
        expect(seenIndex().get("both")).toBe("log");
        expect(characterEvidence(tbc("Both")).via).toBe("log");
    });

    it("takes a real armory answer, never a link alone", () => {
        expect(characterEvidence(tbc("Armo", { armory: { level: 70, guild: "", fetchedAt: 5 } }))).toEqual({ verified: true, via: "armory" });
        expect(characterEvidence(tbc("Armo", { source: "armory", armory: { level: null, guild: "", fetchedAt: 5 } })).verified).toBe(false);
        expect(characterEvidence(tbc("Armo", { source: "armory", armory: { level: 70, guild: "", fetchedAt: 0 } })).verified).toBe(false);
        expect(characterEvidence(tbc("Armo", { source: "armory" })).verified).toBe(false);
        expect(armoryAnswered(null)).toBe(false);
    });

    it("takes the orga's check in game", () => {
        expect(characterEvidence(tbc("Checked", { verifiedAt: 123, verifiedBy: "9", verifiedByName: "Orga" }))).toEqual({ verified: true, via: "orga" });
    });

    it("has none for a character of another version than asked", () => {
        expect(characterEvidence(tbc("Logged", { source: "log" }), { gameVersion: "forever" })).toEqual({ verified: false, via: "" });
        expect(characterEvidence(tbc("Logged", { source: "log" }), { gameVersion: "tbc" })).toEqual({ verified: true, via: "log" });
        expect(characterEvidence(forever("Checked", { verifiedAt: 1 }), { gameVersion: "tbc" }).verified).toBe(false);
    });

    it("takes an index the caller built already", () => {
        const index = new Map([["gentleowl", "loot"]]);
        expect(characterEvidence(tbc("Gentleowl"), { index })).toEqual({ verified: true, via: "loot" });
        expect(listReports).not.toHaveBeenCalled();
    });
});

describe("seenIndex", () => {
    it("is built once per INDEX_TTL_MS, again after it or a reset", () => {
        seenIndex({ now: 1000 });
        seenIndex({ now: 1000 + INDEX_TTL_MS });
        expect(listReports).toHaveBeenCalledTimes(1);
        seenIndex({ now: 1001 + INDEX_TTL_MS });
        expect(listReports).toHaveBeenCalledTimes(2);
        // a clock that went back builds anew
        seenIndex({ now: 10 });
        expect(listReports).toHaveBeenCalledTimes(3);
        resetCache();
        seenIndex({ now: 10 });
        expect(listReports).toHaveBeenCalledTimes(4);
    });

    it("skips players without a name and reports without a roster", () => {
        listReports.mockReturnValue([{ id: "r1" }, { id: "r2" }]);
        getReportRoster.mockImplementation((id) => (id === "r1" ? { roster: [null, { name: "" }, { name: "Ok" }] } : null));
        expect([...buildSeenIndex().entries()]).toEqual([["ok", "log"]]);
    });
});
