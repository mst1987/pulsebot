import { useState, type CSSProperties, type ReactNode } from "react";
import { SortTh } from "../SortTh";
import Pager from "../Pager";
import { pageSlice } from "../../lib/dataTable";
import type { SortValue, TableSort } from "../../lib/tableSort";

// A table of the admin menu (#439): sortable headers (components/SortTh +
// lib/tableSort), the rows, an empty state instead of a headless table, and a
// Pager when `pageSize` is set. The look stays the module's: `className` is
// the table's class (`idx` by default) and `wrapClassName` the scroll wrapper
// around it, as the pages had them.

export type Column<T, K extends string> = {
    /** React key of the column. */
    id: string;
    /** Header text; none for an actions column. */
    label?: string;
    /** Makes the header a sort button (every labelled column should have one, see tableSort.test.js). */
    sortKey?: K;
    tip?: string;
    tipSub?: string;
    width?: number | string;
    /** The cell's class. */
    className?: string;
    /** A cell of buttons: its clicks do not open the row. */
    actions?: boolean;
    cell: (row: T) => ReactNode;
};

export default function DataTable<T, K extends string>({ rows, columns, rowKey, sort, sortValue, onRowClick, rowClassName, empty, pageSize = 0, className = "idx", wrapClassName }: {
    rows: T[];
    columns: Column<T, K>[];
    rowKey: (row: T) => string;
    /** The table's sort state (useTableSort) and what a column sorts by. */
    sort?: TableSort<K>;
    sortValue?: (row: T, key: K) => SortValue;
    onRowClick?: (row: T) => void;
    rowClassName?: string;
    /** Shown instead of the table when there are no rows. */
    empty?: ReactNode;
    /** Rows per page; 0 = no paging. */
    pageSize?: number;
    className?: string;
    wrapClassName?: string;
}) {
    const [page, setPage] = useState(1);
    if (!rows.length) return <>{empty}</>;

    const ordered = sort && sortValue ? sort.apply(rows, sortValue) : rows;
    const shown = pageSlice(ordered, page, pageSize);
    const widthStyle = (c: Column<T, K>): CSSProperties | undefined => (c.width !== undefined ? { width: c.width } : undefined);

    const table = (
        <table className={className}>
            <thead>
                <tr>
                    {columns.map((c) => (c.sortKey && sort
                        ? <SortTh key={c.id} sortKey={c.sortKey} label={c.label || ""} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} tip={c.tip} tipSub={c.tipSub} style={widthStyle(c)} />
                        : <th key={c.id} style={widthStyle(c)} data-tip={c.tip} data-tip-sub={c.tipSub}>{c.label}</th>))}
                </tr>
            </thead>
            <tbody>
                {shown.rows.map((row) => (
                    <tr key={rowKey(row)} className={rowClassName} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                        {columns.map((c) => (
                            <td key={c.id} className={c.className} onClick={c.actions ? (e) => e.stopPropagation() : undefined}>{c.cell(row)}</td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );

    return (
        <>
            {wrapClassName ? <div className={wrapClassName}>{table}</div> : table}
            {shown.totalPages > 1 && <Pager page={shown} onPage={setPage} />}
        </>
    );
}
