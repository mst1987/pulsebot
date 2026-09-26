const { json, routerClient } = require("../../helpers/http");

jest.mock("../../../src/web/auth", () => ({
    getUser: jest.fn(),
    // "Ansicht als Rolle": the caller's own rights, and starting/stopping the view
    getRealUser: jest.fn(),
    setViewAs: jest.fn(() => true),
    csrfToken: jest.fn(),
    checkCsrf: jest.fn(),
    setActiveGuild: jest.fn(),
}));
jest.mock("../../../src/web/reportStore", () => ({
    listReports: jest.fn(() => []),
    deleteReport: jest.fn(() => true),
    getReport: jest.fn(() => null),
    saveReport: jest.fn((report, id) => id || "new-id"),
}));
jest.mock("../../../src/web/settingsStore", () => ({
    getConfig: jest.fn(() => ({})),
    saveConfig: jest.fn((partial) => ({ ...partial })),
    listRecruitment: jest.fn(() => []),
    getRecruitment: jest.fn(),
    saveRecruitment: jest.fn(),
    deleteRecruitment: jest.fn(),
    listRecruitmentPosts: jest.fn(() => []),
    getRecruitmentPost: jest.fn(),
    saveRecruitmentPost: jest.fn(),
    deleteRecruitmentPost: jest.fn(),
    listRaidsheets: jest.fn(() => []),
    saveRaidsheet: jest.fn(),
    deleteRaidsheet: jest.fn(),
    listRaidTemplates: jest.fn(() => []),
    getRaidTemplate: jest.fn(),
    saveRaidTemplate: jest.fn(),
    saveRaidTemplates: jest.fn(),
    deleteRaidTemplate: jest.fn(),
    listNotify: jest.fn(() => []),
    getNotify: jest.fn(),
    saveNotify: jest.fn(),
    deleteNotify: jest.fn(),
    getRaidsheet: jest.fn(),
    // Default: no category sheet configured, so a raid links only its own copy.
    resolveEventSheetLink: jest.fn((eventSheet) => (eventSheet && eventSheet.url
        ? { url: eventSheet.url, name: eventSheet.sheetName || "", source: "event" }
        : null)),
}));
jest.mock("../../../src/web/activeGuild", () => ({ activeGuildFor: jest.fn(() => "") }));
jest.mock("../../../src/web/raidEventStore", () => ({
    getRaidEvent: jest.fn(() => null),
    listRaidEvents: jest.fn(() => []),
    saveRaidEvents: jest.fn(),
}));
jest.mock("../../../src/web/logStore", () => ({
    listLogs: jest.fn(() => []),
    listLogsForEvent: jest.fn(() => []),
    deleteLog: jest.fn(),
    getLog: jest.fn(),
    getByReportRefId: jest.fn(),
    linkEvent: jest.fn(),
    unlinkEvent: jest.fn(),
    clearEvaluation: jest.fn(),
    clearSection: jest.fn(),
    // mirrors the real implementation (explicit sections win, legacy done = cla)
    evaluatedSections: jest.fn((log) => {
        if (!log) return [];
        if (Array.isArray(log.sections) && log.sections.length) return log.sections;
        return log.status === "done" ? ["cla"] : [];
    }),
}));
jest.mock("../../../src/web/reportList", () => ({
    prepareReportList: jest.fn((reports, query) => ({
        items: reports, sort: (query && query.sort) || "date", dir: (query && query.dir) || "desc", page: 1, totalPages: 1, total: reports.length, pageSize: 15,
    })),
    prepareLogList: jest.fn((logs, query) => ({
        items: logs, sort: (query && query.sort) || "date", dir: (query && query.dir) || "desc", page: 1, totalPages: 1, total: logs.length, pageSize: 15,
    })),
    annotateLogCategories: jest.fn((items) => items),
    annotateReportEvents: jest.fn((reports) => reports),
    logPostedAt: jest.fn((l) => (l && l.postedAt) || 0),
    // the Log-Auswertung list is pure; the route tests run the real one
    prepareClaList: jest.fn((...args) => jest.requireActual("../../../src/web/reportList").prepareClaList(...args)),
    claRowFromLog: jest.fn((...args) => jest.requireActual("../../../src/web/reportList").claRowFromLog(...args)),
}));
jest.mock("../../../src/web/logEventMatch", () => ({
    annotateMatches: jest.fn((items) => items),
    autoMatches: jest.fn(() => []),
}));
jest.mock("../../../src/web/logChannel", () => ({
    evaluateLog: jest.fn(),
    scanLogChannels: jest.fn(),
    backfillLogTitles: jest.fn(() => Promise.resolve(0)),
}));
jest.mock("../../../src/web/manualLog", () => ({ linkLogByUrl: jest.fn() }));
jest.mock("../../../src/utils/logcheck/report", () => {
    class ReportError extends Error {}
    const CLA_FIELDS = ["consumables", "shadowResi", "drums", "potions", "sunder", "bossUptimes"];
    return {
        buildReport: jest.fn(),
        ReportError,
        // mirrors the real implementation closely enough for the route tests
        stripSection: jest.fn((report, section) => {
            const stripped = { ...report };
            for (const key of section === "rpb" ? ["rpb"] : CLA_FIELDS) stripped[key] = null;
            const remaining = (report.sections || []).filter((s) => s !== section);
            stripped.sections = remaining;
            return { report: stripped, remaining };
        }),
    };
});
jest.mock("../../../src/classes/warcraftlogs", () => jest.fn());
jest.mock("../../../src/web/characterStore", () => ({
    getCharacter: jest.fn(() => null),
    listCharacters: jest.fn(() => []),
    characterMap: jest.fn(() => ({})),
}));
jest.mock("../../../src/web/raiderCharactersStore", () => ({
    getCategoryAssignments: jest.fn(() => ({})),
    listAllAssignments: jest.fn(() => ({})),
    setCategoryAssignments: jest.fn(),
    resolveAssignmentProfiles: jest.fn(() => ({})),
}));
jest.mock("../../../src/utils/lootImport", () => {
    class LootParseError extends Error {}
    const actual = jest.requireActual("../../../src/utils/lootImport");
    return {
        parseLoot: jest.fn(() => []),
        detectImportDate: jest.fn(() => null),
        enrichItemNames: jest.fn((items) => Promise.resolve(items)),
        // Pure normalisation, no I/O: the roster keys its rows with
        // characterKey, and buildManualItem's shape (dedup key included) is what
        // the loot-add endpoint is tested for — a stub would test the stub.
        characterKey: actual.characterKey,
        characterKeyOf: actual.characterKeyOf,
        splitPlayer: actual.splitPlayer,
        buildManualItem: actual.buildManualItem,
        LootParseError,
    };
});
jest.mock("../../../src/web/discord", () => require("../../helpers/discordMock").withClientHelpers({
    listGuilds: jest.fn(() => []),
    listCategories: jest.fn(() => []),
    listAllChannels: jest.fn(() => []),
    listTextChannels: jest.fn(() => []),
    listRoles: jest.fn(() => []),
    createChannel: jest.fn(),
    duplicateChannel: jest.fn(),
    listEmojis: jest.fn(() => []),
    postRecruitment: jest.fn(),
    editRecruitment: jest.fn(),
    scanRecruitment: jest.fn(() => Promise.resolve([])),
    listApplications: jest.fn(() => Promise.resolve({ applications: [], error: null })),
    getClient: jest.fn(() => null),
    getGuild: jest.fn(() => null),
    getChannelCategoryMap: jest.fn(() => ({})),
    listMembersWithRoles: jest.fn(() => Promise.resolve({ members: [], error: null })),
    resolveUserNames: jest.fn(() => Promise.resolve({})),
    postAnnouncement: jest.fn(),
    postMissingPing: jest.fn(),
    postLink: jest.fn(),
    editLink: jest.fn(),
}));
jest.mock("../../../src/web/raidEventGroups", () => ({
    loadEventGroups: jest.fn(() => Promise.resolve({ groups: [], error: null })),
    eventLookbackSince: jest.fn(() => 0),
    fetchEventsCached: jest.fn(() => Promise.resolve({ events: [] })),
}));
const mockGetTemplates = jest.fn(() => Promise.resolve([]));
const mockCreateEvent = jest.fn(() => Promise.resolve({ id: "ev1" }));
const mockGetPastEvents = jest.fn(() => Promise.resolve([]));
// The clone asks Raid-Helper for the one event it needs, by id.
const mockGetEvent = jest.fn(() => Promise.resolve(null));
const mockGetSetup = jest.fn(() => Promise.resolve({ setup: [] }));
jest.mock("../../../src/classes/raidhelper", () =>
    jest.fn().mockImplementation(() => ({
        getTemplates: mockGetTemplates,
        createEvent: mockCreateEvent,
        getPastEvents: mockGetPastEvents,
        getEvent: mockGetEvent,
        getSetup: mockGetSetup,
    })));
jest.mock("../../../src/utils/wowhead", () => {
    const actual = jest.requireActual("../../../src/utils/wowhead");
    return {
        searchItems: jest.fn(() => Promise.resolve([])),
        // Pure URL builders, no network: the loot catalogue's icon and Wowhead
        // links are exactly these strings, and stubbing them tests nothing.
        iconUrl: actual.iconUrl,
        itemLink: actual.itemLink,
    };
});
const auth = require("../../../src/web/auth");
const reportStore = require("../../../src/web/reportStore");
const settingsStore = require("../../../src/web/settingsStore");
const { activeGuildFor } = require("../../../src/web/activeGuild");
const discord = require("../../../src/web/discord");
const logStore = require("../../../src/web/logStore");
const reportList = require("../../../src/web/reportList");
const logEventMatch = require("../../../src/web/logEventMatch");
const logChannel = require("../../../src/web/logChannel");
const evalJobs = require("../../../src/web/evalJobs");
// Background jobs settle a microtask after they are queued.
const flushJobs = () => new Promise((r) => setImmediate(r));
const manualLog = require("../../../src/web/manualLog");
const { buildReport, ReportError } = require("../../../src/utils/logcheck/report");
const { post, get } = routerClient(require("../../../src/web/apiRoutes/cla"));

describe("web/apiRoutes/cla", () => {
    describe("GET /api/cla", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            activeGuildFor.mockReturnValue("");
            logStore.listLogs.mockReturnValue([]);
            reportStore.listReports.mockReturnValue([]);
            settingsStore.getConfig.mockReturnValue({});
            discord.getChannelCategoryMap.mockReturnValue({});
            mockGetPastEvents.mockResolvedValue([]);
        });

        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await get("/api/cla");
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });

        it("lists the guild's logs and the link reports in one page, with a count per filter", async () => {
            activeGuildFor.mockReturnValue("guild-1");
            logStore.listLogs.mockReturnValue([
                { id: "l1", guildId: "guild-1", eventId: "e1", sections: ["cla"], reportRefId: "r1", postedAt: 3000 },
                { id: "l2", guildId: "guild-2", reportRefId: "r2", postedAt: 2000 },
                { id: "l3", guildId: "", postedAt: 1000 },
            ]);
            reportStore.listReports.mockReturnValue([
                { id: "r1", playerCount: 25, issueCount: 3, generatedAt: 5 },
                { id: "r2" }, // its log lives in another guild — not a link report
                { id: "r3", title: "Kara per Link", generatedAt: 500 },
            ]);

            const res = await get("/api/cla");
            const data = json(res).data;

            expect(data.filter).toBe("all");
            expect(data.page.items.map((r) => r.id)).toEqual(["l1", "l3", "report:r3"]);
            expect(data.page.items[0].report).toMatchObject({ id: "r1", url: "/r/r1", playerCount: 25, issueCount: 3 });
            expect(data.page.items[2]).toMatchObject({ kind: "report", source: "link", title: "Kara per Link" });
            expect(data.counts).toEqual({ all: 3, open: 1, unlinked: 1, done: 2 });
            expect(data.matchEventsError).toBeNull();
            expect(data.activeGuildId).toBe("guild-1");
        });

        it("passes filter/sort/dir/page through to prepareClaList", async () => {
            await get("/api/cla", { filter: "unlinked", sort: "event", dir: "asc", page: "2" });
            expect(reportList.prepareClaList).toHaveBeenCalledWith(
                [], [], { filter: "unlinked", sort: "event", dir: "asc", page: "2" }, { allLogs: [] },
            );
        });

        it("reads title and bosses of the page's logs from WCL, and only of those", async () => {
            logStore.listLogs.mockReturnValue([{ id: "l1", reportId: "AAA" }]);
            logChannel.backfillLogTitles.mockImplementationOnce(async (logs) => {
                logs[0].title = "Hyjal";
                logs[0].raids = [{ contentId: "hyjal", label: "Hyjal", killed: 3, total: 5, finalKilled: false, finalBoss: "Archimonde", missing: ["Azgalor", "Archimonde"], bosses: [] }];
                return 1;
            });

            const res = await get("/api/cla");

            expect(logChannel.backfillLogTitles).toHaveBeenCalledWith([expect.objectContaining({ id: "l1" })]);
            expect(json(res).data.page.items[0]).toMatchObject({ title: "Hyjal", raids: [expect.objectContaining({ killed: 3, total: 5 })] });
        });

        it("offers candidates for assigned logs too, and counts what auto-assign would link", async () => {
            logStore.listLogs.mockReturnValue([{ id: "l1", eventId: "e9" }, { id: "l2" }]);
            logEventMatch.annotateMatches.mockImplementationOnce((items) => {
                for (const it of items) {
                    it.candidates = [{ eventId: "e1", title: "Hyjal + BT", startTime: 1, diffMs: 0, sameCategory: true }];
                    it.matchAmbiguous = false;
                }
                return items;
            });
            logEventMatch.autoMatches.mockReturnValueOnce([{ log: { id: "l2" }, event: { id: "e1" } }]);

            const res = await get("/api/cla");
            const items = json(res).data.page.items;

            // annotateMatches skips linked logs, so the route hands them over without their event
            expect(logEventMatch.annotateMatches.mock.calls[0][0].every((it) => it.eventId === "")).toBe(true);
            expect(items.find((r) => r.id === "l1").eventId).toBe("e9");
            expect(items.find((r) => r.id === "l1").candidates[0]).toMatchObject({ eventId: "e1", contentId: "hyjal" });
            expect(json(res).data.autoMatchCount).toBe(1);
            expect(logEventMatch.autoMatches.mock.calls[0][0].map((l) => l.id)).toEqual(["l2"]);
        });

        it("logChannelsConfigured is false when no log channels are configured", async () => {
            settingsStore.getConfig.mockReturnValue({ logChannelIds: [] });
            const res = await get("/api/cla");
            expect(json(res).data.logChannelsConfigured).toBe(false);
        });

        it("logChannelsConfigured is true when at least one log channel is configured", async () => {
            settingsStore.getConfig.mockReturnValue({ logChannelIds: ["c1"] });
            const res = await get("/api/cla");
            expect(json(res).data.logChannelsConfigured).toBe(true);
        });

        it("annotates categories and matches against the guild's events", async () => {
            activeGuildFor.mockReturnValue("guild-1");
            logStore.listLogs.mockReturnValue([{ id: "l1", guildId: "guild-1", channelId: "c1" }]);
            discord.getChannelCategoryMap.mockReturnValue({ c1: { name: "log-chan", categoryId: "cat1", categoryName: "Raids" } });
            mockGetPastEvents.mockResolvedValue([{ id: "e1", title: "Kara", startTime: 100, channelId: "c1" }]);

            await get("/api/cla");

            expect(reportList.annotateLogCategories).toHaveBeenCalledWith(
                expect.any(Array),
                { c1: { name: "log-chan", categoryId: "cat1", categoryName: "Raids" } },
            );
            expect(logEventMatch.annotateMatches).toHaveBeenCalledWith(
                expect.any(Array),
                [{ id: "e1", source: "raidhelper", title: "Kara", startTime: 100, channelId: "c1", channelName: "log-chan", categoryId: "cat1", categoryName: "Raids" }],
            );
        });

        it("surfaces the Raid-Helper error as matchEventsError and offers no auto-assign", async () => {
            activeGuildFor.mockReturnValue("guild-1");
            mockGetPastEvents.mockRejectedValue(new Error("API down"));

            const res = await get("/api/cla");

            expect(json(res).data.matchEventsError).toBe("API down");
            expect(json(res).data.autoMatchCount).toBe(0);
        });
    });

    // Building a report from a pasted link is the full CLA analysis, so it runs
    // in the background exactly like a log evaluation: POST queues it and answers
    // with a job id, the outcome is collected from report-status.
    describe("POST /api/cla", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            evalJobs.reset();
        });

        it("answers 202 with a job id without waiting for the build", async () => {
            buildReport.mockReturnValue(new Promise(() => {}));

            const res = await post("/api/cla", { link: "https://classic.warcraftlogs.com/reports/abc123" });

            expect(res.writeHead).toHaveBeenCalledWith(202, expect.any(Object));
            expect(json(res).data.status).toBe("running");
            expect(json(res).data.jobId).toEqual(expect.any(String));
            await flushJobs();
            expect(buildReport).toHaveBeenCalledWith("https://classic.warcraftlogs.com/reports/abc123", { force: false });
        });

        it("passes the halves the form picked on to the build, and ignores unknown ones", async () => {
            buildReport.mockReturnValue(new Promise(() => {}));
            await post("/api/cla", { link: "https://classic.warcraftlogs.com/reports/abc123", sections: ["rpb", "nope"] });
            await flushJobs();
            expect(buildReport).toHaveBeenCalledWith("https://classic.warcraftlogs.com/reports/abc123", { force: false, sections: ["rpb"] });
            buildReport.mockClear();
            await post("/api/cla", { link: "https://classic.warcraftlogs.com/reports/abc123", sections: ["nope"] });
            await flushJobs();
            expect(buildReport).toHaveBeenCalledWith("https://classic.warcraftlogs.com/reports/abc123", { force: false });
        });

        it("rejects an empty link outright instead of queueing a doomed job", async () => {
            const res = await post("/api/cla", { link: "  " });

            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res).error.code).toBe("build_failed");
            expect(buildReport).not.toHaveBeenCalled();
        });

        it("reports the finished report's id/url through report-status", async () => {
            buildReport.mockResolvedValue({ id: "abc123", url: "/r/abc123", report: {} });

            const started = await post("/api/cla", { link: "https://x/reports/abc123" });
            await flushJobs();
            const res = await get("/api/cla/report-status", { jobId: json(started).data.jobId });

            expect(json(res).data).toMatchObject({ status: "done", id: "abc123", url: "/r/abc123" });
        });

        it("reports a ReportError as the job's error message", async () => {
            buildReport.mockRejectedValue(new ReportError("Konnte keine Report-ID aus dem Link lesen."));

            const started = await post("/api/cla", { link: "not-a-link" });
            await flushJobs();
            const res = await get("/api/cla/report-status", { jobId: json(started).data.jobId });

            expect(json(res).data).toMatchObject({
                status: "error", error: "Konnte keine Report-ID aus dem Link lesen.",
            });
        });

        it("reports a generic message for an unexpected failure", async () => {
            jest.spyOn(console, "error").mockImplementation(() => {});
            buildReport.mockRejectedValue(new Error("boom"));

            const started = await post("/api/cla", { link: "https://x" });
            await flushJobs();
            const res = await get("/api/cla/report-status", { jobId: json(started).data.jobId });

            expect(json(res).data).toMatchObject({
                status: "error", error: "Unerwarteter Fehler beim Erstellen der Auswertung.",
            });
        });

        it("hands an unfinished raid back with its bosses, for the question dialog", async () => {
            const err = new ReportError("Der Raid sieht noch nicht abgeschlossen aus.");
            err.incomplete = true;
            err.progress = {
                raids: [{
                    contentId: "hyjal", short: "Hyjal", done: false, finalBosses: ["Archimonde"],
                    bosses: [{ name: "Rage Winterchill", killed: true }, { name: "Archimonde", killed: false }],
                }],
            };
            buildReport.mockRejectedValue(err);

            const started = await post("/api/cla", { link: "https://x/reports/abc" });
            await flushJobs();
            const res = await get("/api/cla/report-status", { jobId: json(started).data.jobId });

            expect(json(res).data).toMatchObject({ status: "error", incomplete: true });
            expect(json(res).data.raids).toEqual([expect.objectContaining({
                contentId: "hyjal", label: "Hyjal", killed: 1, total: 2, finalKilled: false, missing: ["Archimonde"],
            })]);
        });

        it("answers unknown for a job id nobody started", async () => {
            const res = await get("/api/cla/report-status", { jobId: "nope" });
            expect(json(res).data).toEqual({ status: "unknown" });
        });
    });

    describe("POST /api/cla/report-delete", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            logStore.getByReportRefId.mockReturnValue(null);
            reportStore.deleteReport.mockReturnValue(true);
        });

        it("returns 401 for an anonymous caller", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await post("/api/cla/report-delete", { reportId: "abc" });
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
            expect(reportStore.deleteReport).not.toHaveBeenCalled();
        });

        it("deletes the report and resets the log it was generated from", async () => {
            logStore.getByReportRefId.mockReturnValue({ id: "l1", reportRefId: "abc" });

            const res = await post("/api/cla/report-delete", { reportId: "abc" });

            expect(logStore.getByReportRefId).toHaveBeenCalledWith("abc");
            expect(reportStore.deleteReport).toHaveBeenCalledWith("abc");
            expect(logStore.clearEvaluation).toHaveBeenCalledWith("l1");
            expect(json(res).data).toMatchObject({ reportId: "abc", logId: "l1" });
            expect(json(res).data.message).toMatch(/offen/);
        });

        it("deletes a report that has no tracked log without touching the log store", async () => {
            const res = await post("/api/cla/report-delete", { reportId: "abc" });

            expect(reportStore.deleteReport).toHaveBeenCalledWith("abc");
            expect(logStore.clearEvaluation).not.toHaveBeenCalled();
            expect(json(res).data).toEqual({ reportId: "abc", logId: "", message: "Auswertung gelöscht." });
        });

        it("returns 400 when neither a report file nor a log exists for the id", async () => {
            reportStore.deleteReport.mockReturnValue(false);

            const res = await post("/api/cla/report-delete", { reportId: "nope" });

            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "not_found", message: "Auswertung nicht gefunden." } });
            expect(logStore.clearEvaluation).not.toHaveBeenCalled();
        });

        it("still resets the log when the report file was already gone", async () => {
            reportStore.deleteReport.mockReturnValue(false);
            logStore.getByReportRefId.mockReturnValue({ id: "l1", reportRefId: "abc" });

            const res = await post("/api/cla/report-delete", { reportId: "abc" });

            expect(logStore.clearEvaluation).toHaveBeenCalledWith("l1");
            expect(json(res).data.logId).toBe("l1");
        });
    });

    describe("POST /api/cla/report-unlink", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            logStore.getByReportRefId.mockReturnValue({ id: "l1", reportRefId: "abc", eventId: "e1" });
            logStore.unlinkEvent.mockReturnValue({ id: "l1" });
        });

        it("unlinks the raid assignment of the log behind the report", async () => {
            const res = await post("/api/cla/report-unlink", { reportId: "abc" });

            expect(logStore.unlinkEvent).toHaveBeenCalledWith("l1");
            expect(json(res)).toEqual({ data: { reportId: "abc", logId: "l1", message: "Zuordnung entfernt." } });
        });

        it("leaves the report itself alone", async () => {
            await post("/api/cla/report-unlink", { reportId: "abc" });
            expect(reportStore.deleteReport).not.toHaveBeenCalled();
        });

        it("returns 400 when no log belongs to the report", async () => {
            logStore.getByReportRefId.mockReturnValue(null);

            const res = await post("/api/cla/report-unlink", { reportId: "abc" });

            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "not_found", message: "Zu dieser Auswertung gibt es kein Log." } });
            expect(logStore.unlinkEvent).not.toHaveBeenCalled();
        });

        it("returns 400 when the log was not assigned to a raid", async () => {
            logStore.unlinkEvent.mockReturnValue(null);

            const res = await post("/api/cla/report-unlink", { reportId: "abc" });

            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "not_linked", message: "Keine Zuordnung vorhanden." } });
        });
    });

    // The evaluation runs in the background (evalJobs.js): POST only queues it and
    // answers at once, because holding the response open for an ~50s RPB run dies
    // at a reverse proxy's 60s timeout. The result is collected via eval-status.
    describe("POST /api/cla/eval", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            evalJobs.reset();
            logStore.getLog.mockReturnValue({ id: "l1", status: "open" });
        });

        it("answers 202 running without waiting for the evaluation", async () => {
            let finish;
            logChannel.evaluateLog.mockReturnValue(new Promise((r) => { finish = r; }));
            const res = await post("/api/cla/eval", { logId: "l1" });
            expect(res.writeHead).toHaveBeenCalledWith(202, expect.any(Object));
            expect(json(res)).toEqual({
                data: { status: "running", section: "cla", logId: "l1", alreadyRunning: false },
            });
            finish({ ok: true, url: "/r/abc" });
        });

        it("starts the requested section", async () => {
            logChannel.evaluateLog.mockResolvedValue({ ok: true, id: "abc", url: "/r/abc" });
            await post("/api/cla/eval", { logId: "l1", section: "rpb" });
            await flushJobs();
            expect(logChannel.evaluateLog).toHaveBeenCalledWith("l1", "rpb", { force: false });
        });

        it("falls back to the CLA half for an unknown section", async () => {
            logChannel.evaluateLog.mockResolvedValue({ ok: true, id: "abc", url: "/r/abc" });
            await post("/api/cla/eval", { logId: "l1", section: "nonsense" });
            await flushJobs();
            expect(logChannel.evaluateLog).toHaveBeenCalledWith("l1", "cla", { force: false });
        });

        it("reports a half that already ran without starting a job", async () => {
            logStore.getLog.mockReturnValue({ id: "l1", status: "done", sections: ["cla"], reportUrl: "/r/xyz" });
            const res = await post("/api/cla/eval", { logId: "l1", section: "cla" });
            expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
            expect(json(res)).toEqual({
                data: { alreadyEvaluated: true, url: "/r/xyz", section: "cla", status: "done" },
            });
            expect(logChannel.evaluateLog).not.toHaveBeenCalled();
        });

        it("still starts the other half of an already half-evaluated log", async () => {
            logStore.getLog.mockReturnValue({ id: "l1", status: "done", sections: ["cla"], reportUrl: "/r/xyz" });
            logChannel.evaluateLog.mockResolvedValue({ ok: true, url: "/r/xyz" });
            const res = await post("/api/cla/eval", { logId: "l1", section: "rpb" });
            expect(res.writeHead).toHaveBeenCalledWith(202, expect.any(Object));
            await flushJobs();
            expect(logChannel.evaluateLog).toHaveBeenCalledWith("l1", "rpb", { force: false });
        });

        it("rejects an unknown log up front", async () => {
            logStore.getLog.mockReturnValue(null);
            const res = await post("/api/cla/eval", { logId: "nope" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "eval_failed", message: "Log nicht gefunden." } });
            expect(logChannel.evaluateLog).not.toHaveBeenCalled();
        });

        it("rejects a request without a log id", async () => {
            const res = await post("/api/cla/eval", {});
            expect(json(res)).toEqual({ error: { code: "eval_failed", message: "Kein Log angegeben." } });
        });

        it("flags a second start while the first is still running", async () => {
            logChannel.evaluateLog.mockReturnValue(new Promise(() => {}));
            await post("/api/cla/eval", { logId: "l1", section: "rpb" });
            const res = await post("/api/cla/eval", { logId: "l1", section: "rpb" });
            expect(json(res).data.alreadyRunning).toBe(true);
        });
    });

    // Discarding a single half is what makes an incomplete run repeatable without
    // losing the other analysis on the same report page.
    describe("POST /api/cla/eval-reset", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
        });

        it("drops one half, strips it from the report and keeps the page", async () => {
            logStore.getLog.mockReturnValue({
                id: "l1", status: "done", sections: ["cla", "rpb"], reportRefId: "rep1",
            });
            logStore.clearSection.mockReturnValue({ remaining: ["cla"], wasLast: false });
            reportStore.getReport.mockReturnValue({ id: "rep1", sections: ["cla", "rpb"], rpb: { roles: {} } });

            const res = await post("/api/cla/eval-reset", { logId: "l1", section: "rpb" });
            expect(logStore.clearSection).toHaveBeenCalledWith("l1", "rpb");
            // the page is rewritten without the RPB half, not deleted
            expect(reportStore.saveReport).toHaveBeenCalledWith(
                expect.objectContaining({ rpb: null, sections: ["cla"] }), "rep1",
            );
            expect(reportStore.deleteReport).not.toHaveBeenCalled();
            expect(json(res).data).toMatchObject({ logId: "l1", section: "rpb", remaining: ["cla"] });
        });

        it("deletes the whole report when the last half is dropped", async () => {
            logStore.getLog.mockReturnValue({
                id: "l1", status: "done", sections: ["rpb"], reportRefId: "rep1",
            });
            logStore.clearSection.mockReturnValue({ remaining: [], wasLast: true });

            const res = await post("/api/cla/eval-reset", { logId: "l1", section: "rpb" });
            expect(reportStore.deleteReport).toHaveBeenCalledWith("rep1");
            expect(reportStore.saveReport).not.toHaveBeenCalled();
            expect(json(res).data.message).toMatch(/offen/i);
        });

        it("rejects a half that was never evaluated", async () => {
            logStore.getLog.mockReturnValue({ id: "l1", status: "done", sections: ["cla"] });
            const res = await post("/api/cla/eval-reset", { logId: "l1", section: "rpb" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res).error.code).toBe("not_evaluated");
            expect(logStore.clearSection).not.toHaveBeenCalled();
        });

        it("rejects an unknown log", async () => {
            logStore.getLog.mockReturnValue(null);
            const res = await post("/api/cla/eval-reset", { logId: "nope", section: "cla" });
            expect(json(res).error).toEqual({ code: "not_found", message: "Log nicht gefunden." });
        });

        it("defaults to the CLA half for an unknown section", async () => {
            logStore.getLog.mockReturnValue({ id: "l1", status: "done", sections: ["cla"] });
            logStore.clearSection.mockReturnValue({ remaining: [], wasLast: true });
            await post("/api/cla/eval-reset", { logId: "l1", section: "nonsense" });
            expect(logStore.clearSection).toHaveBeenCalledWith("l1", "cla");
        });

        it("survives a log whose report file is already gone", async () => {
            logStore.getLog.mockReturnValue({
                id: "l1", status: "done", sections: ["cla", "rpb"], reportRefId: "rep1",
            });
            logStore.clearSection.mockReturnValue({ remaining: ["cla"], wasLast: false });
            reportStore.getReport.mockReturnValue(null);
            const res = await post("/api/cla/eval-reset", { logId: "l1", section: "rpb" });
            expect(reportStore.saveReport).not.toHaveBeenCalled();
            expect(json(res).data.remaining).toEqual(["cla"]);
        });

        it("requires a csrf token", async () => {
            auth.checkCsrf.mockReturnValue(false);
            const res = await post("/api/cla/eval-reset", { logId: "l1", section: "rpb" });
            expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
        });
    });

    describe("GET /api/cla/eval-status", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            evalJobs.reset();
            logStore.getLog.mockReturnValue({ id: "l1", status: "open" });
        });

        it("reports a running evaluation", async () => {
            logChannel.evaluateLog.mockReturnValue(new Promise(() => {}));
            await post("/api/cla/eval", { logId: "l1", section: "rpb" });
            const res = await get("/api/cla/eval-status", { logId: "l1", section: "rpb" });
            expect(json(res).data.status).toBe("running");
        });

        it("reports the finished report's url", async () => {
            logChannel.evaluateLog.mockResolvedValue({ ok: true, id: "abc", url: "/r/abc" });
            await post("/api/cla/eval", { logId: "l1", section: "rpb" });
            await flushJobs();
            const res = await get("/api/cla/eval-status", { logId: "l1", section: "rpb" });
            expect(json(res).data).toMatchObject({ status: "done", url: "/r/abc", id: "abc" });
        });

        it("surfaces a failed evaluation with its message", async () => {
            logChannel.evaluateLog.mockResolvedValue({ ok: false, error: "Report ist privat." });
            await post("/api/cla/eval", { logId: "l1", section: "rpb" });
            await flushJobs();
            const res = await get("/api/cla/eval-status", { logId: "l1", section: "rpb" });
            expect(json(res).data).toMatchObject({ status: "error", error: "Report ist privat." });
        });

        it("answers from the persisted state when no job is tracked (after a restart)", async () => {
            logStore.getLog.mockReturnValue({
                id: "l1", status: "done", sections: ["rpb"], reportUrl: "/r/old", reportRefId: "old",
            });
            const res = await get("/api/cla/eval-status", { logId: "l1", section: "rpb" });
            expect(json(res).data).toMatchObject({ status: "done", url: "/r/old", id: "old" });
        });

        it("reports unknown when neither a job nor a result exists", async () => {
            logStore.getLog.mockReturnValue({ id: "l1", status: "open" });
            const res = await get("/api/cla/eval-status", { logId: "l1", section: "rpb" });
            expect(json(res).data.status).toBe("unknown");
        });

        it("requires an admin session", async () => {
            auth.getUser.mockReturnValue(null);
            const res = await get("/api/cla/eval-status", { logId: "l1", section: "rpb" });
            expect(res.writeHead).toHaveBeenCalledWith(401, expect.any(Object));
        });
    });

    describe("POST /api/cla/scan", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
        });

        it("scans and returns the found count + message", async () => {
            activeGuildFor.mockReturnValue("guild-1");
            logChannel.scanLogChannels.mockResolvedValue(3);
            const res = await post("/api/cla/scan", {});
            expect(logChannel.scanLogChannels).toHaveBeenCalledWith("guild-1");
            expect(json(res)).toEqual({ data: { found: 3, message: "3 neue(r) Log(s) gefunden." } });
        });

        it("returns a 500 with the thrown message on failure", async () => {
            logChannel.scanLogChannels.mockRejectedValue(new Error("timeout"));
            const res = await post("/api/cla/scan", {});
            expect(res.writeHead).toHaveBeenCalledWith(500, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "scan_failed", message: "timeout" } });
        });
    });

    describe("POST /api/cla/log-delete", () => {
        it("deletes the log and returns its id", async () => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            const res = await post("/api/cla/log-delete", { logId: "l1" });
            expect(logStore.deleteLog).toHaveBeenCalledWith("l1");
            expect(json(res)).toEqual({ data: { logId: "l1" } });
        });
    });

    describe("POST /api/cla/log-link", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("");
            discord.getChannelCategoryMap.mockReturnValue({});
            mockGetPastEvents.mockResolvedValue([]);
        });

        it("returns 400 when the log is not found", async () => {
            logStore.getLog.mockReturnValue(null);
            const res = await post("/api/cla/log-link", { logId: "l1", eventId: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "not_found", message: "Log nicht gefunden." } });
            expect(logStore.linkEvent).not.toHaveBeenCalled();
        });

        it("returns 400 when no event id is given", async () => {
            logStore.getLog.mockReturnValue({ id: "l1" });
            const res = await post("/api/cla/log-link", { logId: "l1", eventId: "" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "no_event", message: "Kein Event gewählt." } });
        });

        it("surfaces the Raid-Helper error when events cannot be loaded", async () => {
            logStore.getLog.mockReturnValue({ id: "l1" });
            activeGuildFor.mockReturnValue("guild-1");
            mockGetPastEvents.mockRejectedValue(new Error("API down"));
            const res = await post("/api/cla/log-link", { logId: "l1", eventId: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "events_unavailable", message: "API down" } });
        });

        it("returns 400 when the event id is not among the resolved events", async () => {
            logStore.getLog.mockReturnValue({ id: "l1" });
            activeGuildFor.mockReturnValue("guild-1");
            discord.getChannelCategoryMap.mockReturnValue({ c1: { name: "chan", categoryId: "cat1", categoryName: "Raids" } });
            mockGetPastEvents.mockResolvedValue([{ id: "e2", title: "Other", startTime: 100, channelId: "c1" }]);

            const res = await post("/api/cla/log-link", { logId: "l1", eventId: "e1" });

            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "event_not_found", message: "Event nicht gefunden." } });
        });

        it("links the log to the re-resolved event on success", async () => {
            logStore.getLog.mockReturnValue({ id: "l1" });
            activeGuildFor.mockReturnValue("guild-1");
            discord.getChannelCategoryMap.mockReturnValue({ c1: { name: "chan", categoryId: "cat1", categoryName: "Raids" } });
            mockGetPastEvents.mockResolvedValue([{ id: "e2", title: "Other", startTime: 100, channelId: "c1" }]);

            const res = await post("/api/cla/log-link", { logId: "l1", eventId: "e2" });

            expect(logStore.linkEvent).toHaveBeenCalledWith("l1", { eventId: "e2", eventLabel: "Other", eventStartTime: 100, source: "manual" });
            expect(json(res)).toEqual({
                data: { logId: "l1", eventId: "e2", eventLabel: "Other", message: "Log „Other\" zugeordnet." },
            });
        });
    });

    describe("POST /api/cla/log-link-url", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            discord.getChannelCategoryMap.mockReturnValue({ c1: { name: "chan", categoryId: "cat1", categoryName: "Raids" } });
            mockGetPastEvents.mockResolvedValue([{ id: "e2", title: "Other", startTime: 100, channelId: "c1" }]);
        });

        it("returns 400 when no event id is given", async () => {
            const res = await post("/api/cla/log-link-url", { link: "https://classic.warcraftlogs.com/reports/AAA", eventId: "" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "no_event", message: "Kein Event gewählt." } });
            expect(manualLog.linkLogByUrl).not.toHaveBeenCalled();
        });

        it("returns 400 when the event id is not among the resolved events", async () => {
            const res = await post("/api/cla/log-link-url", { link: "https://classic.warcraftlogs.com/reports/AAA", eventId: "e1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "event_not_found", message: "Event nicht gefunden." } });
            expect(manualLog.linkLogByUrl).not.toHaveBeenCalled();
        });

        it("surfaces an invalid-link failure from the helper", async () => {
            manualLog.linkLogByUrl.mockReturnValue({ error: "Kein gültiger Warcraft-Logs-Link." });
            const res = await post("/api/cla/log-link-url", { link: "nope", eventId: "e2" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "invalid_link", message: "Kein gültiger Warcraft-Logs-Link." } });
        });

        it("registers + links the pasted URL and backfills the title", async () => {
            const log = { id: "l9", reportId: "AAA" };
            manualLog.linkLogByUrl.mockReturnValue({ log, created: true });

            const res = await post("/api/cla/log-link-url", { link: "https://classic.warcraftlogs.com/reports/AAA", eventId: "e2" });

            expect(manualLog.linkLogByUrl).toHaveBeenCalledWith(
                "https://classic.warcraftlogs.com/reports/AAA",
                expect.objectContaining({ id: "e2", title: "Other" }),
                "guild-1",
            );
            expect(logChannel.backfillLogTitles).toHaveBeenCalledWith([log]);
            expect(json(res)).toEqual({
                data: { logId: "l9", eventId: "e2", eventLabel: "Other", message: "WCL-Link „Other\" zugeordnet." },
            });
        });
    });

    describe("POST /api/cla/log-unlink", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
        });

        it("returns 400 when the log was not linked", async () => {
            logStore.unlinkEvent.mockReturnValue(null);
            const res = await post("/api/cla/log-unlink", { logId: "l1" });
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "not_linked", message: "Keine Zuordnung vorhanden." } });
        });

        it("removes the assignment on success", async () => {
            logStore.unlinkEvent.mockReturnValue({ id: "l1" });
            const res = await post("/api/cla/log-unlink", { logId: "l1" });
            expect(logStore.unlinkEvent).toHaveBeenCalledWith("l1");
            expect(json(res)).toEqual({ data: { logId: "l1", message: "Zuordnung entfernt." } });
        });
    });

    describe("POST /api/cla/log-automatch", () => {
        beforeEach(() => {
            auth.getUser.mockReturnValue({ id: "1", name: "Admin", isAdmin: true });
            auth.checkCsrf.mockReturnValue(true);
            activeGuildFor.mockReturnValue("guild-1");
            discord.getChannelCategoryMap.mockReturnValue({});
            mockGetPastEvents.mockResolvedValue([]);
            logStore.listLogs.mockReturnValue([]);
        });

        it("surfaces the Raid-Helper error when events cannot be loaded", async () => {
            mockGetPastEvents.mockRejectedValue(new Error("API down"));
            const res = await post("/api/cla/log-automatch", {});
            expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
            expect(json(res)).toEqual({ error: { code: "events_unavailable", message: "API down" } });
            expect(logStore.linkEvent).not.toHaveBeenCalled();
        });

        it("links every unambiguous match and reports the remainder", async () => {
            logStore.listLogs.mockReturnValue([
                { id: "l1", guildId: "guild-1" },
                { id: "l2", guildId: "guild-1", eventId: "e5" }, // already linked — excluded
                { id: "l3", guildId: "guild-1" },
                { id: "l4", guildId: "other-guild" }, // different guild — excluded
            ]);
            discord.getChannelCategoryMap.mockReturnValue({ c1: { name: "chan", categoryId: "cat1", categoryName: "Raids" } });
            mockGetPastEvents.mockResolvedValue([{ id: "e9", title: "Match Event", startTime: 500, channelId: "c1" }]);
            const matchedEvent = { id: "e9", source: "raidhelper", title: "Match Event", startTime: 500, channelId: "c1", channelName: "chan", categoryId: "cat1", categoryName: "Raids" };
            logEventMatch.autoMatches.mockReturnValue([{ log: { id: "l1" }, event: matchedEvent, diffMs: 1000 }]);

            const res = await post("/api/cla/log-automatch", {});

            expect(logEventMatch.autoMatches).toHaveBeenCalledWith(
                [{ id: "l1", guildId: "guild-1" }, { id: "l3", guildId: "guild-1" }],
                [matchedEvent],
            );
            expect(logStore.linkEvent).toHaveBeenCalledWith("l1", { eventId: "e9", eventLabel: "Match Event", eventStartTime: 500, source: "auto" });
            expect(json(res)).toEqual({
                data: { matched: 1, remaining: 1, message: "1 Log(s) automatisch zugeordnet, 1 ohne eindeutiges Event." },
            });
        });

        it("reports no remainder when every unlinked log gets matched", async () => {
            logStore.listLogs.mockReturnValue([{ id: "l1", guildId: "guild-1" }]);
            const matchedEvent = { id: "e9", title: "Match Event", startTime: 500 };
            logEventMatch.autoMatches.mockReturnValue([{ log: { id: "l1" }, event: matchedEvent, diffMs: 1000 }]);

            const res = await post("/api/cla/log-automatch", {});

            expect(json(res)).toEqual({
                data: { matched: 1, remaining: 0, message: "1 Log(s) automatisch zugeordnet." },
            });
        });

        it("uses the unfiltered log list when no guild is active", async () => {
            activeGuildFor.mockReturnValue("");
            logStore.listLogs.mockReturnValue([{ id: "l1", guildId: "some-guild" }]);

            await post("/api/cla/log-automatch", {});

            expect(logEventMatch.autoMatches).toHaveBeenCalledWith([{ id: "l1", guildId: "some-guild" }], []);
        });
    });
});
