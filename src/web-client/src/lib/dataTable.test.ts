// lib/dataTable.ts (#439): the client-side paging of ui/DataTable. The
// component and its first user (the Recruitment templates) are checked by
// source in test/web-client/dataTable.test.js.
import { describe, expect, it } from "vitest";
import { pageSlice } from "./dataTable";

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
