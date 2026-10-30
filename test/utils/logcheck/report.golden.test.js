// Golden master for buildReport (#747): a whole TBC report, built by every real
// analyzer from a deterministic fake Warcraft-Logs client, must come out byte
// for byte as it did before the log check learnt rule sets per version
// (utils/logcheck/rules.js). The fake answers every v1 call from a seeded PRNG
// over the spell ids of the TBC tables, so the analyzers find buffs, debuffs,
// totems, cooldowns, potions, drums and deaths — the numbers are nonsense, the
// point is only that the same input still yields the same bytes.
//
// A deliberate change to the report's content regenerates the fixture:
//   UPDATE_GOLDEN=1 npx jest test/utils/logcheck/report.golden.test.js
const fs = require("fs");
const path = require("path");

const mockSaved = [];

jest.mock("../../../src/classes/warcraftlogs.js", () => {
    const { mockFakeWcl } = require("../../helpers/fakeWcl");
    return function WarcraftLogsMock() {
        return mockFakeWcl();
    };
});
jest.mock("../../../src/stores/settings/settingsStore.js", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/stores/loot/reportStore.js", () => ({
    saveReport: (report) => { mockSaved.push(report); return "golden1"; },
    getReport: () => null,
}));
jest.mock("../../../src/config/variables.js", () => ({ publicBaseUrl: "http://localhost:3005" }));

const { buildReport } = require("../../../src/utils/logcheck/report.js");

const FILE = path.join(__dirname, "..", "..", "fixtures", "reportBuildGolden", "tbc-report.json");

/** One top-level field per line: small on disk, and a diff still names the field that moved. */
function serialize(report) {
    const lines = Object.keys(report).map((k) => `${JSON.stringify(k)}: ${JSON.stringify(report[k] === undefined ? null : report[k])}`);
    return `{\n${lines.join(",\n")}\n}\n`;
}

beforeEach(() => {
    mockSaved.length = 0;
    jest.spyOn(Date, "now").mockReturnValue(1760000000000);
    jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("logcheck/report — golden master of a TBC build", () => {
    it("builds the same report as before the rule sets, byte for byte", async () => {
        const { report } = await buildReport("https://fresh.warcraftlogs.com/reports/GoldenTbc1", { versionId: "tbc" });
        // the analyzers really ran — an all-null report would prove nothing
        for (const key of ["consumables", "drums", "potions", "shadowResi", "sunder", "bossUptimes", "timeline", "raidDebuffs", "cooldowns", "totems", "mechanics", "activity", "healers", "raidBuffs", "rpb"]) {
            expect([key, report[key]]).not.toEqual([key, null]);
        }
        const actual = serialize(report);
        if (process.env.UPDATE_GOLDEN) {
            fs.mkdirSync(path.dirname(FILE), { recursive: true });
            fs.writeFileSync(FILE, actual);
        }
        // a Windows checkout (core.autocrlf) hands the fixture back with CRLF
        expect(actual).toBe(fs.readFileSync(FILE, "utf8").replace(/\r\n/g, "\n"));
    });
});
