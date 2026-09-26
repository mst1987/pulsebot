// The shared table sort (lib/tableSort.ts; #435: formerly source scans in
// test/web-client/tableSort.test.js): a stable comparator, and a remembered
// sort that distrusts what it finds in storage.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sortRows, useTableSort, type Dir } from "./tableSort";

type Col = "name" | "date";
const DEFAULTS: Record<Col, Dir> = { name: "asc", date: "desc" };

describe("sortRows", () => {
    // An unstable sort reshuffles the rows a column can't tell apart on every
    // render, which reads as a table flickering by itself.
    it("keeps equal rows in their previous order, in both directions", () => {
        const rows = [{ id: "a", n: 2 }, { id: "b", n: 1 }, { id: "c", n: 2 }, { id: "d", n: 1 }];
        expect(sortRows(rows, (r) => r.n, "asc").map((r) => r.id)).toEqual(["b", "d", "a", "c"]);
        expect(sortRows(rows, (r) => r.n, "desc").map((r) => r.id)).toEqual(["a", "c", "b", "d"]);
    });

    it("never changes the rows it is given", () => {
        const rows = [{ n: 2 }, { n: 1 }];
        sortRows(rows, (r) => r.n, "asc");
        expect(rows).toEqual([{ n: 2 }, { n: 1 }]);
    });
});

describe("useTableSort", () => {
    it("falls back to the default when the stored column is gone", () => {
        window.localStorage.setItem("eh-test-sort", JSON.stringify({ sort: "removed", dir: "asc" }));
        const { result } = renderHook(() => useTableSort<Col>("test-sort", DEFAULTS, "date"));
        expect(result.current.sort).toBe("date");
    });

    it("keeps a stored column that still exists", () => {
        window.localStorage.setItem("eh-test-sort", JSON.stringify({ sort: "name", dir: "desc" }));
        const { result } = renderHook(() => useTableSort<Col>("test-sort", DEFAULTS, "date"));
        expect([result.current.sort, result.current.dir]).toEqual(["name", "desc"]);
    });

    it("starts a new column in its natural direction and toggles the active one", () => {
        const { result } = renderHook(() => useTableSort<Col>("test-sort", DEFAULTS, "date"));
        expect([result.current.sort, result.current.dir]).toEqual(["date", "desc"]);
        act(() => result.current.onSort("name"));
        expect([result.current.sort, result.current.dir]).toEqual(["name", "asc"]);
        act(() => result.current.onSort("name"));
        expect(result.current.dir).toBe("desc");
        expect(JSON.parse(window.localStorage.getItem("eh-test-sort") || "null")).toEqual({ sort: "name", dir: "desc" });
    });
});
