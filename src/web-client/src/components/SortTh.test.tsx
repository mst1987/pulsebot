// The one sortable table header (components/SortTh.tsx; #435: formerly a
// source scan in test/web-client/tableSort.test.js). The chevron is decoration;
// aria-sort is what a screen reader announces.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useTableSort, type Dir } from "../lib/tableSort";
import { SortTh, ariaSort } from "./SortTh";

type Col = "name" | "date";
const DEFAULTS: Record<Col, Dir> = { name: "asc", date: "desc" };

function Table() {
    const { sort, dir, onSort } = useTableSort<Col>("sortth-test", DEFAULTS, "date");
    return (
        <table>
            <thead>
                <tr>
                    <SortTh sortKey="name" label="Name" sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="date" label="Datum" sort={sort} dir={dir} onSort={onSort} tip="Datum" tipSub="Wann das Item vergeben wurde" />
                </tr>
            </thead>
        </table>
    );
}

const header = (name: string) => screen.getByRole("columnheader", { name });

describe("SortTh", () => {
    it("tells screen readers which column is sorted, and in which direction", async () => {
        const user = userEvent.setup();
        render(<Table />);
        expect(header("Datum")).toHaveAttribute("aria-sort", "descending");
        expect(header("Name")).toHaveAttribute("aria-sort", "none");

        await user.click(screen.getByRole("button", { name: "Name" }));
        expect(header("Name")).toHaveAttribute("aria-sort", "ascending");
        expect(header("Datum")).toHaveAttribute("aria-sort", "none");

        await user.click(screen.getByRole("button", { name: "Name" }));
        expect(header("Name")).toHaveAttribute("aria-sort", "descending");
    });

    it("explains a column in the tooltip box, never in a native title", () => {
        render(<Table />);
        const button = screen.getByRole("button", { name: "Datum" });
        expect(button).toHaveAttribute("data-tip", "Datum");
        expect(button).toHaveAttribute("data-tip-sub", "Wann das Item vergeben wurde");
        expect(button).not.toHaveAttribute("title");
    });

    it("decides the announced value in one helper", () => {
        expect(ariaSort("a", "b", "asc")).toBe("none");
        expect(ariaSort("a", "a", "asc")).toBe("ascending");
        expect(ariaSort("a", "a", "desc")).toBe("descending");
    });
});
