const {
    prepareReportList, prepareLogList, annotateLogCategories, annotateReportEvents,
    DEFAULT_PAGE_SIZE, logPostedAt, snowflakeTimestamp,
} = require("../../src/web/reportList.js");

// Build n reports with ascending generatedAt (id0 oldest … id{n-1} newest).
function makeReports(n) {
    return Array.from({ length: n }, (_, i) => ({
        id: "id" + i,
        title: "Report " + String(i).padStart(2, "0"),
        zone: i % 2 ? "Gruul" : "Kara",
        generatedAt: 1000 + i,
        playerCount: 20 + (i % 5),
        issueCount: i % 4,
    }));
}

describe("web/reportList prepareReportList", () => {
    it("defaults to sort=date dir=desc page=1 (newest first)", () => {
        const rp = prepareReportList(makeReports(5));
        expect(rp.sort).toBe("date");
        expect(rp.dir).toBe("desc");
        expect(rp.page).toBe(1);
        expect(rp.items.map((r) => r.id)).toEqual(["id4", "id3", "id2", "id1", "id0"]);
    });

    it("sorts ascending by date when dir=asc", () => {
        const rp = prepareReportList(makeReports(3), { sort: "date", dir: "asc" });
        expect(rp.items.map((r) => r.id)).toEqual(["id0", "id1", "id2"]);
    });

    it("falls back to the date sort for an unknown sort key", () => {
        const rp = prepareReportList(makeReports(3), { sort: "bogus" });
        expect(rp.sort).toBe("date");
    });

    it("sorts by title, zone, players and issues", () => {
        const reports = [
            { id: "a", title: "Zeta", zone: "Kara", generatedAt: 3, playerCount: 10, issueCount: 5 },
            { id: "b", title: "Alpha", zone: "Gruul", generatedAt: 2, playerCount: 25, issueCount: 1 },
            { id: "c", title: "Mid", zone: "Maggy", generatedAt: 1, playerCount: 18, issueCount: 9 },
        ];
        expect(prepareReportList(reports, { sort: "title", dir: "asc" }).items.map((r) => r.id)).toEqual(["b", "c", "a"]);
        expect(prepareReportList(reports, { sort: "players", dir: "desc" }).items.map((r) => r.id)).toEqual(["b", "c", "a"]);
        expect(prepareReportList(reports, { sort: "issues", dir: "desc" }).items.map((r) => r.id)).toEqual(["c", "a", "b"]);
        expect(prepareReportList(reports, { sort: "zone", dir: "asc" }).items[0].id).toBe("b"); // Gruul
    });

    it("paginates and reports totals (15 per page)", () => {
        const rp = prepareReportList(makeReports(47), { page: "2" });
        expect(rp.total).toBe(47);
        expect(rp.pageSize).toBe(DEFAULT_PAGE_SIZE);
        expect(DEFAULT_PAGE_SIZE).toBe(15);
        expect(rp.totalPages).toBe(4); // ceil(47/15)
        expect(rp.page).toBe(2);
        expect(rp.items).toHaveLength(15);
        // newest-first ids 46..0 → page1 46..32, page2 31..17
        expect(rp.items[0].id).toBe("id31");
    });

    it("clamps an out-of-range or invalid page into [1, totalPages]", () => {
        expect(prepareReportList(makeReports(47), { page: "999" }).page).toBe(4);
        expect(prepareReportList(makeReports(47), { page: "0" }).page).toBe(1);
        expect(prepareReportList(makeReports(47), { page: "abc" }).page).toBe(1);
        expect(prepareReportList(makeReports(5), { page: "2" }).page).toBe(1); // only 1 page
    });

    it("honours a custom pageSize", () => {
        const rp = prepareReportList(makeReports(10), { page: "2" }, { pageSize: 4 });
        expect(rp.pageSize).toBe(4);
        expect(rp.totalPages).toBe(3);
        expect(rp.items).toHaveLength(4);
    });

    it("tolerates a missing/empty list", () => {
        const rp = prepareReportList(undefined);
        expect(rp).toMatchObject({ total: 0, totalPages: 1, page: 1, items: [] });
    });

    it("does not mutate the input array", () => {
        const reports = makeReports(3);
        const snapshot = reports.map((r) => r.id);
        prepareReportList(reports, { sort: "title", dir: "asc" });
        expect(reports.map((r) => r.id)).toEqual(snapshot);
    });
});

describe("web/reportList prepareLogList", () => {
    const logs = [
        { id: "a", title: "Kara A", status: "open", detectedAt: 9999, postedAt: 100 },
        { id: "b", title: "Kara B", status: "done", detectedAt: 1, postedAt: 300 },
        { id: "c", title: "Kara C", status: "open", detectedAt: 5000, postedAt: 200 },
    ];

    it("defaults to newest CHANNEL-POST time first (postedAt, not detectedAt)", () => {
        const lp = prepareLogList(logs);
        expect(lp.sort).toBe("date");
        expect(lp.dir).toBe("desc");
        expect(lp.items.map((l) => l.id)).toEqual(["b", "c", "a"]); // 300, 200, 100
    });

    describe("snowflakeTimestamp / logPostedAt", () => {
        it("decodes a Discord message id to its post timestamp (Discord epoch)", () => {
            // id 0 -> exactly the Discord epoch (2015-01-01)
            expect(snowflakeTimestamp("0")).toBe(1420070400000);
            // (1 << 22) -> epoch + 1ms
            expect(snowflakeTimestamp(String(4194304))).toBe(1420070400001);
            expect(snowflakeTimestamp("not-a-number")).toBe(0);
            expect(snowflakeTimestamp("")).toBe(0);
            expect(snowflakeTimestamp(undefined)).toBe(0);
        });

        it("logPostedAt prefers postedAt, then the message-id snowflake, then detectedAt", () => {
            const mid = String((123n << 22n));
            expect(logPostedAt({ postedAt: 5, messageId: mid, detectedAt: 9 })).toBe(5);
            expect(logPostedAt({ messageId: mid, detectedAt: 9 })).toBe(snowflakeTimestamp(mid));
            expect(logPostedAt({ detectedAt: 9 })).toBe(9);
            expect(logPostedAt({})).toBe(0);
        });

        it("sorts logs without postedAt by their message-id post time", () => {
            const noPosted = [
                { id: "old", messageId: String(100n << 22n), detectedAt: 5 },
                { id: "new", messageId: String(900n << 22n), detectedAt: 5 },
                { id: "mid", messageId: String(500n << 22n), detectedAt: 5 },
            ];
            expect(prepareLogList(noPosted).items.map((l) => l.id)).toEqual(["new", "mid", "old"]);
        });
    });

    it("falls back to detectedAt when postedAt is absent", () => {
        const noPosted = [
            { id: "x", detectedAt: 10 },
            { id: "y", detectedAt: 30 },
            { id: "z", detectedAt: 20 },
        ];
        expect(prepareLogList(noPosted).items.map((l) => l.id)).toEqual(["y", "z", "x"]);
    });

    it("sorts by title and status", () => {
        expect(prepareLogList(logs, { sort: "title", dir: "asc" }).items.map((l) => l.id)).toEqual(["a", "b", "c"]);
        // status asc: open(0) before done(1); tiebreak newest postedAt first → c(200) then a(100)
        expect(prepareLogList(logs, { sort: "status", dir: "asc" }).items.map((l) => l.id)).toEqual(["c", "a", "b"]);
    });

    it("paginates logs 15 per page", () => {
        const many = Array.from({ length: 20 }, (_, i) => ({ id: "l" + i, postedAt: i }));
        const lp = prepareLogList(many, { page: "2" });
        expect(lp.totalPages).toBe(2);
        expect(lp.items).toHaveLength(5);
    });

    describe("annotateLogCategories", () => {
        it("tags each log with its Discord category + channel name from the map", () => {
            const items = [
                { id: "a", channelId: "c1" },
                { id: "b", channelId: "c2" }, // not in the map → untouched
            ];
            annotateLogCategories(items, {
                c1: { name: "kara-logs", categoryId: "cat1", categoryName: "Karazhan" },
            });
            expect(items[0]).toMatchObject({ categoryName: "Karazhan", channelName: "kara-logs" });
            expect(items[1].categoryName).toBeUndefined();
        });

        it("tolerates a missing map / items", () => {
            expect(() => annotateLogCategories(undefined, undefined)).not.toThrow();
            const items = [{ id: "a", channelId: "c1" }];
            annotateLogCategories(items, null);
            expect(items[0].categoryName).toBeUndefined();
        });
    });
});

describe("web/reportList annotateReportEvents", () => {
    const logs = [
        { id: "l1", reportRefId: "r1", eventId: "e1", eventLabel: "Gruul", eventStartTime: 500 },
        { id: "l2", reportRefId: "r2" }, // evaluated, but not assigned to a raid
        { id: "l3", eventId: "e9", eventLabel: "SSC" }, // assigned, but never evaluated
    ];

    it("carries the raid over from the log the report was generated from", () => {
        const reports = [{ id: "r1" }];
        annotateReportEvents(reports, logs);
        expect(reports[0]).toMatchObject({ logId: "l1", eventId: "e1", eventLabel: "Gruul", eventStartTime: 500 });
    });

    it("leaves the raid fields empty for a log without an assignment", () => {
        const reports = [{ id: "r2" }];
        annotateReportEvents(reports, logs);
        expect(reports[0]).toMatchObject({ logId: "l2", eventId: "", eventLabel: "", eventStartTime: 0 });
    });

    it("leaves everything empty for a report with no tracked log", () => {
        const reports = [{ id: "unknown" }];
        annotateReportEvents(reports, logs);
        expect(reports[0]).toMatchObject({ logId: "", eventId: "", eventLabel: "", eventStartTime: 0 });
    });

    it("returns the same array and tolerates missing input", () => {
        const reports = [{ id: "r1" }];
        expect(annotateReportEvents(reports, logs)).toBe(reports);
        expect(() => annotateReportEvents(undefined, undefined)).not.toThrow();
        expect(() => annotateReportEvents([{ id: "r1" }], null)).not.toThrow();
    });

    it("makes the reports sortable by raid, grouping the unassigned ones", () => {
        const reports = [{ id: "r1", generatedAt: 3 }, { id: "r2", generatedAt: 2 }, { id: "x", generatedAt: 1 }];
        annotateReportEvents(reports, logs);
        const asc = prepareReportList(reports, { sort: "event", dir: "asc" });
        expect(asc.sort).toBe("event");
        // "" sorts before "gruul" → the two unassigned reports first (newest first among them)
        expect(asc.items.map((r) => r.id)).toEqual(["r2", "x", "r1"]);
        expect(prepareReportList(reports, { sort: "event", dir: "desc" }).items[0].id).toBe("r1");
    });
});
