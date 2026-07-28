// reportStore is mocked: this tests which report wins per character and how an
// issue is trimmed, not file I/O.
const mockListReports = jest.fn(() => []);
const mockGetReport = jest.fn(() => null);
jest.mock("../../src/web/reportStore", () => ({
    listReports: (...a) => mockListReports(...a),
    getReport: (...a) => mockGetReport(...a),
}));

// issueIconUrl is pure — the per-test fresh copies below (jest.resetModules)
// only matter for the report cache inside latestIssuesByCharacter().
const { issueIconUrl } = require("../../src/web/charGearIssues");

const meta = (id, generatedAt, extra = {}) => ({
    id, generatedAt, title: `Report ${id}`, zone: "Karazhan",
    reportId: `wcl-${id}`, reportUrl: `https://classic.warcraftlogs.com/reports/wcl-${id}`,
    ...extra,
});

const issue = (over = {}) => ({
    kind: "noEnchant", itemId: 28963, itemName: "Spellstrike Hood", icon: "INV_Helmet_21.jpg",
    slot: 0, label: "keine Verzauberung", severity: "high", ...over,
});

describe("web/charGearIssues", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // The module caches condensed reports by id for the process' lifetime —
        // a fresh copy per test keeps ids from leaking between them.
        jest.resetModules();
    });

    function load() {
        return require("../../src/web/charGearIssues");
    }

    it("returns nothing when there are no reports", () => {
        expect(load().latestIssuesByCharacter()).toEqual({});
    });

    it("keys characters case-insensitively and without the realm suffix", () => {
        mockListReports.mockReturnValue([meta("a1", 200)]);
        mockGetReport.mockReturnValue({
            roster: [{ name: "Keslight-Thunderstrike", type: "Mage", issues: [issue()] }],
        });
        const byKey = load().latestIssuesByCharacter();
        expect(Object.keys(byKey)).toEqual(["keslight"]);
        expect(byKey.keslight.character).toBe("Keslight");
        expect(byKey.keslight.className).toBe("Mage");
    });

    it("keeps the newest report per character and carries its metadata", () => {
        // listReports() is sorted newest first, so a1 must win over a2.
        mockListReports.mockReturnValue([meta("a1", 300), meta("a2", 100)]);
        mockGetReport.mockImplementation((id) => (id === "a1"
            ? { roster: [{ name: "Anna", type: "Priest", issues: [] }] }
            : { roster: [{ name: "Anna", type: "Priest", issues: [issue(), issue({ kind: "emptySocket" })] }] }));

        const byKey = load().latestIssuesByCharacter();

        expect(byKey.anna.issueCount).toBe(0);
        expect(byKey.anna.reportRefId).toBe("a1");
        expect(byKey.anna.reportId).toBe("wcl-a1");
        expect(byKey.anna.reportUrl).toBe("https://classic.warcraftlogs.com/reports/wcl-a1");
        expect(byKey.anna.reportTitle).toBe("Report a1");
        expect(byKey.anna.zone).toBe("Karazhan");
        expect(byKey.anna.generatedAt).toBe(300);
    });

    it("falls back to the older report for someone the newest one doesn't contain", () => {
        mockListReports.mockReturnValue([meta("a1", 300), meta("a2", 100)]);
        mockGetReport.mockImplementation((id) => (id === "a1"
            ? { roster: [{ name: "Anna", type: "Priest", issues: [] }] }
            : { roster: [{ name: "Bob", type: "Warrior", issues: [issue()] }] }));

        const byKey = load().latestIssuesByCharacter();

        expect(byKey.anna.reportRefId).toBe("a1");
        expect(byKey.bob.reportRefId).toBe("a2");
        expect(byKey.bob.issueCount).toBe(1);
    });

    it("trims an issue to the fields the UI renders and builds the icon URL", () => {
        mockListReports.mockReturnValue([meta("a1", 200)]);
        mockGetReport.mockReturnValue({ roster: [{ name: "Anna", type: "Priest", issues: [issue()] }] });

        expect(load().latestIssuesByCharacter().anna.issues).toEqual([{
            kind: "noEnchant",
            label: "keine Verzauberung",
            severity: "high",
            itemId: "28963",
            itemName: "Spellstrike Hood",
            iconUrl: "https://wow.zamimg.com/images/wow/icons/large/inv_helmet_21.jpg",
        }]);
    });

    it("normalises an unknown severity to medium", () => {
        mockListReports.mockReturnValue([meta("a1", 200)]);
        mockGetReport.mockReturnValue({ roster: [{ name: "Anna", issues: [issue({ severity: undefined })] }] });
        expect(load().latestIssuesByCharacter().anna.issues[0].severity).toBe("medium");
    });

    it("falls back to players[] for reports built before the roster existed", () => {
        mockListReports.mockReturnValue([meta("a1", 200)]);
        mockGetReport.mockReturnValue({ players: [{ name: "Anna", type: "Priest", issues: [issue()] }] });
        expect(load().latestIssuesByCharacter().anna.issueCount).toBe(1);
    });

    it("only reads the newest maxReports evaluations", () => {
        mockListReports.mockReturnValue([meta("a1", 300), meta("a2", 200), meta("a3", 100)]);
        mockGetReport.mockImplementation((id) => ({ roster: [{ name: id, issues: [] }] }));

        const byKey = load().latestIssuesByCharacter({ maxReports: 2 });

        expect(Object.keys(byKey).sort()).toEqual(["a1", "a2"]);
        expect(mockGetReport).toHaveBeenCalledTimes(2);
    });

    it("reads each report file only once, however often the index is rebuilt", () => {
        mockListReports.mockReturnValue([meta("a1", 200)]);
        mockGetReport.mockReturnValue({ roster: [{ name: "Anna", issues: [] }] });
        const mod = load();
        mod.latestIssuesByCharacter();
        mod.latestIssuesByCharacter();
        expect(mockGetReport).toHaveBeenCalledTimes(1);
    });

    it("survives an unreadable report", () => {
        mockListReports.mockReturnValue([meta("a1", 200)]);
        mockGetReport.mockReturnValue(null);
        expect(load().latestIssuesByCharacter()).toEqual({});
    });

    describe("issueIconUrl", () => {
        it("lowercases the asset name and drops the extension", () => {
            expect(issueIconUrl("INV_Helmet_21.jpg")).toBe("https://wow.zamimg.com/images/wow/icons/large/inv_helmet_21.jpg");
        });

        it("returns an empty string when the report carried no icon", () => {
            expect(issueIconUrl(null)).toBe("");
        });
    });
});
