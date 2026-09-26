// ui/DataTable (#439): sortable headers through SortTh + lib/tableSort, an
// empty state instead of a headless table, and a Pager for client-side pages.
// The paging is pure (lib/dataTable.ts) and runs here; the component and its
// first user (the Recruitment templates) are checked by source.
const { loadTs, read } = require("./i18nHelper");

const { pageSlice } = loadTs("lib/dataTable.ts");
const rows = Array.from({ length: 23 }, (_, i) => i + 1);

describe("pageSlice", () => {
    it("without a page size is one page with everything", () => {
        expect(pageSlice(rows, 3, 0)).toEqual({ rows, page: 1, totalPages: 1, total: 23 });
    });

    it("cuts a page", () => {
        expect(pageSlice(rows, 1, 10)).toEqual({ rows: rows.slice(0, 10), page: 1, totalPages: 3, total: 23 });
        expect(pageSlice(rows, 3, 10).rows).toEqual([21, 22, 23]);
    });

    it("falls back to the last page when the open one is gone", () => {
        expect(pageSlice(rows, 9, 10).page).toBe(3);
        expect(pageSlice(rows.slice(0, 4), 3, 10)).toEqual({ rows: [1, 2, 3, 4], page: 1, totalPages: 1, total: 4 });
    });

    it("never goes below page 1", () => {
        expect(pageSlice(rows, 0, 10).page).toBe(1);
        expect(pageSlice(rows, -2, 10).page).toBe(1);
        expect(pageSlice([], 1, 10)).toEqual({ rows: [], page: 1, totalPages: 1, total: 0 });
    });
});

describe("ui/DataTable", () => {
    const src = read("components/ui/DataTable.tsx");

    it("sorts through the shared comparator and header", () => {
        expect(src).toContain("sort.apply(rows, sortValue)");
        expect(src).toContain("<SortTh key={c.id} sortKey={c.sortKey}");
    });

    it("shows the empty state instead of a table without rows", () => {
        expect(src).toContain("if (!rows.length) return <>{empty}</>;");
    });

    it("pages with the shared Pager only when there is more than one page", () => {
        expect(src).toContain("pageSlice(ordered, page, pageSize)");
        expect(src).toContain("{shown.totalPages > 1 && <Pager page={shown} onPage={setPage} />}");
    });

    it("keeps an actions cell's clicks from opening the row", () => {
        expect(src).toContain("onClick={c.actions ? (e) => e.stopPropagation() : undefined}");
    });

    it("is exported with the other building blocks", () => {
        expect(read("components/ui/index.ts")).toContain("export { default as DataTable, type Column } from \"./DataTable\";");
    });
});

describe("the Recruitment templates use it", () => {
    const page = read("pages/RecruitmentPage.tsx");
    const tab = page.slice(page.indexOf("function TemplatesTab"), page.indexOf("function TemplatesTab") + 5000);

    it("draws the table through DataTable, same classes as before", () => {
        expect(tab).toContain("<DataTable");
        expect(tab).toContain("wrapClassName=\"rc-tbl\" rowClassName=\"rc-row\"");
        expect(tab).not.toContain("<table");
        expect(tab).toContain("empty={(");
    });

    it("every labelled column is sortable", () => {
        const cols = [...tab.matchAll(/\{ id: "(\w+)",(?: label: "([^"]+)",)?( sortKey: "\w+",)?/g)];
        expect(cols.length).toBe(5);
        for (const [, id, label, sortKey] of cols) {
            if (label) expect({ id, sortable: !!sortKey }).toEqual({ id, sortable: true });
        }
    });
});
