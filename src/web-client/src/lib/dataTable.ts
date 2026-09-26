// The pure half of components/ui/DataTable.tsx (#439): which rows a page of a
// client-side paged table shows. Kept free of React, tested in
// src/web-client/src/lib/dataTable.test.ts.

/** One page of rows plus what the Pager shows ("Seite X / Y · Z gesamt"). */
export type PageSlice<T> = { rows: T[]; page: number; totalPages: number; total: number };

/**
 * The rows of page `page` (1-based). A page past the end — rows were filtered
 * away or deleted while page 5 was open — falls back to the last one instead of
 * showing an empty table; no `pageSize` (0) means one page with everything.
 */
export function pageSlice<T>(rows: T[], page: number, pageSize: number): PageSlice<T> {
    const total = rows.length;
    if (!pageSize || pageSize <= 0) return { rows, page: 1, totalPages: 1, total };
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const at = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
    return { rows: rows.slice((at - 1) * pageSize, at * pageSize), page: at, totalPages, total };
}
