// ui/DataTable (#439): sortable headers through SortTh + lib/tableSort, an
// empty state instead of a headless table, and a Pager for client-side pages.
// The paging is pure (lib/dataTable.ts) and runs in Vitest
// (src/web-client/src/lib/dataTable.test.ts); the component and its first
// user (the Recruitment templates) are checked by source here.
const { read } = require("../clientSource");

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
    const page = read("pages/recruitment/TemplatesTab.tsx");
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
