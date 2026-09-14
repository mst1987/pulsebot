// The "is this raid actually over?" rule that guards every CLA/RPB evaluation
// (src/utils/logcheck/raidProgress.js).
//
// Two failure modes matter and pull in opposite directions: letting an
// evaluation run over a raid that is still going (the numbers are half a raid
// short and change with every further pull), and blocking one that is finished
// because the raid could not be identified. The second is the worse one — an
// admin cannot argue with a guard — so anything unrecognised has to pass.
const { analyzeRaidProgress, progressSummary } = require("../../../src/utils/logcheck/raidProgress");

/** A WCL fights response with the given boss pulls. */
function report(fights, zoneName = "") {
    return {
        zoneName,
        fights: fights.map((f, i) => ({
            id: i + 1,
            boss: f.boss === 0 ? 0 : (f.boss || 100 + i),
            name: f.name,
            kill: !!f.kill,
        })),
    };
}

describe("raidProgress — a raid still running", () => {
    it("is incomplete while the final boss is not down", () => {
        const p = analyzeRaidProgress(report([
            { name: "Hydross the Unstable", kill: true },
            { name: "Leotheras the Blind", kill: true },
            { name: "Lady Vashj", kill: false },
        ]));
        expect(p.complete).toBe(false);
        expect(p.pending).toEqual(["Höhle des Schlangenschreins"]);
        expect(p.killCount).toBe(2);
        expect(p.bossCount).toBe(3);
        expect(p.lastKill).toBe("Leotheras the Blind");
        expect(p.lastPull).toBe("Lady Vashj");
    });

    it("is complete once the final boss is killed", () => {
        const p = analyzeRaidProgress(report([
            { name: "Hydross the Unstable", kill: true },
            { name: "Lady Vashj", kill: true },
        ]));
        expect(p.complete).toBe(true);
        expect(p.pending).toEqual([]);
    });

    it("does not count a wipe on the final boss as a kill", () => {
        const p = analyzeRaidProgress(report([
            { name: "Lady Vashj", kill: false },
            { name: "Lady Vashj", kill: false },
        ]));
        expect(p.complete).toBe(false);
    });

    it("reads German encounter names as the same bosses", () => {
        // WCL hands back whatever the uploading client called them.
        const p = analyzeRaidProgress(report([
            { name: "Fürstin Vashj", kill: true },
        ]));
        expect(p.complete).toBe(true);
    });
});

describe("raidProgress — several raids in one night", () => {
    it("requires the final boss of every raid the log touches", () => {
        // Gruul + Magtheridon on one evening is one log with two raids in it.
        const p = analyzeRaidProgress(report([
            { name: "High King Maulgar", kill: true },
            { name: "Gruul the Dragonkiller", kill: true },
            { name: "Magtheridon", kill: false },
        ]));
        expect(p.complete).toBe(false);
        expect(p.pending).toEqual(["Magtheridons Kammer"]);
    });

    it("is complete when both are finished", () => {
        const p = analyzeRaidProgress(report([
            { name: "Gruul the Dragonkiller", kill: true },
            { name: "Magtheridon", kill: true },
        ]));
        expect(p.complete).toBe(true);
    });
});

describe("raidProgress — Karazhan's optional last boss", () => {
    it("counts Prince Malchezaar as the end, with Nightbane skipped", () => {
        // Nightbane is optional and regularly not summoned; waiting for it would
        // block nearly every Karazhan night.
        const p = analyzeRaidProgress(report([
            { name: "Attumen the Huntsman", kill: true },
            { name: "Prince Malchezaar", kill: true },
        ]));
        expect(p.complete).toBe(true);
    });
});

describe("raidProgress — what it refuses to judge", () => {
    it("lets an unknown zone through instead of blocking on it", () => {
        // A raid this table does not know (a fresh tier, a private server's own
        // encounter) must not become unevaluatable.
        const p = analyzeRaidProgress(report([
            { name: "Some Unknown Boss", kill: false },
        ], "Neue Instanz"));
        expect(p.complete).toBe(true);
        expect(p.known).toBe(false);
    });

    it("blocks a zone it knows even when no boss was pulled at all", () => {
        // Trash-only so far is exactly the "raid just started" case.
        const p = analyzeRaidProgress(report([{ name: "Trash", boss: 0 }], "Black Temple"));
        expect(p.complete).toBe(false);
        expect(p.pending).toEqual(["Der Schwarze Tempel"]);
    });

    it("survives a report with no fights at all", () => {
        expect(analyzeRaidProgress({}).complete).toBe(true);
        expect(analyzeRaidProgress(null).complete).toBe(true);
    });
});

describe("progressSummary", () => {
    it("names the missing raid, its final boss and where the night stands", () => {
        const p = analyzeRaidProgress(report([
            { name: "Najentus", kill: true },
            { name: "Supremus", kill: true },
            { name: "Illidan Stormrage", kill: false },
        ], "Black Temple"));
        const text = progressSummary(p);
        expect(text).toContain("Der Schwarze Tempel");
        expect(text).toContain("Illidan Stormrage");
        expect(text).toContain("2 von 3");
        expect(text).toContain("Supremus");
    });

    it("says nothing about a finished raid", () => {
        const p = analyzeRaidProgress(report([{ name: "Illidan Stormrage", kill: true }]));
        expect(progressSummary(p)).toBe("");
    });
});

describe("raidProgress — the encounter grid and the list summary", () => {
    const { raidSummary, encountersFor } = require("../../../src/utils/logcheck/raidProgress");

    it("lists every encounter of a raid with what lies", () => {
        const p = analyzeRaidProgress(report([
            { name: "Rage Winterchill", kill: true },
            { name: "Anetheron", kill: true },
            { name: "Kaz'rogal", kill: true },
            { name: "Azgalor", kill: false },
        ], "Hyjal Summit"));
        expect(p.raids[0].short).toBe("Hyjal");
        expect(p.raids[0].bosses).toEqual([
            { name: "Rage Winterchill", killed: true },
            { name: "Anetheron", killed: true },
            { name: "Kaz'rogal", killed: true },
            { name: "Azgalor", killed: false },
            { name: "Archimonde", killed: false },
        ]);
        expect(raidSummary(p)).toEqual([{
            contentId: "hyjal", label: "Hyjal", killed: 3, total: 5, finalKilled: false, finalBoss: "Archimonde",
            missing: ["Azgalor", "Archimonde"], bosses: p.raids[0].bosses,
        }]);
    });

    it("counts Karazhan by its encounters: one opera, no rare spawns", () => {
        expect(encountersFor("kara")).toHaveLength(11);
        expect(encountersFor("kara")).toContain("Opera Event");
        expect(encountersFor("kara")).not.toContain("The Big Bad Wolf");
        const p = analyzeRaidProgress(report([{ name: "The Big Bad Wolf", kill: true }, { name: "Prince Malchezaar", kill: true }]));
        const [kara] = raidSummary(p);
        expect(kara).toMatchObject({ killed: 2, total: 11, finalKilled: true });
    });

    it("marks a final boss killed under its German name as down in the grid", () => {
        const p = analyzeRaidProgress(report([{ name: "Illidan Sturmgrimm", kill: true }]));
        const bt = p.raids.find((r) => r.contentId === "bt");
        expect(bt.bosses[bt.bosses.length - 1]).toEqual({ name: "Illidan Stormrage", killed: true });
    });

    it("reads a progress stored before the grid existed", () => {
        const [ssc] = raidSummary({ raids: [{ contentId: "ssc", label: "Höhle des Schlangenschreins", finalBosses: ["Lady Vashj"], done: false, killed: 4 }] });
        expect(ssc).toEqual({
            contentId: "ssc", label: "SSC", killed: 4, total: 6, finalKilled: false, finalBoss: "Lady Vashj", missing: ["Lady Vashj"], bosses: [],
        });
        expect(raidSummary(null)).toEqual([]);
    });
});
