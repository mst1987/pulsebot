// The game version of a Warcraft-Logs report (#746): which host belongs to which
// version comes from the version settings, never from a table in the code; the
// log check reads TBC only, and asks the classic v1 host for it as it always did.
const mockWclCtor = jest.fn();
jest.mock("../../../src/classes/warcraftlogs", () => jest.fn().mockImplementation((...args) => {
    mockWclCtor(...args);
    return { args };
}));

// The stored version of a raid (storedVersion.js has its own test): two raids, one per version.
jest.mock("../../../src/services/events/storedVersion", () => ({
    versionOfLog: (log) => ({ "raid-tbc": "tbc", "raid-forever": "forever" })[log && log.eventId] || "",
}));

const lv = require("../../../src/services/logcheck/logVersion");

describe("services/logcheck/logVersion — which list a log belongs to (#741)", () => {
    it("puts a log without a raid into every version, a linked one into its raid's", () => {
        const waiting = { id: "l0" };
        expect(lv.inVersionList(waiting, "tbc")).toBe(true);
        expect(lv.inVersionList(waiting, "forever")).toBe(true);
        expect(lv.inVersionList({ kind: "log", eventId: "" }, "forever")).toBe(true);
        // the raid's stored version wins over the version stamped on the log
        const linked = { eventId: "raid-forever", versionId: "tbc" };
        expect(lv.inVersionList(linked, "forever")).toBe(true);
        expect(lv.inVersionList(linked, "tbc")).toBe(false);
        // a raid nobody stored any more: the version stamped when it was linked
        expect(lv.inVersionList({ eventId: "gone", versionId: "forever" }, "forever")).toBe(true);
        expect(lv.inVersionList({ eventId: "gone" }, "forever")).toBe(false);
    });

    it("puts a report without a log into its own version; no version lets everything through", () => {
        expect(lv.inVersionList({ kind: "report", eventId: "", versionId: "forever" }, "forever")).toBe(true);
        expect(lv.inVersionList({ kind: "report", eventId: "", versionId: "forever" }, "tbc")).toBe(false);
        // a report from before #746 is TBC
        expect(lv.inVersionList({ kind: "report", eventId: "" }, "tbc")).toBe(true);
        expect(lv.inVersionList({ kind: "report", versionId: "forever" }, "")).toBe(true);
    });
});

const template = (sub) => `https://${sub}.warcraftlogs.com/character/{region}/{realm}/{char}`;
// fresh = TBC, vanilla = Classic, a made-up Forever site: what Einstellungen → Spielversion could hold
const config = {
    versionSettings: {
        tbc: { wclUrlTemplate: template("fresh"), wowheadPath: "tbc" },
        classic: { wclUrlTemplate: template("vanilla"), wowheadPath: "classic" },
        forever: { wclUrlTemplate: template("forever"), wowheadPath: "forever" },
    },
    categoryVersion: { catF: "forever" },
};

beforeEach(() => mockWclCtor.mockClear());

describe("services/logcheck/logVersion — the list a log without a raid is in", () => {
    const unlinked = (extra) => ({ kind: "log", eventId: "", hostVersionId: "", ...extra });

    it("lists a log of SSC, TK and Gruul under TBC only — read from Warcraft Logs or from its title", () => {
        const read = unlinked({ raids: [{ contentId: "tk" }, { contentId: "gruul" }, { contentId: "ssc" }] });
        expect(lv.listedVersions(read, { config })).toEqual(["tbc"]);
        expect(lv.inVersionList(read, "tbc", { config })).toBe(true);
        expect(lv.inVersionList(read, "forever", { config })).toBe(false);
        const titled = unlinked({ title: "SSC + TK 23er Raid" });
        expect(lv.inVersionList(titled, "tbc", { config })).toBe(true);
        expect(lv.inVersionList(titled, "forever", { config })).toBe(false);
    });

    it("takes the host's version first", () => {
        const forever = unlinked({ hostVersionId: "forever", raids: [{ contentId: "hyjal" }] });
        expect(lv.listedVersions(forever, { config })).toEqual(["forever"]);
        expect(lv.inVersionList(forever, "tbc", { config })).toBe(false);
    });

    it("lets a pinned category decide between the versions a raid allows, never against the raid", () => {
        const hyjal = unlinked({ raids: [{ contentId: "hyjal" }] });
        expect(lv.listedVersions(hyjal, { config })).toEqual(["tbc", "forever"]);
        expect(lv.listedVersions({ ...hyjal, categoryId: "catF" }, { config })).toEqual(["forever"]);
        // an SSC log stays TBC's, whatever channel it was posted in
        expect(lv.listedVersions(unlinked({ raids: [{ contentId: "ssc" }], categoryId: "catF" }), { config })).toEqual(["tbc"]);
        // a category that is not pinned (it plays the main version) tells nothing
        expect(lv.listedVersions({ ...hyjal, categoryId: "catT" }, { config })).toEqual(["tbc", "forever"]);
        expect(lv.listedVersions(unlinked({ categoryId: "catF" }), { config })).toEqual(["forever"]);
    });

    it("keeps a log nothing tells about in every version", () => {
        for (const log of [unlinked({}), unlinked({ title: "Mittwoch" }), unlinked({ raids: [{ contentId: "ssc" }, { contentId: "mc" }] })]) {
            expect(lv.listedVersions(log, { config })).toEqual([]);
            expect(lv.inVersionList(log, "tbc", { config })).toBe(true);
            expect(lv.inVersionList(log, "forever", { config })).toBe(true);
        }
    });
});

describe("services/logcheck/logVersion — host to version", () => {
    it("finds the version whose Warcraft-Logs site is the host", () => {
        expect(lv.versionOfHost("fresh.warcraftlogs.com", { config })).toBe("tbc");
        expect(lv.versionOfHost("vanilla.warcraftlogs.com", { config })).toBe("classic");
        expect(lv.versionOfHost("FOREVER.warcraftlogs.com", { config })).toBe("forever");
    });

    it("knows no version for a host no version names, or for no host", () => {
        expect(lv.versionOfHost("classic.warcraftlogs.com", { config })).toBe("");
        expect(lv.versionOfHost("www.warcraftlogs.com", { config })).toBe("");
        expect(lv.versionOfHost("", { config })).toBe("");
    });

    it("knows no version for a host two versions share", () => {
        const shared = { versionSettings: { ...config.versionSettings, forever: { wclUrlTemplate: template("fresh") } } };
        expect(lv.versionOfHost("fresh.warcraftlogs.com", { config: shared })).toBe("");
    });

    it("reads host, id and the host's version from a link", () => {
        expect(lv.linkVersion("https://vanilla.warcraftlogs.com/reports/AbC12#fight=2", { config }))
            .toEqual({ host: "vanilla.warcraftlogs.com", reportId: "AbC12", hostVersionId: "classic" });
        expect(lv.linkVersion("AbC12", { config })).toEqual({ host: "", reportId: "AbC12", hostVersionId: "" });
    });
});

describe("services/logcheck/logVersion — the version of a report", () => {
    it("takes the linked raid's version first", () => {
        expect(lv.resolveReportVersion({ event: { versionId: "forever" }, versionId: "tbc", host: "fresh.warcraftlogs.com", config }))
            .toEqual({ versionId: "forever", from: "event" });
        // a Raid-Helper raid without its own version plays its category's
        expect(lv.resolveReportVersion({ event: { categoryId: "catF" }, config })).toEqual({ versionId: "forever", from: "event" });
    });

    it("then a tracked log's stored version, then the host, then TBC", () => {
        expect(lv.resolveReportVersion({ versionId: "classic", host: "fresh.warcraftlogs.com", config })).toEqual({ versionId: "classic", from: "log" });
        expect(lv.resolveReportVersion({ host: "forever.warcraftlogs.com", config })).toEqual({ versionId: "forever", from: "host" });
        expect(lv.resolveReportVersion({ host: "classic.warcraftlogs.com", config })).toEqual({ versionId: "tbc", from: "default" });
        expect(lv.resolveReportVersion({ versionId: "nope", config })).toEqual({ versionId: "tbc", from: "default" });
    });

    it("counts a stored log or report without a version as TBC", () => {
        expect(lv.recordVersion({})).toBe("tbc");
        expect(lv.recordVersion(null)).toBe("tbc");
        expect(lv.recordVersion({ versionId: "forever" })).toBe("forever");
        expect(lv.recordVersion({ versionId: "nope" })).toBe("tbc");
    });

    it("knows a log's version from its stored host version, an old log's from its link", () => {
        expect(lv.knownLogVersion({ hostVersionId: "forever", link: "https://fresh.warcraftlogs.com/reports/A" }, { config })).toBe("forever");
        expect(lv.knownLogVersion({ hostVersionId: "", link: "https://fresh.warcraftlogs.com/reports/A" }, { config })).toBe("");
        expect(lv.knownLogVersion({ link: "https://fresh.warcraftlogs.com/reports/A" }, { config })).toBe("tbc");
        expect(lv.knownLogVersion({ wclUrl: "https://classic.warcraftlogs.com/reports/A" }, { config })).toBe("");
    });

    it("names the version of a log channel's category, nothing without a category", () => {
        expect(lv.categoryVersion({ categoryId: "catF" }, { config })).toBe("forever");
        expect(lv.categoryVersion({ categoryId: "catT" }, { config })).toBe("tbc");
        expect(lv.categoryVersion({}, { config })).toBe("");
    });
});

describe("services/logcheck/logVersion — what the log check reads", () => {
    it("evaluates TBC only until the other versions have their rules (#747)", () => {
        expect(lv.logcheckSupported("tbc")).toBe(true);
        expect(lv.logcheckSupported("forever")).toBe(false);
        expect(lv.logcheckSupported("classic")).toBe(false);
        expect(lv.logcheckSupported("")).toBe(false);
    });

    it("keeps Forever refused even with a Warcraft-Logs site set: its rules are not ready", () => {
        expect(lv.logcheckSupported("forever", { config })).toBe(false);
    });

    describe("logcheckCapability — the hook of the per-version feature matrix (#761)", () => {
        it("says TBC is possible", () => {
            expect(lv.logcheckCapability("tbc")).toEqual({ possible: true, reason: "", message: "", missing: [] });
        });

        it("names why Forever is not: rules not ready, with what they lack", () => {
            const cap = lv.logcheckCapability("forever", { config });
            expect(cap).toMatchObject({ possible: false, reason: "rules_not_ready", message: "Die Logcheck-Regeln für WoW Forever sind noch nicht fertig." });
            expect(cap.missing.length).toBeGreaterThan(0);
        });

        it("names a version without rules and an unknown one", () => {
            expect(lv.logcheckCapability("classic", { config })).toMatchObject({ possible: false, reason: "no_rules", message: "Für Classic Era gibt es keine Logcheck-Regeln." });
            expect(lv.logcheckCapability("nope")).toMatchObject({ possible: false, reason: "unknown_version" });
            expect(lv.logcheckCapability("")).toMatchObject({ possible: false, reason: "unknown_version" });
        });

        it("a ready rule set still needs a Warcraft-Logs site: supported = rules ready AND site known", () => {
            jest.isolateModules(() => {
                jest.doMock("../../../src/utils/logcheck/rules", () => {
                    const actual = jest.requireActual("../../../src/utils/logcheck/rules");
                    const readyForever = actual.makeRuleSet({
                        versionId: "forever", classDefs: actual.logcheckRules("forever").classDefs, analyzers: actual.analyzersFor("forever"), ready: true,
                    });
                    return { ...actual, logcheckRules: (v) => (v === "forever" ? readyForever : actual.logcheckRules(v)) };
                });
                const fresh = require("../../../src/services/logcheck/logVersion");
                expect(fresh.logcheckCapability("forever", { config: {} })).toMatchObject({ possible: false, reason: "no_site", message: "Für WoW Forever ist keine Warcraft-Logs-Seite eingetragen." });
                expect(fresh.logcheckSupported("forever", { config: {} })).toBe(false);
                expect(fresh.logcheckCapability("forever", { config })).toEqual({ possible: true, reason: "", message: "", missing: [] });
                expect(fresh.logcheckSupported("forever", { config })).toBe(true);
            });
        });
    });

    it("asks the classic v1 host for TBC, unchanged; another version its settings' site", () => {
        expect(lv.wclApiSite("tbc", { config })).toBe("https://classic.warcraftlogs.com");
        expect(lv.wclApiSite("classic", { config })).toBe("https://vanilla.warcraftlogs.com");
        expect(lv.wclApiSite("forever", { config: {} })).toBe("");
        expect(lv.wclApiSite("nope", { config })).toBe("");
    });

    it("builds a client on the version's site, none for a version without one", () => {
        expect(lv.wclClientFor("tbc", { config, apiKey: "k" })).toEqual({ args: ["k", { site: "https://classic.warcraftlogs.com" }] });
        expect(lv.wclClientFor("forever", { config: {} })).toBeNull();
        expect(mockWclCtor).toHaveBeenCalledTimes(1);
    });

    it("links a report where it was posted, else on its version's site", () => {
        expect(lv.reportLink({ host: "vanilla.warcraftlogs.com", reportId: "A1", versionId: "tbc" }, { config }))
            .toBe("https://vanilla.warcraftlogs.com/reports/A1");
        expect(lv.reportLink({ reportId: "A1", versionId: "forever" }, { config })).toBe("https://forever.warcraftlogs.com/reports/A1");
        expect(lv.reportLink({ reportId: "A1" }, { config })).toBe("https://fresh.warcraftlogs.com/reports/A1");
        expect(lv.reportLink({ host: "evil.example.com", reportId: "A1" }, { config })).toBe("https://fresh.warcraftlogs.com/reports/A1");
        expect(lv.reportLink({ reportId: "A1", versionId: "forever" }, { config: {} })).toBe("");
        expect(lv.reportLink({ reportId: "../x" }, { config })).toBe("");
    });

    it("refuses to link a log to a raid of another version, not one of unknown version", () => {
        const freshLog = { hostVersionId: "tbc" };
        expect(lv.linkConflict(freshLog, { versionId: "forever" }, { config }))
            .toBe("Dieses Log ist von TBC Anniversary, der Raid von WoW Forever. Ein Log gehört nur zu einem Raid seiner Version.");
        expect(lv.linkConflict(freshLog, { versionId: "tbc" }, { config })).toBe("");
        expect(lv.linkConflict({ hostVersionId: "" }, { versionId: "forever" }, { config })).toBe("");
        expect(lv.linkConflict(freshLog, {}, { config })).toBe("");
    });

    it("refuses to link a log of a TBC-only raid to a Forever raid, also without a host", () => {
        const ssc = { title: "SSC + TK", raids: [{ contentId: "ssc" }, { contentId: "tk" }] };
        expect(lv.linkConflict(ssc, { versionId: "forever" }, { config }))
            .toBe("Dieses Log ist von TBC Anniversary, der Raid von WoW Forever. Ein Log gehört nur zu einem Raid seiner Version.");
        expect(lv.linkConflict(ssc, { versionId: "tbc" }, { config })).toBe("");
        // Hyjal is TBC's and Forever's: both raids are fine, a Classic one is not
        const hyjal = { raids: [{ contentId: "hyjal" }] };
        expect(lv.linkConflict(hyjal, { versionId: "forever" }, { config })).toBe("");
        expect(lv.linkConflict(hyjal, { versionId: "classic" }, { config }))
            .toBe("Dieses Log ist von TBC Anniversary oder WoW Forever, der Raid von Classic Era. Ein Log gehört nur zu einem Raid seiner Version.");
    });

    it("words the refusal for orga in German", () => {
        expect(lv.unsupportedMessage("forever")).toBe("Logs von WoW Forever werden noch nicht ausgewertet.");
    });
});
