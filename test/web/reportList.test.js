const { prepareReportList, DEFAULT_PAGE_SIZE } = require("../../src/web/reportList.js");

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

    it("paginates and reports totals", () => {
        const rp = prepareReportList(makeReports(47), { page: "2" });
        expect(rp.total).toBe(47);
        expect(rp.pageSize).toBe(DEFAULT_PAGE_SIZE);
        expect(rp.totalPages).toBe(3);
        expect(rp.page).toBe(2);
        expect(rp.items).toHaveLength(20);
        // page 2 of newest-first: ids 46..0 → page1 46..27, page2 26..7
        expect(rp.items[0].id).toBe("id26");
    });

    it("clamps an out-of-range or invalid page into [1, totalPages]", () => {
        expect(prepareReportList(makeReports(47), { page: "999" }).page).toBe(3);
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
