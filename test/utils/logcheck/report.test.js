// Focused on buildReport()'s in-flight de-dup guard (two submits of the same
// link racing must not build/save the report twice) — the rest of the pipeline
// (analyzers) is mocked out since it's covered by their own unit tests.
const mockGetFights = jest.fn();
const mockGetCasts = jest.fn();
const mockParseReportId = jest.fn((link) => String(link || "").trim() || null);

jest.mock("../../../src/classes/warcraftlogs.js", () => {
    function WarcraftLogsMock() {
        this.getFights = mockGetFights;
        this.getCasts = mockGetCasts;
    }
    WarcraftLogsMock.parseReportId = (...args) => mockParseReportId(...args);
    return WarcraftLogsMock;
});
jest.mock("../../../src/utils/logcheck/gearIssues.js", () => ({
    buildGearIssues: jest.fn(() => []),
    buildArmory: jest.fn(() => ({})),
}));
jest.mock("../../../src/utils/logcheck/consumables.js", () => ({ analyzeConsumables: jest.fn(async () => null) }));
jest.mock("../../../src/utils/logcheck/shadowResi.js", () => ({ analyzeShadowResi: jest.fn(() => null) }));
jest.mock("../../../src/utils/logcheck/drums.js", () => ({ analyzeDrums: jest.fn(async () => null) }));
jest.mock("../../../src/utils/logcheck/potions.js", () => ({
    analyzePotions: jest.fn(async () => null),
    potionsByName: jest.fn(() => ({})),
}));
jest.mock("../../../src/utils/logcheck/sunder.js", () => ({ analyzeSunder: jest.fn(async () => null) }));
jest.mock("../../../src/utils/logcheck/bossUptimes.js", () => ({ analyzeBossUptimes: jest.fn(async () => null) }));
jest.mock("../../../src/utils/logcheck/rpb/index.js", () => ({
    analyzeRpb: jest.fn(async () => ({ roles: {}, byRole: {} })),
    rpbSummaryLines: jest.fn(() => ["🎭 Rollen: Tank 2"]),
}));
jest.mock("../../../src/utils/logcheck/common.js", () => ({ selectPlayers: jest.fn(() => []) }));
const mockSaveReport = jest.fn();
const mockGetReport = jest.fn();
jest.mock("../../../src/web/reportStore.js", () => ({
    saveReport: (...args) => mockSaveReport(...args),
    getReport: (...args) => mockGetReport(...args),
}));
jest.mock("../../../src/config/variables.js", () => ({ publicBaseUrl: "http://localhost:3005" }));

const { analyzeConsumables } = require("../../../src/utils/logcheck/consumables.js");
const { analyzeRpb } = require("../../../src/utils/logcheck/rpb/index.js");
const {
    buildReport, mergeRoster, reportSummaryLines, normalizeSections, stripSection,
    ReportError, IncompleteRaidError,
} = require("../../../src/utils/logcheck/report.js");

beforeEach(() => {
    jest.clearAllMocks();
    mockParseReportId.mockImplementation((link) => String(link || "").trim() || null);
    // A finished raid night by default: buildReport refuses to evaluate one whose
    // final boss is still standing (see the guard tests at the bottom), so every
    // other test here needs a log that actually got to the end.
    mockGetFights.mockResolvedValue({
        title: "SSC + TK", zoneName: "Serpentshrine Cavern", start: 0, end: 100,
        fights: [
            { id: 1, boss: 623, name: "Hydross the Unstable", kill: true },
            { id: 2, boss: 628, name: "Lady Vashj", kill: true },
        ],
    });
    mockGetCasts.mockResolvedValue({ entries: [] });
    mockGetReport.mockReturnValue(null);
    let n = 0;
    mockSaveReport.mockImplementation(() => `id${++n}`);
});

describe("logcheck/report — buildReport dedup", () => {
    it("joins an already-running build for the same report id instead of starting a second one", async () => {
        const [a, b] = await Promise.all([buildReport("RPT1"), buildReport("RPT1")]);
        expect(mockGetFights).toHaveBeenCalledTimes(1);
        expect(mockGetCasts).toHaveBeenCalledTimes(1);
        expect(mockSaveReport).toHaveBeenCalledTimes(1);
        expect(a.id).toBe(b.id);
        expect(a.url).toBe(b.url);
    });

    it("builds fresh again once the previous build for that report id has finished", async () => {
        await buildReport("RPT1");
        await buildReport("RPT1");
        expect(mockGetFights).toHaveBeenCalledTimes(2);
        expect(mockSaveReport).toHaveBeenCalledTimes(2);
    });

    it("does not de-dup two different report ids", async () => {
        await Promise.all([buildReport("RPT1"), buildReport("RPT2")]);
        expect(mockGetFights).toHaveBeenCalledTimes(2);
        expect(mockSaveReport).toHaveBeenCalledTimes(2);
    });

    it("clears the in-flight guard even when the build fails, so a retry is not stuck", async () => {
        mockGetFights.mockRejectedValueOnce(new Error("boom"));
        await expect(buildReport("RPT1")).rejects.toThrow(ReportError);
        mockGetFights.mockResolvedValueOnce({ title: "T", zoneName: "Z", start: 0, end: 1 });
        await expect(buildReport("RPT1")).resolves.toMatchObject({ id: expect.any(String) });
        expect(mockGetFights).toHaveBeenCalledTimes(2);
    });

    it("rejects a link without a parseable report id before touching the API", async () => {
        mockParseReportId.mockReturnValueOnce(null);
        await expect(buildReport("not-a-link")).rejects.toThrow(ReportError);
        expect(mockGetFights).not.toHaveBeenCalled();
    });

    it("keys the guard by section, so CLA and RPB of one log run side by side", async () => {
        await Promise.all([
            buildReport("RPT1", { sections: ["cla"] }),
            buildReport("RPT1", { sections: ["rpb"] }),
        ]);
        expect(mockSaveReport).toHaveBeenCalledTimes(2);
        expect(analyzeConsumables).toHaveBeenCalledTimes(1);
        expect(analyzeRpb).toHaveBeenCalledTimes(1);
    });
});

describe("logcheck/report — sections", () => {
    it("normalizeSections defaults to both halves and drops unknown values", () => {
        expect(normalizeSections()).toEqual(["cla", "rpb"]);
        expect(normalizeSections("rpb")).toEqual(["rpb"]);
        expect(normalizeSections(["rpb", "cla"])).toEqual(["cla", "rpb"]); // canonical order
        expect(normalizeSections(["nonsense"])).toEqual(["cla", "rpb"]);   // nothing valid → both
    });

    it("runs only the CLA analyzers for the cla section", async () => {
        await buildReport("RPT1", { sections: ["cla"] });
        expect(analyzeConsumables).toHaveBeenCalled();
        expect(analyzeRpb).not.toHaveBeenCalled();
    });

    it("runs only the RPB analyzer for the rpb section", async () => {
        await buildReport("RPT1", { sections: ["rpb"] });
        expect(analyzeRpb).toHaveBeenCalled();
        expect(analyzeConsumables).not.toHaveBeenCalled();
    });

    it("records which sections a report carries", async () => {
        const { report } = await buildReport("RPT1", { sections: ["rpb"] });
        expect(report.sections).toEqual(["rpb"]);
    });
});

describe("logcheck/report — merging the two halves", () => {
    it("writes into the existing report id instead of creating a second page", async () => {
        mockGetReport.mockReturnValue({ id: "old1", sections: ["cla"], consumables: { players: [1] } });
        const res = await buildReport("RPT1", { sections: ["rpb"], mergeIntoId: "old1" });
        expect(mockSaveReport).toHaveBeenCalledWith(expect.any(Object), "old1");
        expect(res.url).toContain("/r/");
    });

    it("keeps the CLA result when the RPB half is added", async () => {
        const claData = { players: [{ name: "Alice" }] };
        mockGetReport.mockReturnValue({ id: "old1", sections: ["cla"], consumables: claData, drums: { players: [] } });
        const { report } = await buildReport("RPT1", { sections: ["rpb"], mergeIntoId: "old1" });
        expect(report.consumables).toBe(claData);   // untouched by the RPB run
        expect(report.rpb).not.toBeNull();
        expect(report.sections).toEqual(expect.arrayContaining(["cla", "rpb"]));
    });

    it("keeps the RPB result when the CLA half is added", async () => {
        const rpbData = { roles: { Alice: "Caster" } };
        mockGetReport.mockReturnValue({ id: "old1", sections: ["rpb"], rpb: rpbData });
        const { report } = await buildReport("RPT1", { sections: ["cla"], mergeIntoId: "old1" });
        expect(report.rpb).toBe(rpbData);            // untouched by the CLA run
        expect(report.sections).toEqual(expect.arrayContaining(["cla", "rpb"]));
    });

    it("does not blank the roster's potion counts when the RPB half is added", async () => {
        // the regression: the Tränke tab kept its numbers while the Raider tab
        // showed nothing but zeros, because the RPB run rebuilt the roster without
        // any potion data and that roster overwrote the CLA's
        mockGetReport.mockReturnValue({
            id: "old1",
            sections: ["cla"],
            roster: [{ name: "Alice", type: "Mage", potions: { destruction: 2, haste: 0, mana: 5 } }],
            potions: { players: [{ name: "Alice", destruction: 2, haste: 0, mana: 5, total: 7 }] },
        });
        const { report } = await buildReport("RPT1", { sections: ["rpb"], mergeIntoId: "old1" });
        expect(report.roster.find((p) => p.name === "Alice").potions).toEqual({ destruction: 2, haste: 0, mana: 5 });
    });

    it("creates a new page when the id to merge into no longer exists", async () => {
        mockGetReport.mockReturnValue(null);
        await buildReport("RPT1", { sections: ["rpb"], mergeIntoId: "gone" });
        expect(mockSaveReport).toHaveBeenCalledWith(expect.any(Object), undefined);
    });

    it("merges the icon maps of both halves", async () => {
        mockGetReport.mockReturnValue({ id: "old1", sections: ["cla"], icons: { flask: "a.jpg" } });
        const { report } = await buildReport("RPT1", { sections: ["cla"], mergeIntoId: "old1" });
        expect(report.icons).toEqual(expect.objectContaining({ flask: "a.jpg" }));
    });
});

describe("logcheck/report — mergeRoster", () => {
    const withPotions = [
        { name: "Alice", type: "Mage", issues: [], potions: { destruction: 3, haste: 1, mana: 8 } },
        { name: "Bob", type: "Warrior", issues: [], potions: { destruction: 0, haste: 0, mana: 2 } },
    ];
    // what an RPB-only run builds: potions were never analyzed, so all zero
    const zeroed = [
        { name: "Alice", type: "Mage", issues: [{ x: 1 }], potions: { destruction: 0, haste: 0, mana: 0 } },
        { name: "Bob", type: "Warrior", issues: [], potions: { destruction: 0, haste: 0, mana: 0 } },
    ];

    it("keeps the CLA potion counts when only the RPB half was re-run", () => {
        const merged = mergeRoster(withPotions, zeroed, ["rpb"]);
        expect(merged[0].potions).toEqual({ destruction: 3, haste: 1, mana: 8 });
        expect(merged[1].potions).toEqual({ destruction: 0, haste: 0, mana: 2 });
    });

    it("still takes the fresh gear issues from the RPB run", () => {
        const merged = mergeRoster(withPotions, zeroed, ["rpb"]);
        expect(merged[0].issues).toEqual([{ x: 1 }]);
    });

    it("lets the CLA half overwrite the potion counts — it owns them", () => {
        const fresh = [{ name: "Alice", type: "Mage", issues: [], potions: { destruction: 9, haste: 9, mana: 9 } }];
        expect(mergeRoster(withPotions, fresh, ["cla"])[0].potions).toEqual({ destruction: 9, haste: 9, mana: 9 });
    });

    it("carries nothing over for a raider who was not in the previous roster", () => {
        const fresh = [{ name: "Newcomer", type: "Rogue", issues: [], potions: { destruction: 0, haste: 0, mana: 0 } }];
        expect(mergeRoster(withPotions, fresh, ["rpb"])[0].potions).toEqual({ destruction: 0, haste: 0, mana: 0 });
    });

    it("falls back to the existing roster when the fresh run produced none", () => {
        expect(mergeRoster(withPotions, null, ["rpb"])).toEqual(withPotions);
        expect(mergeRoster(withPotions, [], ["rpb"])).toEqual(withPotions);
        // even for the CLA half — an empty roster is a failed run, not an empty raid
        expect(mergeRoster(withPotions, [], ["cla"])).toEqual(withPotions);
    });

    it("tolerates an existing report that had no roster at all", () => {
        expect(mergeRoster(undefined, zeroed, ["rpb"])).toEqual(zeroed);
    });
});

describe("logcheck/report — stripSection", () => {
    const full = {
        title: "SSC + TK",
        players: [{ name: "A" }],
        roster: [{ name: "A" }],
        sections: ["cla", "rpb"],
        consumables: { players: [1] },
        drums: { players: [1] },
        potions: { players: [1] },
        sunder: [1],
        bossUptimes: { rows: [1] },
        shadowResi: { players: [1] },
        rpb: { roles: {} },
    };

    it("drops the RPB half and leaves the CLA data alone", () => {
        const { report, remaining } = stripSection(full, "rpb");
        expect(remaining).toEqual(["cla"]);
        expect(report.rpb).toBeNull();
        expect(report.consumables).toEqual({ players: [1] });
        expect(report.drums).toEqual({ players: [1] });
        expect(report.sections).toEqual(["cla"]);
    });

    it("drops the CLA half and leaves the RPB data alone", () => {
        const { report, remaining } = stripSection(full, "cla");
        expect(remaining).toEqual(["rpb"]);
        expect(report.rpb).toEqual({ roles: {} });
        for (const key of ["consumables", "drums", "potions", "sunder", "bossUptimes", "shadowResi"]) {
            expect(report[key]).toBeNull();
        }
    });

    it("keeps the shared meta in both cases", () => {
        for (const section of ["cla", "rpb"]) {
            const { report } = stripSection(full, section);
            expect(report.title).toBe("SSC + TK");
            expect(report.players).toEqual([{ name: "A" }]);
            expect(report.roster).toEqual([{ name: "A" }]);
        }
    });

    it("does not mutate the input", () => {
        stripSection(full, "rpb");
        expect(full.rpb).toEqual({ roles: {} });
        expect(full.sections).toEqual(["cla", "rpb"]);
    });

    it("infers the sections of an older report that has no sections field", () => {
        const legacy = { consumables: { players: [1] }, rpb: { roles: {} } };
        const { remaining } = stripSection(legacy, "rpb");
        expect(remaining).toEqual(["cla"]);
    });

    it("reports nothing remaining when the only half is dropped", () => {
        const rpbOnly = { sections: ["rpb"], rpb: { roles: {} } };
        expect(stripSection(rpbOnly, "rpb").remaining).toEqual([]);
    });
});

describe("logcheck/report — reportSummaryLines", () => {
    const report = {
        players: [{ issues: [1, 2] }],
        roster: [{}, {}],
        consumables: { players: [{}] },
        rpb: { byRole: {} },
    };

    it("covers both halves by default", () => {
        const text = reportSummaryLines(report).join("\n");
        expect(text).toContain("Gear");
        expect(text).toContain("Rollen");
    });

    it("restricted to cla, leaves the RPB lines out", () => {
        const text = reportSummaryLines(report, "cla").join("\n");
        expect(text).toContain("Gear");
        expect(text).not.toContain("Rollen");
    });

    it("restricted to rpb, leaves the CLA lines out", () => {
        const text = reportSummaryLines(report, "rpb").join("\n");
        expect(text).not.toContain("Gear");
        expect(text).toContain("Rollen");
    });

    it("always names the raider count", () => {
        expect(reportSummaryLines(report, "rpb")[0]).toContain("Raider");
    });
});

describe("logcheck/report — the unfinished-raid guard", () => {
    /** A report whose raid is still running: SSC with Vashj still up. */
    function stillRunning() {
        mockGetFights.mockResolvedValue({
            title: "SSC", zoneName: "Serpentshrine Cavern", start: 0, end: 100,
            fights: [
                { id: 1, boss: 623, name: "Hydross the Unstable", kill: true },
                { id: 2, boss: 628, name: "Lady Vashj", kill: false },
            ],
        });
    }

    it("refuses to evaluate a raid whose final boss is still up", async () => {
        stillRunning();
        await expect(buildReport("RPT1")).rejects.toThrow(IncompleteRaidError);
        expect(mockSaveReport).not.toHaveBeenCalled();
    });

    it("refuses before spending the analysis, not after", async () => {
        // The fight list is the one request the guard needs — and the one that
        // was already made. Everything else must not have been touched.
        stillRunning();
        await expect(buildReport("RPT1")).rejects.toThrow(IncompleteRaidError);
        expect(mockGetFights).toHaveBeenCalledTimes(1);
        expect(mockGetCasts).not.toHaveBeenCalled();
        expect(analyzeConsumables).not.toHaveBeenCalled();
        expect(analyzeRpb).not.toHaveBeenCalled();
    });

    it("carries the progress, so the caller can say what is missing", async () => {
        stillRunning();
        const err = await buildReport("RPT1").catch((e) => e);
        expect(err).toBeInstanceOf(IncompleteRaidError);
        expect(err.progress.pending).toEqual(["Höhle des Schlangenschreins"]);
        expect(err.message).toContain("Lady Vashj");
    });

    it("builds anyway when forced", async () => {
        stillRunning();
        await expect(buildReport("RPT1", { force: true })).resolves.toMatchObject({ id: expect.any(String) });
        expect(mockSaveReport).toHaveBeenCalledTimes(1);
    });

    it("keeps the forced build apart from the refusing one", async () => {
        // Both are in flight for the same report id and answer different
        // questions — joining them would have one return the other's result.
        stillRunning();
        const [refused, forced] = await Promise.all([
            buildReport("RPT1").catch((e) => e),
            buildReport("RPT1", { force: true }),
        ]);
        expect(refused).toBeInstanceOf(IncompleteRaidError);
        expect(forced.id).toEqual(expect.any(String));
    });

    it("records on the report that the raid was not finished", async () => {
        stillRunning();
        await buildReport("RPT1", { force: true });
        const saved = mockSaveReport.mock.calls[0][0];
        expect(saved.raidProgress.complete).toBe(false);
        expect(saved.raidProgress.pending).toEqual(["Höhle des Schlangenschreins"]);
    });

    it("lets a finished raid straight through", async () => {
        await expect(buildReport("RPT1")).resolves.toMatchObject({ id: expect.any(String) });
        expect(mockGetCasts).toHaveBeenCalled();
    });
});
