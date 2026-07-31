// The clickable table header every admin table sorts by. One component instead
// of the copy per table it used to be, so the arrow, the active state and the
// keyboard/screen-reader semantics are the same everywhere.
//
// `aria-sort` is what tells a screen reader that the column is sorted and in
// which direction — the ▲/▼ glyph alone is decoration it never announces.
import type { Dir } from "../lib/tableSort";

export function SortTh<K extends string>({ sortKey, label, sort, dir, onSort, title, style }: {
    sortKey: K;
    label: string;
    sort: K;
    dir: Dir;
    onSort: (key: K) => void;
    title?: string;
    style?: React.CSSProperties;
}) {
    const active = sort === sortKey;
    return (
        <th aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} style={style}>
            <button
                type="button"
                className={`sort-link${active ? " active" : ""}`}
                title={title}
                onClick={() => onSort(sortKey)}
            >
                {label}{active ? (dir === "asc" ? " ▲" : " ▼") : ""}
            </button>
        </th>
    );
}
